/** C11 for every hook format: install is idempotent, keeps the user's entries, uninstall leaves no trace. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLI, sandbox, waitFor } from './helpers.js';

type Sb = ReturnType<typeof sandbox>;

/** The sandbox env without agent home overrides inherited from the developer's shell. */
function cleanEnv(sb: Sb): Record<string, string> {
  const env = { ...sb.env };
  for (const key of ['KIMI_CODE_HOME', 'QODER_CONFIG_DIR', 'COPILOT_HOME']) delete env[key];
  return env;
}

function hooks(sb: Sb, action: string, agent: string) {
  return spawnSync(process.execPath, [CLI, 'hooks', action, agent], { env: cleanEnv(sb), encoding: 'utf8' });
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

function seed(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const JSON_TARGETS = [
  { agent: 'gemini', file: '.gemini/settings.json', events: ['SessionStart', 'BeforeAgent', 'Notification', 'AfterAgent'], nested: true },
  { agent: 'qoder', file: '.qoder/settings.json', events: ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop'], nested: true },
  { agent: 'cursor', file: '.cursor/hooks.json', events: ['sessionStart', 'beforeSubmitPrompt', 'stop'], nested: false },
];

test('C11 JSON hook files: nested and flat layouts', async (t) => {
  const sb = sandbox(t);
  for (const { agent, file, events, nested } of JSON_TARGETS) {
    const path = join(sb.env.HOME, file);
    const mine = nested ? { hooks: [{ type: 'command', command: 'echo mine' }] } : { command: 'echo mine' };
    seed(path, JSON.stringify({ other: 'kept', hooks: { [events[0]]: [mine] } }));
    assert.equal(hooks(sb, 'install', agent).status, 0, agent);
    assert.equal(hooks(sb, 'install', agent).status, 0, agent);
    const text = readFileSync(path, 'utf8');
    const data = JSON.parse(text);
    assert.deepEqual(Object.keys(data.hooks).sort(), [...events].sort(), agent);
    assert.equal(count(text, 'BERTH_HOOK=1'), events.length, `${agent}: one entry per event`);
    assert.ok(text.includes('echo mine'), `${agent}: user entry kept`);
    assert.equal(data.other, 'kept');
    if (!nested) assert.equal(data.version, 1, 'cursor requires version 1');
    assert.equal(hooks(sb, 'uninstall', agent).status, 0);
    const after = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(after.hooks, { [events[0]]: [mine] }, `${agent}: only Berth entries removed`);
  }
});

test('C11 Copilot hooks live in their own file', async (t) => {
  const sb = sandbox(t);
  const path = join(sb.env.HOME, '.copilot', 'hooks', 'berth.json');
  hooks(sb, 'install', 'copilot');
  hooks(sb, 'install', 'copilot');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(data.version, 1);
  assert.deepEqual(Object.keys(data.hooks).sort(), ['agentStop', 'notification', 'sessionStart', 'userPromptSubmitted']);
  assert.ok(Object.values(data.hooks).every((e) => (e as unknown[]).length === 1));
  hooks(sb, 'uninstall', 'copilot');
  assert.equal(existsSync(path), false);
});

test('C11 Kimi hooks are a removable block at the end of config.toml', async (t) => {
  const sb = sandbox(t);
  const path = join(sb.env.HOME, '.kimi-code', 'config.toml');
  const original = 'default_model = "k2"\n\n[[hooks]]\nevent = "Stop"\ncommand = "echo mine"\n';
  seed(path, original);
  hooks(sb, 'install', 'kimi');
  hooks(sb, 'install', 'kimi');
  const text = readFileSync(path, 'utf8');
  assert.ok(text.startsWith(original), 'user content untouched and first');
  assert.equal(count(text, '[[hooks]]'), 5, 'the user hook plus four Berth hooks');
  assert.match(text, /event = "PermissionRequest"\ncommand = "BERTH_HOOK=1 .* hook kimi PermissionRequest"/);
  hooks(sb, 'uninstall', 'kimi');
  assert.equal(readFileSync(path, 'utf8'), original);
});

test('C11 the OpenCode plugin forwards a top-level session id from inside a pane', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'opencode', '--cwd', sb.makeDir('oc'));
  assert.equal(hooks(sb, 'install', 'opencode').status, 0);
  const plugin = join(sb.env.XDG_CONFIG_HOME, 'opencode', 'plugins', 'berth.js');
  const socketPath = sb.tmux('display-message', '-p', '-t', '=oc:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=oc:', '#{pane_id}').trim();
  const driver = `
    const { BerthPlugin } = await import(${JSON.stringify(pathToFileURL(plugin).href)});
    const { event } = await BerthPlugin({});
    await event({ event: { type: 'session.created', properties: { info: { id: 'ses_child', parentID: 'ses_main' } } } });
    await event({ event: { type: 'session.created', properties: { sessionID: 'ses_main', info: { id: 'ses_main' } } } });
    await event({ event: { type: 'session.idle', properties: { sessionID: 'ses_child' } } });`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
    env: { ...sb.env, TMUX: `${socketPath},1,0`, TMUX_PANE: pane },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const meta = () => sb.tmux('display-message', '-p', '-t', '=oc:', '#{@berth_conversation}|#{@berth_state}').trim();
  await waitFor(() => meta() === 'ses_main|', 'main session id stamped; child events ignored', 10_000);
  hooks(sb, 'uninstall', 'opencode');
  assert.equal(existsSync(plugin), false);
});

test('C15 an agent started without hooks is pointed at `berth hooks install`', async (t) => {
  const sb = sandbox(t);
  const env = cleanEnv(sb);
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  assert.match(run('new', 'kimi', '--cwd', sb.makeDir('k')).stderr, /berth hooks install kimi/);
  assert.equal(run('new', 'shell', '--cwd', sb.makeDir('s')).stderr, '', 'nothing to install for a shell');
  const row = JSON.parse(run('ls', '--json').stdout).find((r: { name: string }) => r.name === 'k');
  assert.equal(row.hooks, 'missing');

  // A terminal attaching (not VS Code) is told once per agent per server.
  const flag = () => sb.tmux('show-option', '-gqv', '@berth_hinted_kimi').trim();
  run('attached', '--session', 'k', '--tty', '/dev/null', '--termtype', 'xterm-256color');
  assert.equal(flag(), '1');

  run('hooks', 'install', 'kimi');
  assert.equal(run('new', 'kimi', '--cwd', sb.makeDir('k2')).stderr, '');
  assert.equal(JSON.parse(run('ls', '--json').stdout).find((r: { name: string }) => r.name === 'k').hooks, 'installed');
});
