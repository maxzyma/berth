/** Opt-in native Codex lifecycle test using only a loopback model fixture.
 * BERTH_CODEX_LOCAL=1 enables it. HOME, hooks, config and tmux are isolated.
 * The trust bypass is limited to this fixture's inspected Berth commands;
 * production launch templates never add it.
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, waitFor, CLI, killServer, type Sandbox } from '../helpers.js';
import { installHooks } from '../../src/agents/hooks.js';
import { ensure } from '../../src/restore/ensure.js';
import type { Context } from '../../src/context.js';
import { create, list } from '../../src/registry/sessions.js';

function complete(response: ServerResponse, id: string, text: string): void {
  const item = { type: 'message', id: `${id}-message`, role: 'assistant', content: [{ type: 'output_text', text }] };
  const result = { id, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [
    { type: 'response.created', response: { id } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: result },
  ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end();
}

async function runTurn(sb: Sandbox, ctx: Context, responses: Map<number, ServerResponse>, turn: number): Promise<string> {
  const pane = () => sb.tmux('capture-pane', '-p', '-t', '=native-codex:');
  const row = () => list(ctx).find((value) => value.name === 'native-codex');
  const prompt = `fixture prompt ${turn}`;
  sb.tmux('send-keys', '-t', '=native-codex:', '-l', prompt);
  await waitFor(() => pane().includes(`› ${prompt}`), 'rendered prompt', 5000);
  sb.tmux('send-keys', '-t', '=native-codex:', 'Enter');
  await waitFor(() => row()?.state === 'working' && row()?.topic === prompt, 'Codex UserPromptSubmit', 10_000);
  await waitFor(() => responses.has(turn), 'local model request', 10_000);
  assert.ok(row()?.conversation);
  const conversation = row()!.conversation;
  complete(responses.get(turn)!, `turn-${turn}`, 'Fixture complete.');
  await waitFor(() => row()?.state === 'done', 'Codex Stop', 10_000);
  return conversation;
}

async function approveAndInterrupt(sb: Sandbox, ctx: Context, responses: Map<number, ServerResponse>, turn = 3, approve = true): Promise<void> {
  const pane = () => sb.tmux('capture-pane', '-p', '-t', '=native-codex:');
  const row = () => list(ctx).find((value) => value.name === 'native-codex');
  sb.tmux('send-keys', '-t', '=native-codex:', '-l', `fixture prompt ${turn}`);
  await waitFor(() => pane().includes(`› fixture prompt ${turn}`), 'rendered prompt', 5000);
  sb.tmux('send-keys', '-t', '=native-codex:', 'Enter');
  await waitFor(() => responses.has(turn), 'tool request', 10_000);
  const response = responses.get(turn)!;
  responses.delete(turn);
  const item = { type: 'function_call', id: 'tool-item', call_id: 'tool-call', name: 'exec_command',
    arguments: JSON.stringify({ cmd: `printf fixture-approved > fixture-command-${turn}`, sandbox_permissions: 'require_escalated', justification: 'Run the harmless local fixture command?' }) };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [{ type: 'response.created', response: { id: 'tool' } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'tool', status: 'completed', output: [item] } }]) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end();
  await waitFor(() => row()?.state === 'waiting' && /Would you like|Yes, proceed/.test(pane()), 'native approval', 10_000);
  assert.ok(row()?.note, 'approval has an explanation');
  if (!approve) sb.tmux('send-keys', '-t', '=native-codex:', '3');
  sb.tmux('send-keys', '-t', '=native-codex:', 'Enter');
  if (approve) {
    await waitFor(() => responses.has(turn) && row()?.state === 'working', 'post-tool working state', 10_000);
    assert.ok(existsSync(join(sb.root, `fixture-command-${turn}`)));
    sb.tmux('send-keys', '-t', '=native-codex:', 'Escape');
  } else {
    await waitFor(() => /You canceled the request/.test(pane()), 'native rejection', 10_000);
    assert.equal(existsSync(join(sb.root, `fixture-command-${turn}`)), false, 'denied command must not run');
  }
  await waitFor(() => /Conversation interrupted/.test(pane()) && row()?.state === '', 'interrupted activity cleared', 10_000);
  assert.equal(row()?.note, '');
}

async function modelFixture(t: TestContext) {
  const responses = new Map<number, ServerResponse>();
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      if (request.url !== '/v1/responses') { response.writeHead(404).end(); return; }
      try {
        const data = JSON.parse(body);
        const prompts = (data.input ?? []).filter((item: { role?: string }) => item.role === 'user')
          .flatMap((item: { content?: { text?: string }[] }) => (item.content ?? []).map((part) => part.text ?? ''));
        const match = /^fixture prompt (\d+)$/.exec(prompts.at(-1) ?? '');
        if (match) responses.set(Number(match[1]), response);
        else complete(response, 'title', 'Fixture title'); // Background title requests are not turns.
      } catch { response.writeHead(400).end(); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { responses, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

const enabled = process.env.BERTH_CODEX_LOCAL === '1';
const installed = enabled && spawnSync('codex', ['--version']).status === 0;

test('CR33 native Codex reports turns and exact-ID recovery through loopback-only inference', {
  skip: !enabled ? 'set BERTH_CODEX_LOCAL=1 for the local native CLI fixture' : !installed ? 'codex not installed' : false,
  timeout: 45_000,
}, async (t) => {
  const { responses, baseUrl } = await modelFixture(t);
  const sb = sandbox(t, { codex: { launch: 'codex --dangerously-bypass-hook-trust --no-alt-screen -a on-request -s read-only', resume: 'codex resume {conversation} {args}' } });
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL']) delete sb.env[key];
  sb.env.CODEX_HOME = sb.makeDir('codex-home');
  sb.env.TERM = 'xterm-256color';
  writeFileSync(join(sb.env.CODEX_HOME, 'config.toml'), [
    'model = "mock-model"', 'model_provider = "fixture"', 'check_for_update_on_startup = false',
    '[model_providers.fixture]', 'name = "Local fixture"',
    `base_url = ${JSON.stringify(baseUrl)}`, 'wire_api = "responses"', 'requires_openai_auth = false',
    `[projects.${JSON.stringify(sb.root)}]`, 'trust_level = "trusted"', '[analytics]', 'enabled = false',
  ].join('\n'));
  installHooks('codex', CLI, sb.env);
  const ctx = sb.ctx();
  create(ctx, { agent: 'codex', cwd: sb.root, name: 'native-codex' });
  const pane = () => sb.tmux('capture-pane', '-p', '-t', '=native-codex:');
  const row = () => list(ctx).find((value) => value.name === 'native-codex');
  await waitFor(() => /Ask Codex to do anything/.test(pane()), 'Codex composer', 12_000);
  const conversation = await runTurn(sb, ctx, responses, 0);
  assert.equal(await runTurn(sb, ctx, responses, 1), conversation);
  killServer(sb);
  assert.equal(ensure(ctx)[0].outcome, 'resume-requested');
  await waitFor(() => /Fixture complete/.test(pane()), 'native resumed history', 12_000);
  assert.equal(await runTurn(sb, ctx, responses, 2), conversation);
  await waitFor(() => row()?.recovery === 'confirmed', 'native exact-ID recovery acknowledgement', 10_000);
  await approveAndInterrupt(sb, ctx, responses);
  assert.equal(await runTurn(sb, ctx, responses, 4), conversation);
  await approveAndInterrupt(sb, ctx, responses, 5, false);
  assert.equal(await runTurn(sb, ctx, responses, 6), conversation);
});
