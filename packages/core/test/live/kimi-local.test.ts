/** Opt-in native Kimi lifecycle test. All model inference stays on loopback. */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, waitFor, CLI, killServer, type Sandbox } from '../helpers.js';
import { installHooks } from '../../src/agents/hooks.js';
import { create, list } from '../../src/registry/sessions.js';
import { ensure } from '../../src/restore/ensure.js';
import type { Context } from '../../src/context.js';

type Request = { response: ServerResponse; body: string };
async function fixture(t: TestContext) {
  const requests: Request[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
      requests.push({ response, body });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { requests, url: `http://127.0.0.1:${address.port}/v1` };
}

function complete(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const delta of [{ role: 'assistant', content: 'Fixture complete.' }, {}]) {
    response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason: 'content' in delta ? null : 'stop' }] })}\n\n`);
  }
  response.end('data: [DONE]\n\n');
}

const pane = (sb: Sandbox) => sb.tmux('capture-pane', '-p', '-t', '=native-kimi:');
const row = (ctx: Context) => list(ctx).find((item) => item.name === 'native-kimi');
async function composer(sb: Sandbox): Promise<void> {
  await waitFor(() => /context:|Update Available/.test(pane(sb)), 'Kimi composer or update prompt', 10_000);
  if (pane(sb).includes('Update Available')) sb.tmux('send-keys', '-t', '=native-kimi:', 'Escape');
  await waitFor(() => pane(sb).includes('context:'), 'Kimi composer', 10_000);
}

async function requestTurn(sb: Sandbox, ctx: Context, requests: Request[], index: number): Promise<Request> {
  await composer(sb);
  const prompt = `fixture prompt ${index}`;
  sb.tmux('send-keys', '-t', '=native-kimi:', '-l', prompt);
  await waitFor(() => pane(sb).includes(prompt), 'rendered prompt', 5000);
  sb.tmux('send-keys', '-t', '=native-kimi:', 'Enter');
  await waitFor(() => requests.length > 0 && row(ctx)?.state === 'working', 'Kimi model request and working state', 10_000);
  const request = requests.shift()!;
  assert.ok(request.body.includes('Fixture agent identity'), 'original custom agent remains bound');
  return request;
}

async function turn(sb: Sandbox, ctx: Context, requests: Request[], index: number, interrupt = false): Promise<void> {
  const request = await requestTurn(sb, ctx, requests, index);
  if (interrupt) {
    sb.tmux('send-keys', '-t', '=native-kimi:', 'Escape');
    await waitFor(() => row(ctx)?.state === '', 'Kimi interruption', 10_000);
    assert.equal(row(ctx)?.note, '');
  } else {
    complete(request.response);
    await waitFor(() => row(ctx)?.state === 'done', 'Kimi Stop', 10_000);
  }
}

function toolCall(response: ServerResponse, index: number): void {
  const call = { index: 0, id: `call-${index}`, type: 'function', function: { name: 'Bash',
    arguments: JSON.stringify({ command: `printf fixture-proof > fixture-proof-${index}`, description: 'Write isolated fixture proof' }) } };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const delta of [{ role: 'assistant', tool_calls: [call] }, {}]) {
    response.write(`data: ${JSON.stringify({ id: 'fixture-tool', object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason: 'tool_calls' in delta ? null : 'tool_calls' }] })}\n\n`);
  }
  response.end('data: [DONE]\n\n');
}

async function decision(sb: Sandbox, ctx: Context, requests: Request[], index: number, approve: boolean): Promise<void> {
  toolCall((await requestTurn(sb, ctx, requests, index)).response, index);
  await waitFor(() => row(ctx)?.state === 'waiting' && pane(sb).includes('Approve once'), 'Kimi approval prompt', 10_000);
  if (!approve) sb.tmux('send-keys', '-t', '=native-kimi:', '3');
  sb.tmux('send-keys', '-t', '=native-kimi:', 'Enter');
  await waitFor(() => requests.length > 0 && row(ctx)?.state === 'working', 'Kimi decision continues turn', 10_000);
  const file = join(sb.root, `fixture-proof-${index}`);
  if (approve) assert.equal(readFileSync(file, 'utf8'), 'fixture-proof');
  else assert.equal(existsSync(file), false, 'denied command did not execute');
  complete(requests.shift()!.response);
  await waitFor(() => row(ctx)?.state === 'done', 'completed turn after decision', 10_000);
}

async function failedTurn(sb: Sandbox, ctx: Context, requests: Request[], index: number): Promise<void> {
  const request = await requestTurn(sb, ctx, requests, index);
  request.response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({
    error: { message: 'Synthetic fixture authentication failure', type: 'authentication_error' },
  }));
  await waitFor(() => pane(sb).includes('provider.auth_error') && row(ctx)?.state === '', 'failed turn clears activity', 10_000);
  assert.equal(row(ctx)?.note, '');
}

const enabled = process.env.BERTH_KIMI_LOCAL === '1';
const installed = enabled && spawnSync('kimi', ['--version']).status === 0;
test('CR37/CR38 native Kimi restores a custom agent and clears interrupted work', {
  skip: !enabled ? 'set BERTH_KIMI_LOCAL=1 for the native fixture' : !installed ? 'kimi not installed' : false,
  timeout: 60_000,
}, async (t) => {
  const { requests, url } = await fixture(t);
  const sb = sandbox(t, { kimi: { launch: 'kimi {args}', resume: 'kimi --session {conversation} {args}' } });
  for (const key of Object.keys(sb.env)) if (/KEY|TOKEN|SECRET|PASSWORD/.test(key)) delete sb.env[key];
  sb.env.KIMI_CODE_HOME = sb.makeDir('kimi-home');
  sb.env.TERM = 'xterm-256color';
  writeFileSync(join(sb.env.KIMI_CODE_HOME, 'config.toml'), [
    'default_model="fixture"', 'telemetry=false', 'auto_session_title=false', 'disable_feedback_survey=true',
    '[workspace]', 'require_trust=false', '[providers.fixture]', 'type="openai"',
    `base_url=${JSON.stringify(url)}`, 'api_key="synthetic-local-only"', '[models.fixture]',
    'provider="fixture"', 'model="fixture"', 'max_context_size=32000', 'capabilities=[]',
  ].join('\n'));
  writeFileSync(join(sb.env.KIMI_CODE_HOME, 'tui.toml'), 'disable_paste_burst=true\nauto_session_title=false\ncache_expiry_hint=false\n[upgrade]\nauto_install=false\n');
  const agent = join(sb.root, 'fixture-agent.md');
  writeFileSync(agent, '---\nname: fixture-agent\ndescription: Isolated lifecycle verification\ntools: [Bash]\n---\nFixture agent identity. Return a short answer.\n');
  installHooks('kimi', CLI, sb.env);
  const ctx = sb.ctx();
  create(ctx, { agent: 'kimi', name: 'native-kimi', cwd: sb.root, extraArgs: ['--agent-file', agent] });
  await waitFor(() => Boolean(row(ctx)?.conversation), 'Kimi binding', 10_000);
  const conversation = row(ctx)!.conversation;
  await turn(sb, ctx, requests, 0);
  killServer(sb);
  assert.equal(ensure(ctx)[0].outcome, 'resume-requested');
  await composer(sb);
  await waitFor(() => row(ctx)?.recovery === 'confirmed', 'Kimi recovery acknowledgement', 10_000);
  assert.equal(row(ctx)?.conversation, conversation);
  await turn(sb, ctx, requests, 1);
  await turn(sb, ctx, requests, 2, true);
  await turn(sb, ctx, requests, 3);
  await decision(sb, ctx, requests, 4, true);
  await decision(sb, ctx, requests, 5, false);
  await failedTurn(sb, ctx, requests, 6);
  await turn(sb, ctx, requests, 7);
  assert.equal(row(ctx)?.conversation, conversation);
});
