/** Edge cases of implementation §4, one test each (C12). §4.2, §4.6 and §4.12 are C9, C5 and C11. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI, killServer, sandbox, waitFor } from './helpers.js';
import type { SessionRow } from '../src/registry/sessions.js';

const rows = (sb: ReturnType<typeof sandbox>) => JSON.parse(sb.cli('ls', '--json').stdout) as SessionRow[];

test('C12.1 tmux missing exits 3; no server running still lists stopped sessions', async (t) => {
  const sb = sandbox(t);
  const missing = sb.cli('--socket', sb.socket, 'ls');
  assert.equal(missing.status, 0);
  sb.env.BERTH_TMUX = '/nonexistent/tmux';
  const r = sb.cli('ls');
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /^berth: tmux unavailable/);
  delete sb.env.BERTH_TMUX;
  sb.cli('new', 'claude', '--cwd', sb.makeDir('e1'));
  sb.cli('snapshot');
  killServer(sb);
  assert.deepEqual(rows(sb).map((x) => [x.name, x.live]), [['e1', false]]);
});

test('C12.3 a missing working directory is skipped and reported', async (t) => {
  const sb = sandbox(t);
  const dir = sb.makeDir('e3');
  sb.cli('new', 'claude', '--cwd', dir);
  sb.cli('snapshot');
  killServer(sb);
  rmSync(dir, { recursive: true });
  assert.match(sb.cli('ensure').stdout, /e3\tskipped-missing-cwd/);
  assert.match(sb.cli('doctor').stdout, /e3: working directory missing/);
});

test('C12.4 an agent binary missing at restore gets a shell in its cwd', async (t) => {
  const sb = sandbox(t, { claude: { resume: '/nonexistent/claude --resume {conversation}' } });
  const dir = sb.makeDir('e4');
  sb.cli('new', 'claude', '--cwd', dir);
  sb.cli('stamp', '--session', 'e4', 'conversation=x');
  sb.cli('snapshot');
  killServer(sb);
  assert.match(sb.cli('ensure').stdout, /e4\tshell\t\/nonexistent\/claude not found/);
  assert.equal(sb.tmux('display-message', '-p', '-t', '=e4:', '#{pane_current_path}').trim(), realpathSync(dir));
});

test('C12.5 a recorded conversation is always resumed, never silently replaced', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'kimi', '--cwd', sb.makeDir('e5'));
  sb.cli('stamp', '--session', 'e5', 'conversation=maybe-stale');
  sb.cli('snapshot');
  killServer(sb);
  sb.cli('ensure');
  const argv = await waitFor(() => sb.argv('e5')?.includes('resume') && sb.argv('e5'), 'resume argv');
  assert.deepEqual(argv.slice(0, 3), ['kimi', 'resume', 'maybe-stale']);
});

test('C12.7 a session renamed in tmux keeps its metadata under the new name', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'codex', '--cwd', sb.makeDir('e7'), '--origin', 'vscode');
  sb.tmux('rename-session', '-t', '=e7', 'renamed');
  const dir = sb.cli('snapshot').stdout.trim();
  const data = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'));
  assert.deepEqual(data.sessions.map((s: { name: string; origin: string }) => [s.name, s.origin]), [['renamed', 'vscode']]);
});

test('C12.8 when the agent exits, its session ends', async (t) => {
  const sb = sandbox(t, { qoder: { launch: 'true' } });
  sb.cli('new', 'qoder', '--cwd', sb.makeDir('e8'));
  await waitFor(() => !rows(sb).some((r) => r.name === 'e8' && r.live), 'session to end');
});

test('C12.9 a name taken by an unmanaged session gets a suffix and is never adopted', async (t) => {
  const sb = sandbox(t);
  sb.tmux('new-session', '-d', '-s', 'dup', 'sleep 3600');
  assert.equal(sb.cli('new', 'claude', '--cwd', sb.makeDir('dup')).stdout.trim(), 'dup-2');
  assert.equal(rows(sb).find((r) => r.name === 'dup')?.managed, false);
});

test('C12.10 a snapshot with no managed sessions is written, empty and valid', async (t) => {
  const sb = sandbox(t);
  sb.tmux('new-session', '-d', '-s', 'plain', 'sleep 3600');
  const dir = sb.cli('snapshot').stdout.trim();
  const data = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'));
  assert.deepEqual([data.version, data.sessions], [1, []]);
  assert.equal(sb.cli('ensure').stdout.trim(), 'nothing to restore');
});

test('C12.11 a stale lock from a crashed ensure is taken over', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('e11'));
  sb.cli('snapshot');
  killServer(sb);
  const lock = join(sb.env.XDG_STATE_HOME, 'berth', 'servers', sb.socket, 'ensure.lock');
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'pid'), '999999');
  const started = Date.now();
  assert.match(sb.cli('ensure').stdout, /e11\tlaunched/);
  assert.ok(Date.now() - started < 10_000, 'did not wait for the dead owner');
});

test('C12.13 snapshots of one tmux server never restore into another', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('mine'));
  sb.cli('snapshot');
  const other = { ...sb.env, BERTH_TMUX_SOCKET: `${sb.socket}-other` };
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [CLI, 'ensure'], { env: other, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'nothing to restore');
  spawnSync('tmux', ['-L', `${sb.socket}-other`, 'kill-server'], { env: other });
});
