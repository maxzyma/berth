/** Regressions found in review (2026-10-28); each test reproduces the failure first seen. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI, killServer, sandbox, waitFor } from './helpers.js';
import type { SessionRow } from '../src/registry/sessions.js';
import { withLock } from '../src/restore/lock.js';

const rows = (sb: ReturnType<typeof sandbox>, env = sb.env) => {
  const r = spawnSync(process.execPath, [CLI, 'ls', '--json'], { env, encoding: 'utf8' });
  return JSON.parse(r.stdout) as SessionRow[];
};

test('R-locale metadata survives a missing locale and newlines in notes', async (t) => {
  const sb = sandbox(t);
  sb.tmux('new-session', '-d', '-s', 'café', '-c', sb.makeDir('loc'), 'sleep 3600');
  sb.cli('adopt', 'café', '--agent', 'claude');
  sb.cli('stamp', '--session', 'café', 'note=line1\nline2');
  const noLocale = { ...sb.env, LANG: '', LC_ALL: '', LC_CTYPE: '' };
  const listed = rows(sb, noLocale);
  assert.deepEqual(listed.map((r) => [r.name, r.managed, r.note]), [['café', true, 'line1 line2']]);
});

test('R-zsh the iTerm2 attach command survives zsh (no =word expansion)', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('z'));
  const command = sb.cli('iterm2', 'reattach', 'z').stdout.trim();
  const zsh = spawnSync('zsh', ['-f', '-c', `print -r -- ${command}`], { encoding: 'utf8' });
  assert.equal(zsh.status, 0, zsh.stderr);
  assert.match(zsh.stdout.trim(), / =z$/, 'the target reaches tmux as =z');
});

test('R-hooks session names with quotes reach the hooks intact; state stays per server', async (t) => {
  const sb = sandbox(t);
  sb.tmux('new-session', '-d', '-s', 'boot', 'sleep 3600');
  sb.cli('tmux', 'install');
  const name = "bob's";
  sb.tmux('new-session', '-d', '-s', name, '-c', sb.makeDir('q'), "sh -c 'sleep 1; printf \"\\a\"; sleep 3600'");
  sb.cli('adopt', name, '--agent', 'kimi');
  await waitFor(() => sb.tmux('display-message', '-p', '-t', `=${name}:`, '#{@berth_state}').trim() === 'waiting', 'bell hook ran', 10_000);
  const store = join(sb.env.XDG_STATE_HOME, 'berth', 'servers', sb.socket, 'snapshots');
  await waitFor(() => sb.ctx().store.newest()?.sessions.some((s) => s.name === name), 'snapshot in this server state', 10_000);
  assert.ok(sb.ctx().store.root === store);
});

test('R-snapshot new sessions and new conversation ids are snapshotted at once', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('fresh'));
  sb.cli('stamp', '--session', 'fresh', 'conversation=c-1');
  killServer(sb);
  assert.match(sb.cli('ensure').stdout, /fresh\tresumed/, 'restorable without a manual snapshot');
});

test('R-name-key a Claude session without a hook-reported id is bound through its transcript title', async (t) => {
  const sb = sandbox(t);
  const dir = sb.makeDir('named.proj');
  sb.cli('new', 'claude', '--cwd', dir, '--name', 'titled');
  const project = join(sb.env.HOME, '.claude', 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'old-id.jsonl'), `${JSON.stringify({ type: 'custom-title', customTitle: 'titled' })}\n`);
  utimesSync(join(project, 'old-id.jsonl'), new Date(2020, 0, 1), new Date(2020, 0, 1));
  writeFileSync(join(project, 'new-id.jsonl'), `{"type":"user"}\n${JSON.stringify({ type: 'custom-title', customTitle: 'titled' })}\n`);
  writeFileSync(join(project, 'other.jsonl'), `${JSON.stringify({ type: 'custom-title', customTitle: 'someone-else' })}\n`);
  const dirOut = sb.cli('snapshot').stdout.trim();
  const data = JSON.parse(readFileSync(join(dirOut, 'sessions.json'), 'utf8'));
  assert.equal(data.sessions[0].conversation, 'new-id', 'newest transcript with the title');
});

test('R-scrollback session names with a slash do not break snapshots', async (t) => {
  const sb = sandbox(t);
  sb.tmux('new-session', '-d', '-s', 'a/b', 'sleep 3600');
  sb.cli('adopt', 'a/b', '--agent', 'codex');
  const r = sb.cli('snapshot');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(sb.cli('show', 'a/b').stdout !== undefined);
  assert.equal(sb.cli('show', 'a/b').status, 0);
});

test('R-lock a lock left without a pid by a crashed owner is taken over', (t) => {
  const sb = sandbox(t);
  const state = join(sb.root, 'lockstate');
  const lock = join(state, 'ensure.lock');
  mkdirSync(lock, { recursive: true });
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  assert.equal(withLock(state, () => 'ran', 2_000), 'ran');
});
