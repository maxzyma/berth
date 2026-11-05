import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
/** Opt-in native Codex lifecycle test using only a loopback model fixture.
 * BERTH_CODEX_LOCAL=1 enables it. HOME, hooks, config and tmux are isolated.
 * The trust bypass is limited to this fixture's inspected Berth commands;
 * production launch templates never add it.
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, waitFor, CLI, killServer, type Sandbox } from '../helpers.js';
import { upgradeCodexHooks } from '../../src/agents/hook-upgrade.js';
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

for (const legacy of [false, true]) test(`CR33 native Codex reports turns and exact-ID recovery through loopback-only inference (legacy upgrade: ${legacy})`, {
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
  const hookFile = installHooks('codex', CLI, sb.env);
  if (legacy) {
    const hooks = JSON.parse(readFileSync(hookFile, 'utf8')).hooks;
    writeFileSync(hookFile, JSON.stringify({ hooks: { SessionStart: hooks.SessionStart, Stop: hooks.Stop } }));
  }
  const ctx = sb.ctx();
  create(ctx, { agent: 'codex', cwd: sb.root, name: 'native-codex' });
  const pane = () => sb.tmux('capture-pane', '-p', '-t', '=native-codex:');
  const row = () => list(ctx).find((value) => value.name === 'native-codex');
  await waitFor(() => /Ask Codex to do anything/.test(pane()), 'Codex composer', 12_000);
  if (legacy) {
    ctx.tmux.setMeta('native-codex', { conversation: '', profile: '', state: '', topic: '' });
    assert.equal(upgradeCodexHooks(CLI, sb.env).changed, true);
  }
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

test('native Codex viewport observes activity and identity candidates without hooks or launcher integration', {
  skip: !enabled || !installed, timeout: 60_000,
}, async t => {
  const { codexScreen } = await import('../../src/agents/codex-screen.js');
  const { inventory } = await import('../../src/registry/sessions.js');
  const { responses, baseUrl } = await modelFixture(t);
  t.after(() => { serverProcess?.kill('SIGTERM'); });
  let serverProcess: ReturnType<typeof spawn> | undefined;
  const sb = sandbox(t, { codex: { launch: 'codex', resume: 'codex resume {conversation} {args}' } });
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL']) delete sb.env[key];
  sb.env.CODEX_HOME = sb.makeDir('codex-home');
  sb.env.TERM = 'xterm-256color';
  writeFileSync(join(sb.env.CODEX_HOME, 'config.toml'), [
    'model = "mock-model"', 'model_provider = "fixture"', 'check_for_update_on_startup = false',
    '[model_providers.fixture]', 'name = "Local fixture"',
    `base_url = ${JSON.stringify(baseUrl)}`, 'wire_api = "responses"', 'requires_openai_auth = false',
    `[projects.${JSON.stringify(sb.root)}]`, 'trust_level = "trusted"', '[analytics]', 'enabled = false',
    '[tui]', 'status_line = ["session-id", "status"]',
  ].join('\n'));
  const endpoint = `unix://${join(tmpdir(), `berth-codex-${randomUUID().slice(0, 8)}.sock`)}`;
  serverProcess = spawn('codex', ['app-server', '--listen', endpoint], {
    env: { ...sb.env, TMUX: '/nonexistent-fixture/socket,999999,0', TMUX_PANE: '%999' }, stdio: 'ignore',
  });
  await waitFor(() => existsSync(endpoint.slice(7)), 'isolated server socket');
  const nativeCommand = `codex --remote ${endpoint} --no-alt-screen`;
  const ctx = sb.ctx();
  ctx.tmux.newSession('screen-native', sb.root, nativeCommand);
  sb.tmux('resize-window', '-t', '=screen-native:', '-x', '120', '-y', '40');
  const pane = () => sb.tmux('capture-pane', '-p', '-S', '0', '-t', '=screen-native:');
  const read = () => codexScreen(pane());
  const first = await waitFor(() => read()?.conversationCandidate, 'native footer identity', 12_000);
  sb.tmux('send-keys', '-t', '=screen-native:', '-l', 'fixture prompt 0');
  await waitFor(() => pane().includes('› fixture prompt 0'), 'composer');
  sb.tmux('send-keys', '-t', '=screen-native:', 'Enter');
  await waitFor(() => responses.has(0), 'local model request', 10_000).catch(error => { throw new Error(`${error.message}\n${pane()}`); });
  await waitFor(() => inventory(ctx).find(row => row.name === 'screen-native')?.state === 'working', 'passive working');
  await waitFor(() => {
    inventory(ctx);
    return ctx.tmux.listSessions()[0].meta.nativeCodexSelection;
  }, 'verified native selection');
  const { sessionProducers: producers } = await import('../../src/registry/discover.js');
  const { codexRuntime } = await import('../../src/agents/codex-process.js');
  const { codexProcessBinding } = await import('../../src/agents/codex-binding.js');
  const runtime = codexRuntime(producers(ctx, 'screen-native')[0].pid)!;
  assert.equal(codexProcessBinding(runtime.pid, runtime.lifetime), undefined, 'fixture must exercise daemon-owned rollout');
  assert.equal(ctx.tmux.listSessions()[0].meta.conversation, first);
  assert.equal(ctx.tmux.listSessions()[0].meta.state, 'working');
  assert.equal(ctx.tmux.listSessions()[0].meta.topic, 'fixture prompt 0');
  assert.ok(inventory(ctx).find(row => row.name === 'screen-native')?.activityTiming?.turnStartedAt);
  complete(responses.get(0)!, 'screen-turn', 'Fixture screen complete.');
  await waitFor(() => read()?.working === false, 'native no longer working');
  await waitFor(() => inventory(ctx).find(row => row.name === 'screen-native')?.state === 'done', 'native completion');
  const completedAt = inventory(ctx).find(row => row.name === 'screen-native')?.activityTiming?.stateSince;
  assert.ok(completedAt);
  assert.equal(inventory(ctx).find(row => row.name === 'screen-native')?.activityTiming?.stateSince, completedAt);
  ctx.tmux.newSession('screen-second', sb.root, nativeCommand);
  sb.tmux('resize-window', '-t', '=screen-second:', '-x', '120', '-y', '40');
  const secondPane = () => sb.tmux('capture-pane', '-p', '-S', '0', '-t', '=screen-second:');
  const second = await waitFor(() => codexScreen(secondPane())?.conversationCandidate, 'second native identity');
  assert.notEqual(second, first);
  sb.tmux('send-keys', '-t', '=screen-second:', '-l', 'fixture prompt 1');
  await waitFor(() => secondPane().includes('› fixture prompt 1'), 'second composer');
  sb.tmux('send-keys', '-t', '=screen-second:', 'Enter');
  await waitFor(() => responses.has(1), 'second model request');
  await waitFor(() => inventory(ctx).find(row => row.name === 'screen-second')?.conversation === second, 'second binding');
  assert.equal(list(ctx).find(row => row.name === 'screen-native')?.conversation, first);
  assert.equal(list(ctx).find(row => row.name === 'screen-native')?.topic, 'fixture prompt 0');
  assert.equal(list(ctx).find(row => row.name === 'screen-second')?.topic, 'fixture prompt 1');
  complete(responses.get(1)!, 'second-turn', 'Second fixture complete.');
  await waitFor(() => inventory(ctx).find(row => row.name === 'screen-second')?.state === 'done', 'second completion');
  assert.ok(serverProcess.pid && serverProcess.exitCode === null, 'both clients use the explicit shared server');
  killServer(sb);
  assert.ok(ensure(ctx).every(row => row.outcome === 'resume-requested'));
  await waitFor(() => {
    const rows = inventory(ctx);
    return rows.length === 2 && rows.every(row => row.recovery === 'confirmed');
  }, 'native exact-ID recovery for both sessions', 12_000);
  assert.equal(list(ctx).find(row => row.name === 'screen-native')?.conversation, first);
  assert.equal(list(ctx).find(row => row.name === 'screen-second')?.conversation, second);
  ctx.tmux.setMeta('screen-native', { producerPane: '', producerLifetime: '' });
  await waitFor(() => inventory(ctx).find(row => row.name === 'screen-native')?.bindingIssue === undefined, 'legacy ownership verified');
  sb.tmux('send-keys', '-t', '=screen-native:', '-l', '/new');
  await waitFor(() => pane().includes('› /new'), 'new composer');
  sb.tmux('send-keys', '-t', '=screen-native:', 'Enter');
  await waitFor(() => read()?.conversationCandidate && read()?.conversationCandidate !== first, 'new native identity');
  sb.tmux('resize-window', '-t', '=screen-native:', '-x', '25', '-y', '40');
  await waitFor(() => !read()?.conversationCandidate, 'truncated identity rejected');
  inventory(ctx);
  assert.match(ctx.tmux.listSessions()[0].meta.bindingIssue || '', /not verified/);
  assert.equal(ctx.tmux.listSessions()[0].meta.state, undefined);
});

test('native default-footer preview works without hooks or a conversation binding', {
  skip: !enabled || !installed, timeout: 30_000,
}, async t => {
  const { inventory } = await import('../../src/registry/sessions.js');
  const { responses, baseUrl } = await modelFixture(t);
  let daemon: ReturnType<typeof spawn> | undefined;
  t.after(() => {
    if (!daemon?.pid) return;
    try { process.kill(-daemon.pid, 'SIGKILL'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  });
  const sb = sandbox(t, { codex: { launch: 'codex', resume: 'codex resume {conversation} {args}' } });
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL']) delete sb.env[key];
  sb.env.CODEX_HOME = sb.makeDir('codex-home');
  sb.env.TERM = 'xterm-256color';
  const configPath = join(sb.env.CODEX_HOME, 'config.toml');
  const config = [
    'model = "gpt-5.4"', 'model_provider = "fixture"', 'check_for_update_on_startup = false',
    '[model_providers.fixture]', 'name = "Local fixture"',
    `base_url = ${JSON.stringify(baseUrl)}`, 'wire_api = "responses"', 'requires_openai_auth = false',
    `[projects.${JSON.stringify(sb.root)}]`, 'trust_level = "trusted"', '[analytics]', 'enabled = false',
  ].join('\n');
  writeFileSync(configPath, config);
  const endpoint = `unix://${join(tmpdir(), `berth-preview-${randomUUID().slice(0, 8)}.sock`)}`;
  daemon = spawn('codex', ['app-server', '--listen', endpoint], { env: sb.env, stdio: 'ignore', detached: true });
  await waitFor(() => existsSync(endpoint.slice(7)), 'preview server socket');
  const ctx = sb.ctx();
  ctx.tmux.newSession('preview', sb.root, `codex --remote ${endpoint} --no-alt-screen`);
  sb.tmux('resize-window', '-t', '=preview:', '-x', '120', '-y', '40');
  const pane = () => sb.tmux('capture-pane', '-p', '-S', '0', '-t', '=preview:');
  try { await waitFor(() => pane().includes('›'), 'default composer'); }
  catch (error) { throw new Error(`${error}\n${pane()}`); }
  sb.tmux('send-keys', '-t', '=preview:', '-l', 'fixture prompt 0');
  await waitFor(() => pane().includes('› fixture prompt 0'), 'draft');
  const nativeConfig = readFileSync(configPath, 'utf8');
  assert.equal(inventory(ctx)[0].terminalPreview, undefined, 'unsent draft is not a preview');
  sb.tmux('send-keys', '-t', '=preview:', 'Enter');
  await waitFor(() => responses.has(0), 'preview model request');
  const row = await waitFor(() => {
    const value = inventory(ctx)[0];
    return value?.state === 'working' && value.terminalPreview === 'fixture prompt 0' ? value : undefined;
  }, 'unbound live preview').catch(error => {
    const diagnostic = JSON.stringify(inventory(ctx)[0]);
    complete(responses.get(0)!, 'failed-preview', 'Fixture stopped.');
    throw new Error(`${error.message}\n${pane()}\n${diagnostic}`);
  });
  assert.equal(row.conversation, '');
  assert.equal(row.topic, '');
  assert.equal(row.activityTiming, undefined, 'screen observation cannot invent event time');
  assert.equal(ctx.tmux.listSessions()[0].meta.topic, undefined);
  complete(responses.get(0)!, 'preview-turn', 'Fixture complete.');
  await waitFor(() => !pane().includes('esc to interrupt'), 'preview completed');
  assert.notEqual(inventory(ctx)[0].state, 'done', 'screen observation cannot produce completion');
  assert.equal(readFileSync(configPath, 'utf8'), nativeConfig, 'observer must preserve native configuration');
});
