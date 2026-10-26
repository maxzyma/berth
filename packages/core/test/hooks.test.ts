import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI, sandbox } from './helpers.js';

type HookFile = { hooks: Record<string, { hooks: { command: string }[] }[]>; other?: string };

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as HookFile;
const berthEntries = (data: HookFile) =>
  Object.values(data.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.filter((h) => h.command.includes('BERTH_HOOK=1'))));

test('C11 (C12.12) hooks install / uninstall are idempotent and keep unrelated hooks', async (t) => {
  const sb = sandbox(t);
  const settings = join(sb.env.HOME, '.claude', 'settings.json');
  mkdirSync(join(sb.env.HOME, '.claude'), { recursive: true });
  const unrelated = { hooks: [{ type: 'command', command: 'echo mine' }] };
  writeFileSync(settings, JSON.stringify({ other: 'kept', hooks: { Stop: [unrelated] } }));

  assert.equal(sb.cli('hooks', 'install', 'claude').status, 0);
  assert.equal(sb.cli('hooks', 'install', 'claude').status, 0);
  const installed = read(settings);
  assert.equal(installed.other, 'kept');
  assert.deepEqual(Object.keys(installed.hooks).sort(), ['Notification', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  assert.equal(berthEntries(installed).length, 4, 'one Berth entry per event after two installs');
  assert.ok(installed.hooks.Stop.some((g) => g.hooks.some((h) => h.command === 'echo mine')));

  assert.equal(sb.cli('hooks', 'uninstall', 'claude').status, 0);
  const removed = read(settings);
  assert.equal(berthEntries(removed).length, 0);
  assert.deepEqual(removed.hooks, { Stop: [unrelated] });
  assert.equal(removed.other, 'kept');

  assert.equal(sb.cli('hooks', 'install', 'codex').status, 0);
  assert.equal(berthEntries(read(join(sb.env.HOME, '.codex', 'hooks.json'))).length, 2);
  assert.equal(sb.cli('hooks', 'install', 'gemini').status, 2, 'agents without hook support say so');
});

test('C5 (C12.6) hook events from inside a pane stamp conversation and state', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('h'));
  const socketPath = sb.tmux('display-message', '-p', '-t', '=h:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=h:', '#{pane_id}').trim();
  const hook = (event: string, payload: object) =>
    spawnSync(process.execPath, [CLI, 'hook', 'claude', event], {
      env: { ...sb.env, TMUX: `${socketPath},1,0`, TMUX_PANE: pane },
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
  const meta = () => sb.tmux('display-message', '-p', '-t', '=h:', '#{@berth_conversation} #{@berth_state}').trim();

  assert.equal(hook('SessionStart', { session_id: 'abc' }).status, 0);
  assert.equal(meta(), 'abc');
  hook('UserPromptSubmit', {});
  assert.equal(meta(), 'abc working');
  hook('Notification', { message: 'Claude is waiting for your input' });
  assert.equal(meta(), 'abc working', 'idle reminder is not a waiting state');
  hook('Notification', { message: 'Claude needs your permission to use Bash' });
  assert.equal(meta(), 'abc waiting');
  hook('Stop', {});
  assert.equal(meta(), 'abc done');
  hook('SessionStart', { session_id: 'forked' });
  assert.equal(meta(), 'forked done', 'a new id after fork / clear replaces the old one');

  const outside = spawnSync(process.execPath, [CLI, 'hook', 'claude', 'Stop'], { env: sb.env, input: 'not json', encoding: 'utf8' });
  assert.equal(outside.status, 0, 'a hook outside tmux never fails the agent');
});
