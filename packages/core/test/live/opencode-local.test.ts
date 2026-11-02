import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, waitFor, CLI, killServer } from '../helpers.js';
import { installHooks } from '../../src/agents/hooks.js';
import { create, list } from '../../src/registry/sessions.js';
import { ensure } from '../../src/restore/ensure.js';

function complete(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const delta of [{ role: 'assistant', content: 'Fixture complete.' }, {}]) {
    response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1,
      model: 'fixture', choices: [{ index: 0, delta, finish_reason: 'content' in delta ? null : 'stop' }] })}\n\n`);
  }
  response.end('data: [DONE]\n\n');
}

function requestTool(response: ServerResponse, proof: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const call = { index: 0, id: `fixture_${proof}`, type: 'function', function: {
    name: 'bash', arguments: JSON.stringify({ command: `printf fixture > ${proof}`, description: 'Write fixture proof' }),
  } };
  for (const delta of [{ role: 'assistant', tool_calls: [call] }, {}]) {
    response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1,
      model: 'fixture', choices: [{ index: 0, delta, finish_reason: 'tool_calls' in delta ? null : 'tool_calls' }] })}\n\n`);
  }
  response.end('data: [DONE]\n\n');
}

// Native bootstrap may fetch dependencies/catalogs; model inference stays on loopback.
// Optional preinstalled plugin dependencies avoid making bootstrap downloads part of this test.
test('CR41/CR42 native OpenCode recovery, activity, interruption and failure', {
  skip: process.env.BERTH_OPENCODE_LOCAL !== '1', timeout: 90_000,
}, async (t) => {
  let requests = 0;
  let responseMode: 'success' | 'hold' | 'error' | 'tool' = 'success';
  let toolIssued = false;
  let proof = 'approval-proof';
  let afterTool: ServerResponse | undefined;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const data = JSON.parse(body) as { messages?: { role: string; content: unknown }[] };
      const title = data.messages?.some((message) => message.role === 'system' && String(message.content).includes('title generator'));
      if (title) { complete(response); return; }
      requests += 1;
      if (responseMode === 'success') complete(response);
      if (responseMode === 'tool') {
        if (!toolIssued) { toolIssued = true; requestTool(response, proof); }
        else afterTool = response;
      }
      if (responseMode === 'error') {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Fixture authentication failure', type: 'authentication_error' } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const sb = sandbox(t, { opencode: { launch: 'opencode {args}', resume: 'opencode --session {conversation} {args}' } });
  for (const key of Object.keys(sb.env)) if (/KEY|TOKEN|SECRET|PASSWORD/.test(key)) delete sb.env[key];
  if (process.env.BERTH_OPENCODE_BIN_DIR) sb.env.PATH = `${process.env.BERTH_OPENCODE_BIN_DIR}:${sb.env.PATH}`;
  for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) {
    sb.env[key] = sb.makeDir(key.toLowerCase());
  }
  sb.env.TERM = 'xterm-256color';
  sb.env.OPENCODE_DISABLE_MODELS_FETCH = '1';
  const config = join(sb.env.XDG_CONFIG_HOME, 'opencode');
  mkdirSync(config, { recursive: true });
  if (process.env.BERTH_OPENCODE_FIXTURE_DEPS) cpSync(process.env.BERTH_OPENCODE_FIXTURE_DEPS, config, { recursive: true });
  writeFileSync(join(config, 'opencode.json'), JSON.stringify({
    permission: { bash: 'ask' }, autoupdate: false, share: 'disabled', model: 'fixture/fixture', small_model: 'fixture/fixture',
    enabled_providers: ['fixture'], provider: { fixture: {
      npm: '@ai-sdk/openai-compatible', name: 'Fixture',
      options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic-local' },
      models: { fixture: { name: 'Fixture', limit: { context: 32000, output: 1000 } } },
    } },
  }));
  installHooks('opencode', CLI, sb.env);
  const context = sb.ctx();
  create(context, { agent: 'opencode', name: 'native-opencode', cwd: sb.root });
  const pane = () => sb.tmux('capture-pane', '-p', '-t', '=native-opencode:');
  const row = () => list(context).find((session) => session.name === 'native-opencode');
  const submit = async (prompt: string) => {
    const before = requests;
    sb.tmux('send-keys', '-t', '=native-opencode:', '-l', prompt);
    await waitFor(() => pane().includes(prompt), 'rendered prompt', 5_000);
    sb.tmux('send-keys', '-t', '=native-opencode:', 'Enter');
    await waitFor(() => requests > before, 'native model request', 15_000);
  };
  const send = async (prompt: string) => {
    await submit(prompt);
    await waitFor(() => row()?.state === 'done', 'native completion', 10_000);
  };
  await waitFor(() => /Ask anything|What do you|Ask a question|Build/.test(pane()), 'native composer', 45_000);
  await send('fixture prompt 0');
  const id = row()?.conversation;
  assert.ok(id);
  killServer(sb);
  assert.equal(ensure(context)[0].outcome, 'resume-requested');
  await waitFor(() => pane().includes('Fixture complete.'), 'restored history', 10_000);
  await send('fixture prompt 1');
  await waitFor(() => row()?.recovery === 'confirmed', 'matching native acknowledgement', 10_000);
  assert.equal(row()?.conversation, id);
  responseMode = 'hold';
  await submit('fixture prompt 2');
  await waitFor(() => row()?.state === 'working', 'native working state', 10_000);
  await waitFor(() => pane().includes('esc interrupt'), 'interrupt control', 5_000);
  sb.tmux('send-keys', '-t', '=native-opencode:', 'Escape');
  await waitFor(() => pane().includes('again'), 'interrupt confirmation', 5_000);
  sb.tmux('send-keys', '-t', '=native-opencode:', 'Escape');
  await waitFor(() => row()?.state === '', 'interruption clears activity', 10_000);
  assert.equal(row()?.note ?? '', '');
  responseMode = 'success';
  await send('fixture prompt 3');
  responseMode = 'error';
  await submit('fixture prompt 4');
  await waitFor(() => row()?.state === '', 'provider failure clears activity', 10_000);
  assert.equal(row()?.note ?? '', '');
  responseMode = 'success';
  await send('fixture prompt 5');
  responseMode = 'tool';
  await submit('fixture prompt 6');
  await waitFor(() => row()?.state === 'waiting' && pane().includes('Allow once'), 'permission approval', 10_000);
  sb.tmux('send-keys', '-t', '=native-opencode:', 'Enter');
  await waitFor(() => !!afterTool && row()?.state === 'working', 'approved tool resumes model', 10_000);
  assert.equal(readFileSync(join(sb.root, proof), 'utf8'), 'fixture');
  complete(afterTool!);
  await waitFor(() => row()?.state === 'done', 'approved turn completes', 10_000);
  proof = 'rejection-proof';
  toolIssued = false;
  afterTool = undefined;
  await submit('fixture prompt 7');
  await waitFor(() => row()?.state === 'waiting' && pane().includes('Allow once'), 'permission rejection', 10_000);
  sb.tmux('send-keys', '-t', '=native-opencode:', 'Right', 'Right', 'Enter');
  await waitFor(() => row()?.state === '', 'rejection clears activity', 10_000);
  assert.equal(existsSync(join(sb.root, proof)), false);
  assert.equal(row()?.note ?? '', '');
  responseMode = 'success';
  await send('fixture prompt 8');
  assert.equal(row()?.conversation, id);
});
