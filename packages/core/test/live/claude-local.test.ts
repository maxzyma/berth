import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, waitFor, CLI, killServer } from '../helpers.js';
import { installHooks } from '../../src/agents/hooks.js';
import { create, inventory, list } from '../../src/registry/sessions.js';
import { ensure } from '../../src/restore/ensure.js';

function reply(response: ServerResponse, model: string, tool = false): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (type: string, data: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send('message_start', { message: { id: 'msg_fixture', type: 'message', role: 'assistant', model,
    content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  send('content_block_start', { index: 0, content_block: tool
    ? { type: 'tool_use', id: 'tool_fixture', name: 'Bash', input: {} } : { type: 'text', text: '' } });
  send('content_block_delta', { index: 0, delta: tool
    ? { type: 'input_json_delta', partial_json: JSON.stringify({ command: 'printf fixture > permission-proof', description: 'Write fixture proof' }) }
    : { type: 'text_delta', text: 'Fixture complete.' } });
  send('content_block_stop', { index: 0 });
  send('message_delta', { delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  send('message_stop', {});
  response.end();
}

test('CR44 native Claude recovery, failures, approvals, cancellation and denial', {
  skip: process.env.BERTH_CLAUDE_LOCAL !== '1', timeout: 90_000,
}, async (t) => {
  let requests = 0;
  let mode: 'success' | 'error' | 'tool' | 'hold' = 'success';
  let toolIssued = false;
  let afterTool: { response: ServerResponse; model: string } | undefined;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const data = JSON.parse(body || '{}') as { model: string; tools?: { name: string }[] };
      if (request.url?.includes('count_tokens')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ input_tokens: 10 }));
        return;
      }
      if (!data.tools?.some((tool) => tool.name === 'Bash')) { reply(response, data.model); return; }
      requests += 1;
      if (mode === 'success') reply(response, data.model);
      if (mode === 'error') {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Fixture invalid request' } }));
      }
      if (mode === 'tool') {
        if (!toolIssued) { toolIssued = true; reply(response, data.model, true); }
        else afterTool = { response, model: data.model };
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'claude --model sonnet --strict-mcp-config --setting-sources user --permission-mode default --tools Bash';
  const sb = sandbox(t, { claude: { launch: `${base} {args}`, resume: `${base} --resume {conversation} {args}` } });
  for (const key of Object.keys(sb.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/.test(key) || key.startsWith('ANTHROPIC_') || key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_USE_')) delete sb.env[key];
  }
  sb.env.CLAUDE_CONFIG_DIR = sb.makeDir('claude-profile');
  sb.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`;
  sb.env.ANTHROPIC_API_KEY = 'synthetic-local';
  sb.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  sb.env.DISABLE_AUTOUPDATER = '1';
  sb.env.TERM = 'xterm-256color';
  const config = { hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.310', theme: 'dark',
    customApiKeyResponses: { approved: ['synthetic-local'], rejected: [] },
    projects: Object.fromEntries([sb.root, realpathSync(sb.root)].map((path) => [path, { hasTrustDialogAccepted: true, allowedTools: [], mcpServers: {} }])) };
  // Trust only the empty fixture directory; use no real credentials or daily profile.
  for (const file of [join(sb.env.HOME, '.claude.json'), join(sb.env.CLAUDE_CONFIG_DIR, '.claude.json')]) writeFileSync(file, JSON.stringify(config));
  installHooks('claude', CLI, sb.env);
  const context = sb.ctx();
  create(context, { agent: 'claude', name: 'native-claude', cwd: sb.root });
  const pane = () => sb.tmux('capture-pane', '-p', '-t', '=native-claude:');
  const row = () => list(context).find((session) => session.name === 'native-claude');
  const submit = async (prompt: string) => {
    const before = requests;
    sb.tmux('send-keys', '-t', '=native-claude:', '-l', prompt);
    await waitFor(() => pane().includes(prompt), 'rendered prompt', 5_000);
    sb.tmux('send-keys', '-t', '=native-claude:', 'Enter');
    await waitFor(() => requests > before, 'native model request', 15_000);
  };
  const send = async (prompt: string) => {
    await submit(prompt);
    await waitFor(() => row()?.state === 'done', 'native completion', 15_000);
  };
  await waitFor(() => row()?.conversation, 'native binding', 30_000);
  await waitFor(() => pane().includes('❯'), 'native composer', 10_000);
  await send('fixture prompt 0');
  const id = row()?.conversation;
  assert.ok(id);
  killServer(sb);
  assert.equal(ensure(context)[0].outcome, 'resume-requested');
  await waitFor(() => row()?.recovery === 'confirmed', 'matching native recovery', 15_000);
  await waitFor(() => pane().includes('❯'), 'restored composer', 10_000);
  mode = 'error';
  await submit('fixture prompt 1');
  await waitFor(() => row()?.state === '', 'failure clears activity', 15_000);
  assert.equal(row()?.note ?? '', '');
  mode = 'success';
  await send('fixture prompt 2');
  mode = 'tool';
  await submit('fixture prompt 3');
  await waitFor(() => row()?.state === 'waiting' && pane().includes('Do you want to proceed?'), 'native approval', 10_000);
  sb.tmux('send-keys', '-t', '=native-claude:', 'Enter');
  await waitFor(() => !!afterTool && row()?.state === 'working', 'completed batch resumes model', 15_000);
  assert.equal(readFileSync(join(sb.root, 'permission-proof'), 'utf8'), 'fixture');
  reply(afterTool!.response, afterTool!.model);
  await waitFor(() => row()?.state === 'done', 'approved turn completion', 10_000);
  mode = 'success';
  await send('fixture prompt 4');
  mode = 'hold';
  await submit('fixture cancelled prompt');
  assert.equal(row()?.state, 'working');
  sb.tmux('send-keys', '-t', '=native-claude:', 'Escape');
  await waitFor(() => inventory(context).find((s) => s.name === 'native-claude')?.state === '', 'native cancellation reconciliation', 15_000);
  assert.equal(row()?.note ?? '', '');
  mode = 'success';
  await send('fixture after cancellation');
  inventory(context);
  assert.equal(row()?.state, 'done');
  unlinkSync(join(sb.root, 'permission-proof'));
  mode = 'tool';
  toolIssued = false;
  await submit('fixture denied prompt');
  await waitFor(() => row()?.state === 'waiting' && pane().includes('Do you want to proceed?'), 'approval to deny', 10_000);
  sb.tmux('send-keys', '-t', '=native-claude:', 'Down', 'Down', 'Down');
  await waitFor(() => pane().includes('❯ 4. No'), 'deny selected', 5_000);
  sb.tmux('send-keys', '-t', '=native-claude:', 'Enter');
  await waitFor(() => inventory(context).find((s) => s.name === 'native-claude')?.state === '', 'native denial reconciliation', 15_000);
  assert.equal(existsSync(join(sb.root, 'permission-proof')), false);
  mode = 'success';
  await send('fixture after denial');
  assert.equal(row()?.conversation, id);
});
