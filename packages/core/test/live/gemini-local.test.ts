/** Native Gemini against a loopback model fixture; no real account or credentials. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sandbox, waitFor, CLI, killServer } from '../helpers.js';
import { createContext } from '../../src/context.js';
import { installHooks } from '../../src/agents/hooks.js';
import { create, list, inventory } from '../../src/registry/sessions.js';
import { ensure } from '../../src/restore/ensure.js';

test('CR58–CR61 native Gemini restores its profile and reconciles tool and failure outcomes', {
  skip: process.env.BERTH_GEMINI_LOCAL !== '1', timeout: 90_000,
}, async (t) => {
  const requests: unknown[] = [];
  let holdResponse = false;
  let toolCommands: string[] = [];
  let providerFailure = false;
  const heldResponses: (() => void)[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      if (request.url?.includes('countTokens')) {
        response.setHeader('content-type', 'application/json'); response.end('{"totalTokens":10}'); return;
      }
      requests.push(JSON.parse(body || '{}'));
      if (providerFailure) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 401, status: 'UNAUTHENTICATED', message: 'Fixture authentication failed' } }));
        return;
      }
      const finish = () => {
        if (response.destroyed) return;
        const result = { candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Fixture complete.' }] }, finishReason: 'STOP' }] };
        if (request.url?.includes('streamGenerateContent')) {
          response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(result)}\n\n`);
        } else { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result)); }
      };
      if (holdResponse) { heldResponses.push(finish); return; }
      const parts = toolCommands.length ? toolCommands.map((command) => ({ functionCall: { name: 'run_shell_command', args: { command, description: 'Write fixture marker' } } })) : [{ text: 'Fixture complete.' }];
      if (toolCommands.length) { toolCommands = []; holdResponse = true; }
      const data = { candidates: [{ index: 0, content: { role: 'model', parts }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 } };
      if (request.url?.includes('streamGenerateContent')) {
        response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(`data: ${JSON.stringify(data)}\n\n`);
      } else { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(data)); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const sb = sandbox(t, { gemini: { launch: 'gemini --model gemini-2.5-flash {args}', resume: 'gemini --resume {conversation} --model gemini-2.5-flash {args}' } });
  for (const key of Object.keys(sb.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/.test(key) || /^(GEMINI_|GOOGLE_|GCLOUD_|CLOUDSDK_)/.test(key)) delete sb.env[key];
  }
  if (process.env.BERTH_GEMINI_BIN_DIR) sb.env.PATH = `${process.env.BERTH_GEMINI_BIN_DIR}:${sb.env.PATH}`;
  sb.env.GEMINI_API_KEY = 'synthetic-local';
  sb.env.GOOGLE_GEMINI_BASE_URL = `http://127.0.0.1:${address.port}`;
  sb.env.GEMINI_TELEMETRY_ENABLED = 'false';
  sb.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = join(sb.root, 'system-settings.json');
  sb.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH = join(sb.root, 'system-defaults.json');
  sb.env.GEMINI_CLI_HOME = sb.makeDir('selected-home');
  sb.env.TERM = 'xterm-256color';
  const config = join(sb.env.GEMINI_CLI_HOME, '.gemini'); mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'settings.json'), JSON.stringify({
    general: { enableAutoUpdate: false, enableAutoUpdateNotification: false },
    security: { auth: { selectedType: 'gemini-api-key' }, folderTrust: { enabled: false } },
    privacy: { usageStatisticsEnabled: false }, telemetry: { enabled: false }, ui: { hideTips: true },
  }));
  writeFileSync(join(config, 'state.json'), JSON.stringify({ terminalSetupPromptShown: true }));
  assert.equal(installHooks('gemini', CLI, sb.env), join(config, 'settings.json'));
  const ctx = sb.ctx(); create(ctx, { agent: 'gemini', cwd: sb.root, name: 'native-gemini' });
  const pane = () => sb.tmux('capture-pane', '-p', '-t', '=native-gemini:');
  const row = () => list(ctx).find((item) => item.name === 'native-gemini');
  const send = async (prompt: string, done = true) => {
    await waitFor(() => {
      const screen = pane();
      return screen.includes('Type your message') && !/Executing Hooks:|esc to cancel/.test(screen);
    }, 'Gemini composer ready', 15_000);
    const before = requests.length;
    sb.tmux('send-keys', '-t', '=native-gemini:', '-l', `\x1b[200~${prompt}\x1b[201~`);
    await waitFor(() => pane().includes(`> ${prompt}`), 'rendered Gemini prompt', 5_000);
    // Gemini 0.66.0 InputPrompt rejects submit for 40 ms after untrusted terminal paste.
    await delay(50);
    sb.tmux('send-keys', '-t', '=native-gemini:', 'Enter');
    await waitFor(() => requests.length > before, 'Gemini model request', 15_000).catch((error) => {
      throw new Error(`${error.message}\n${pane()}`, { cause: error });
    });
    if (done) await waitFor(() => row()?.state === 'done', 'Gemini completion', 15_000);
  };
  await waitFor(() => row()?.conversation, 'Gemini binding', 30_000);
  await send('fixture original turn');
  const id = row()?.conversation; assert.ok(id);
  assert.equal(row()?.profile?.environment.GEMINI_CLI_HOME, sb.env.GEMINI_CLI_HOME);
  killServer(sb);
  const otherHost = createContext({ ...sb.env, GEMINI_CLI_HOME: sb.makeDir('unrelated-home') });
  assert.equal(ensure(otherHost)[0].outcome, 'resume-requested');
  await waitFor(() => row()?.recovery === 'confirmed', 'Gemini exact-ID recovery', 30_000);
  assert.equal(row()?.conversation, id);
  await send('fixture resumed turn');
  assert.ok(JSON.stringify(requests.at(-1)).includes('fixture original turn'), 'restored model history');
  assert.equal(row()?.conversation, id);
  for (const decision of ['approve', 'reject'] as const) {
    killServer(sb);
    assert.equal(ensure(otherHost)[0].outcome, 'resume-requested');
    await waitFor(() => row()?.recovery === 'confirmed', 'tool session recovery', 30_000);
    const proof = join(sb.root, `${decision}-marker`);
    toolCommands = [`printf fixture > ${JSON.stringify(proof)}`];
    holdResponse = false;
    await send(`fixture ${decision} tool`, false);
    await waitFor(() => pane().includes('Allow once'), 'native tool approval', 15_000);
    await waitFor(() => row()?.state === 'waiting', 'permission wait', 5_000);
    const before = requests.length;
    sb.tmux('send-keys', '-t', '=native-gemini:', decision === 'approve' ? 'Enter' : 'Escape');
    if (decision === 'approve') {
      await waitFor(() => requests.length > before, 'model request after approval', 15_000);
      await waitFor(() => row()?.state === 'working', 'approval returns to working', 5_000);
      assert.equal(readFileSync(proof, 'utf8'), 'fixture');
      holdResponse = false;
      for (const finish of heldResponses.splice(0)) finish();
      await waitFor(() => row()?.state === 'done', 'approved tool completion', 15_000);
    } else {
      await waitFor(() => pane().includes('Request cancelled.'), 'native tool rejection', 10_000);
      await waitFor(() => inventory(ctx).find((item) => item.name === 'native-gemini')?.state === '', 'rejection clears activity', 5_000);
      assert.equal(existsSync(proof), false);
    }
    assert.equal(row()?.conversation, id);
  }
  {
    killServer(sb);
    assert.equal(ensure(otherHost)[0].outcome, 'resume-requested');
    await waitFor(() => row()?.recovery === 'confirmed', 'multi-tool session recovery', 30_000);
    const first = join(sb.root, 'first-marker'), second = join(sb.root, 'second-marker');
    toolCommands = [`printf first > ${JSON.stringify(first)}`, `mkdir ${JSON.stringify(second)}`];
    holdResponse = false;
    await send('fixture multiple approvals', false);
    await waitFor(() => pane().includes('Allow once'), 'first tool approval', 15_000);
    await waitFor(() => row()?.state === 'waiting', 'first permission wait', 5_000);
    const before = requests.length;
    sb.tmux('send-keys', '-t', '=native-gemini:', 'Enter');
    await waitFor(() => pane().includes('mkdir') && pane().includes('Allow once'), 'second tool still pending', 15_000).catch((error) => { throw new Error(`${error.message}\n${pane()}`); });
    assert.equal(row()?.state, 'waiting');
    assert.equal(requests.length, before, 'model cannot continue before the remaining approval');
    sb.tmux('send-keys', '-t', '=native-gemini:', 'Enter');
    await waitFor(() => requests.length > before, 'model after both approvals', 15_000);
    assert.equal(row()?.state, 'working');
    assert.equal(readFileSync(first, 'utf8'), 'first');
    assert.equal(existsSync(second), true);
    holdResponse = false;
    for (const finish of heldResponses.splice(0)) finish();
    await waitFor(() => row()?.state === 'done', 'multiple tool completion', 15_000);
  }
  for (const verbosity of ['low', 'full']) {
    killServer(sb);
    const settingsPath = join(config, 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    writeFileSync(settingsPath, JSON.stringify({ ...settings, ui: { ...settings.ui, errorVerbosity: verbosity } }));
    assert.equal(ensure(otherHost)[0].outcome, 'resume-requested');
    await waitFor(() => row()?.recovery === 'confirmed', 'failure session recovery', 30_000);
    holdResponse = false;
    providerFailure = true;
    await send(`fixture ${verbosity} provider failure`, false);
    await waitFor(() => pane().includes('API Error:'), 'native provider error', 10_000);
    await waitFor(() => inventory(ctx).find((item) => item.name === 'native-gemini')?.state === '', 'provider failure clears activity', 5_000);
    providerFailure = false;
    await send(`fixture ${verbosity} after failure`);
    assert.equal(inventory(ctx).find((item) => item.name === 'native-gemini')?.state, 'done');
    assert.equal(row()?.conversation, id);
  }
  {
    killServer(sb);
    assert.equal(ensure(otherHost)[0].outcome, 'resume-requested');
    await waitFor(() => row()?.recovery === 'confirmed', 'cancellation session recovery', 30_000);
    await waitFor(() => pane().includes('Type your message'), 'cancellation composer', 15_000);
    holdResponse = true;
    const before = requests.length;
    sb.tmux('send-keys', '-t', '=native-gemini:', '-l', '\x1b[200~fixture cancelled turn\x1b[201~');
    await waitFor(() => pane().includes('> fixture cancelled turn'), 'rendered cancellation prompt', 5_000);
    // Gemini 0.66.0 InputPrompt rejects submit for 40 ms after untrusted terminal paste.
    await delay(50);
    sb.tmux('send-keys', '-t', '=native-gemini:', 'Enter');
    await waitFor(() => requests.length > before, 'held Gemini request', 15_000).catch((error) => {
      throw new Error(`${error.message}\n${pane()}`, { cause: error });
    });
    assert.equal(row()?.state, 'working');
    sb.tmux('send-keys', '-t', '=native-gemini:', 'Escape');
    await waitFor(() => pane().includes('Request cancelled.'), 'native cancellation acknowledgement', 10_000).catch((error) => {
      throw new Error(`${error.message}\n${pane()}`, { cause: error });
    });
    await waitFor(() => inventory(ctx).find((item) => item.name === 'native-gemini')?.state === '', 'CR59 cancelled Gemini must return to idle', 5_000);
    holdResponse = false;
    await send('fixture after cancellation');
    assert.equal(inventory(ctx).find((item) => item.name === 'native-gemini')?.state, 'done');
    assert.equal(row()?.conversation, id);
  }
});
