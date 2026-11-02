/** Opt-in native Copilot identity test using an offline loopback provider. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { sandbox, waitFor, CLI, killServer } from '../helpers.js';
import { installHooks } from '../../src/agents/hooks.js';
import { create, list, inventory } from '../../src/registry/sessions.js';
import { ensure } from '../../src/restore/ensure.js';

interface Request { messages?: unknown; stream?: boolean }

test('native Copilot offline binding, completion and exact-ID recovery', {
  skip: process.env.BERTH_COPILOT_LOCAL !== '1', timeout: 90_000,
}, async (t) => {
  const requests: Request[] = [];
  let mode: 'success' | 'failure' | 'held' | 'tools' = 'success';
  let toolCommands: string[] = [];
  let heldResponses: Array<() => void> = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') {
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-4o', object: 'model' }] }));
        return;
      }
      let payload: Request;
      try { payload = JSON.parse(body); }
      catch { res.writeHead(400).end(); return; }
      requests.push(payload);
      if (mode === 'failure') {
        res.writeHead(401).end(JSON.stringify({ error: { message: 'Fixture authentication failure', type: 'authentication_error' } }));
        return;
      }
      if (mode === 'tools') {
        mode = 'held';
        const tool_calls = toolCommands.map((command, index) => ({ index, id: `fixture-${requests.length}-${index}`,
          type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command, description: 'Write isolated marker' }) } }));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const [delta, finish_reason] of [[{ role: 'assistant', tool_calls }, null], [{}, 'tool_calls']]) {
          res.write(`data: ${JSON.stringify({ id: 'tool', object: 'chat.completion.chunk', model: 'gpt-4o',
            choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        }
        res.end('data: [DONE]\n\n');
        return;
      }
      if (mode === 'held') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'held', object: 'chat.completion.chunk', model: 'gpt-4o',
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);
        heldResponses = [...heldResponses, () => {
          if (res.destroyed) return;
          res.write(`data: ${JSON.stringify({ id: 'held', object: 'chat.completion.chunk', model: 'gpt-4o',
            choices: [{ index: 0, delta: { content: 'Fixture complete.' }, finish_reason: 'stop' }] })}\n\n`);
          res.end('data: [DONE]\n\n');
        }];
        return;
      }
      const message = { role: 'assistant', content: 'Fixture complete.' };
      if (payload.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const [delta, finish_reason] of [[message, null], [{}, 'stop']]) {
          res.write(`data: ${JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk',
            created: 1, model: 'gpt-4o', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        }
        res.end('data: [DONE]\n\n');
      } else {
        res.end(JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion', model: 'gpt-4o',
          choices: [{ index: 0, message, finish_reason: 'stop' }] }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const sb = sandbox(t, { copilot: { launch: 'copilot {args}', resume: 'copilot --resume={conversation} {args}' } });
  for (const key of Object.keys(sb.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/.test(key) || /^(COPILOT_|GITHUB_|GH_|VSCODE_|ITERM_|TERM_PROGRAM|TERM_SESSION_ID)/.test(key)) delete sb.env[key];
  }
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  Object.assign(sb.env, {
    PATH: process.env.BERTH_COPILOT_BIN_DIR ? `${process.env.BERTH_COPILOT_BIN_DIR}:${sb.env.PATH}` : sb.env.PATH,
    COPILOT_HOME: sb.makeDir('profile'), COPILOT_OFFLINE: 'true',
    COPILOT_PROVIDER_TYPE: 'openai', COPILOT_PROVIDER_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    COPILOT_PROVIDER_API_KEY: 'synthetic-local', COPILOT_PROVIDER_WIRE_API: 'completions',
    COPILOT_MODEL: 'gpt-4o', TERM: 'xterm-256color',
  });
  installHooks('copilot', CLI, sb.env);
  const ctx = sb.ctx();
  const pane = () => sb.tmux('capture-pane', '-p', '-t', '=native-copilot:');
  const row = () => list(ctx).find((item) => item.name === 'native-copilot');
  const ready = async () => {
    await waitFor(() => /Confirm folder trust|Interactive/.test(pane()), 'Copilot startup', 20_000);
    if (pane().includes('Confirm folder trust')) {
      // Trust only the generated temporary directory, for this process.
      sb.tmux('send-keys', '-t', '=native-copilot:', 'Enter');
    }
    await waitFor(() => /Interactive/.test(pane()) && !pane().includes('Confirm folder trust'), 'Copilot composer', 10_000);
  };
  const turn = async (prompt: string, done = true) => {
    const before = requests.length;
    sb.tmux('send-keys', '-t', '=native-copilot:', '-l', prompt);
    await waitFor(() => pane().includes(prompt), 'rendered prompt', 5000);
    sb.tmux('send-keys', '-t', '=native-copilot:', 'Enter');
    await waitFor(() => requests.length > before, 'model request', 15_000);
    if (done) await waitFor(() => row()?.state === 'done', 'Copilot completion', 15_000);
  };
  create(ctx, { agent: 'copilot', cwd: sb.root, name: 'native-copilot',
    extraArgs: ['--no-auto-update', '--disable-client-telemetry', '--disable-builtin-mcps'] });
  await ready();
  await turn('fixture original prompt');
  const id = row()?.conversation;
  assert.ok(id);
  const profile = row()?.profile;
  killServer(sb);
  assert.equal(ensure(ctx)[0].outcome, 'resume-requested');
  await ready();
  // The native resume hook is lazy: opening history alone does not acknowledge it.
  await turn('fixture followup prompt');
  await waitFor(() => row()?.recovery === 'confirmed', 'exact recovery acknowledgement', 20_000);
  assert.equal(row()?.conversation, id);
  assert.deepEqual(row()?.profile, profile);
  assert.ok(JSON.stringify(requests.at(-1)?.messages).includes('fixture original prompt'), 'native history survives recovery');
  mode = 'failure';
  await turn('fixture failing prompt', false);
  await waitFor(() => /Authentication failed/.test(pane()) && /Interactive/.test(pane()), 'native provider failure', 20_000);
  await waitFor(() => inventory(ctx).find((item) => item.name === 'native-copilot')?.state === '', 'failed turn clears activity', 10_000).catch((error) => { t.diagnostic(JSON.stringify(ctx.tmux.listSessions().map((item) => item.meta))); throw error; });
  mode = 'success';
  await turn('fixture after failure');
  mode = 'held';
  await turn('fixture cancelled prompt', false);
  await waitFor(() => /Working/.test(pane()), 'native pending request', 5000);
  sb.tmux('send-keys', '-t', '=native-copilot:', 'C-c');
  await waitFor(() => /Interactive/.test(pane()), 'native interruption', 10_000);
  await waitFor(() => inventory(ctx).find((item) => item.name === 'native-copilot')?.state === '', 'cancelled turn clears activity', 10_000);
  mode = 'success';
  await turn('fixture after cancellation');
  assert.equal(row()?.conversation, id);
  const finishTools = async () => {
    mode = 'success';
    for (const finish of heldResponses) finish();
    heldResponses = [];
    await waitFor(() => row()?.state === 'done', 'tool turn complete', 15_000);
  };
  const working = () => inventory(ctx).find((item) => item.name === 'native-copilot')?.state === 'working';
  // Tool execution is concurrent; identify the active card, not a command in scrollback.
  const approvalShows = (command: string) => pane().split('\n').some((line) => /│\s*│/.test(line) && line.includes(command));
  for (const approve of [true, false]) {
    const marker = approve ? 'approved-marker' : 'denied-marker';
    toolCommands = [`printf fixture-proof > ${marker}`];
    mode = 'tools';
    await turn(`fixture tool ${marker}`, false);
    await waitFor(() => approvalShows(toolCommands[0]) && pane().includes('Do you want to run this command?') && row()?.state === 'waiting', 'permission wait', 10_000);
    if (!approve) {
      sb.tmux('send-keys', '-t', '=native-copilot:', 'Down', 'Down');
      await waitFor(() => /❯ 3\. No/.test(pane()), 'denial selected', 5000);
      sb.tmux('send-keys', '-t', '=native-copilot:', 'Enter');
      sb.tmux('send-keys', '-t', '=native-copilot:', '-l', 'Do not run the command');
      await waitFor(() => pane().includes('Do not run the command'), 'denial feedback', 5000);
    }
    const before = requests.length;
    sb.tmux('send-keys', '-t', '=native-copilot:', 'Enter');
    await waitFor(() => requests.length > before, 'post-decision model request', 10_000);
    await waitFor(working, 'decision resumes working', 10_000);
    if (approve) assert.equal(readFileSync(join(sb.root, marker), 'utf8'), 'fixture-proof');
    else assert.equal(existsSync(join(sb.root, marker)), false, 'denied tool did not execute');
    await finishTools();
  }
  toolCommands = ['printf first-proof > first-marker', 'mkdir second-marker'];
  mode = 'tools';
  await turn('fixture two approvals', false);
  const first = await waitFor(() => row()?.state === 'waiting' && toolCommands.find(approvalShows), 'first approval', 10_000);
  const second = toolCommands.find((command) => command !== first)!;
  const firstMarker = first.startsWith('printf') ? 'first-marker' : 'second-marker';
  const before = requests.length;
  sb.tmux('send-keys', '-t', '=native-copilot:', 'Enter');
  await waitFor(() => existsSync(join(sb.root, firstMarker)) && approvalShows(second)
    && pane().includes('Do you want to run this command?'), 'second approval still pending', 10_000).catch((error) => { t.diagnostic(pane()); throw error; });
  assert.equal(inventory(ctx).find((item) => item.name === 'native-copilot')?.state, 'waiting');
  assert.equal(requests.length, before, 'no model continuation with an unresolved approval');
  sb.tmux('send-keys', '-t', '=native-copilot:', 'Enter');
  await waitFor(() => requests.length > before, 'both decisions resume model', 10_000);
  await waitFor(working, 'both decisions resume working', 10_000);
  assert.equal(readFileSync(join(sb.root, 'first-marker'), 'utf8'), 'first-proof');
  assert.equal(existsSync(join(sb.root, 'second-marker')), true);
  await finishTools();
  assert.equal(row()?.conversation, id);
});
