import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { killServer, sandbox, waitFor } from './helpers.js';
import type { SessionRow } from '../src/registry/sessions.js';

function rows(sb: ReturnType<typeof sandbox>): SessionRow[] {
  const r = sb.cli('ls', '--json');
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as SessionRow[];
}

test('C1 ls lists managed, unmanaged and stopped sessions', async (t) => {
  const sb = sandbox(t);
  const web = sb.makeDir('web');
  assert.equal(sb.cli('new', 'claude', '--cwd', web, '--origin', 'vscode').status, 0);
  sb.tmux('new-session', '-d', '-s', 'plain', 'sleep 3600');
  sb.cli('snapshot');
  sb.tmux('new-session', '-d', '-s', 'gone', '-c', web, 'sleep 3600');
  sb.cli('adopt', 'gone', '--agent', 'codex');
  sb.cli('snapshot');
  sb.tmux('kill-session', '-t', '=gone');

  const all = rows(sb);
  const web1 = all.find((r) => r.name === 'web');
  assert.deepEqual(
    { managed: web1?.managed, agent: web1?.agent, origin: web1?.origin, live: web1?.live, cwd: web1?.cwd },
    { managed: true, agent: 'claude', origin: 'vscode', live: true, cwd: web },
  );
  const plain = all.find((r) => r.name === 'plain');
  assert.equal(plain?.managed, false);
  assert.equal(plain?.agent, '');
  const gone = all.find((r) => r.name === 'gone');
  assert.equal(gone?.live, false);
  assert.equal(gone?.agent, 'codex');
  for (const key of ['name', 'managed', 'agent', 'cwd', 'conversation', 'origin', 'state', 'attachedClients', 'live']) {
    assert.ok(key in (web1 ?? {}), `missing field ${key}`);
  }
});

test('C2 new runs the launch template, stamps metadata, picks a unique name', async (t) => {
  const sb = sandbox(t);
  const dir = sb.makeDir('api');
  assert.equal(sb.cli('new', 'claude', '--cwd', dir, '--', '--model', 'opus').stdout.trim(), 'api');
  assert.equal(sb.cli('new', 'claude', '--cwd', dir).stdout.trim(), 'api-2');
  const argv = await waitFor(() => sb.argv('api'), 'stand-in argv');
  assert.deepEqual(argv, ['claude', 'launch', '--model', 'opus']);
  const row = rows(sb).find((r) => r.name === 'api');
  assert.equal(row?.agent, 'claude');
  assert.equal(row?.origin, 'none');
  assert.equal(row?.cwd, dir);
});

test('C3 a custom launcher that calls stamp is listed as managed', async (t) => {
  const sb = sandbox(t);
  const dir = sb.makeDir('custom');
  sb.tmux('new-session', '-d', '-s', 'mine', '-c', dir, 'sleep 3600');
  const r = sb.cli('stamp', '--session', 'mine', 'agent=kimi', `cwd=${dir}`, 'origin=iterm2', 'argv=kimi');
  assert.equal(r.status, 0, r.stderr);
  const row = rows(sb).find((x) => x.name === 'mine');
  assert.deepEqual([row?.managed, row?.agent, row?.origin], [true, 'kimi', 'iterm2']);
});

test('C4 adopt makes an unmanaged session managed without restarting it', async (t) => {
  const sb = sandbox(t);
  sb.tmux('new-session', '-d', '-s', 'old', 'sleep 3600');
  const pidBefore = sb.tmux('display-message', '-p', '-t', '=old:', '#{pane_pid}').trim();
  assert.equal(sb.cli('adopt', 'old', '--agent', 'gemini', '--origin', 'vscode').status, 0);
  const pidAfter = sb.tmux('display-message', '-p', '-t', '=old:', '#{pane_pid}').trim();
  assert.equal(pidAfter, pidBefore);
  const row = rows(sb).find((x) => x.name === 'old');
  assert.deepEqual([row?.managed, row?.agent, row?.origin], [true, 'gemini', 'vscode']);
});

test('C5 stamp updates conversation and state; the newest stamp wins', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('c5'));
  sb.cli('stamp', '--session', 'c5', 'conversation=first', 'state=working');
  sb.cli('stamp', '--session', 'c5', 'conversation=second', 'state=waiting');
  const row = rows(sb).find((x) => x.name === 'c5');
  assert.deepEqual([row?.conversation, row?.state], ['second', 'waiting']);
  assert.equal(sb.cli('stamp', '--session', 'c5', 'bogus=1').status, 2);
});

test('C6 snapshot writes the v1 format atomically and keeps the newest K', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'codex', '--cwd', sb.makeDir('c6'), '--origin', 'iterm2');
  sb.cli('stamp', '--session', 'c6', 'conversation=abc');
  const dirs: string[] = [];
  for (let i = 0; i < 7; i++) dirs.push(sb.cli('snapshot').stdout.trim());
  const ctx = sb.ctx();
  const kept = ctx.store.list();
  assert.equal(kept.length, 5);
  assert.deepEqual(kept, [...dirs].reverse().slice(0, 5));
  const data = JSON.parse(readFileSync(join(kept[0], 'sessions.json'), 'utf8'));
  assert.equal(data.version, 1);
  assert.deepEqual(data.sessions, [
    { name: 'c6', cwd: sb.makeDir('c6'), agent: 'codex', argv: data.sessions[0].argv, conversation: 'abc', origin: 'iterm2' },
  ]);
  assert.ok(existsSync(join(kept[0], 'scrollback', 'c6.txt')));
  assert.ok(!ctx.store.list().some((d) => d.includes('.tmp-')));
});

test('C7 after the server dies, ensure rebuilds each managed session with its resume command', async (t) => {
  const sb = sandbox(t);
  const dir = sb.makeDir('c7');
  sb.cli('new', 'claude', '--cwd', dir, '--', '--model', 'opus', 'initial prompt');
  sb.cli('stamp', '--session', 'c7', 'conversation=conv-1');
  sb.cli('snapshot');
  killServer(sb);
  const r = sb.cli('ensure');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /c7\tresumed/);
  const argv = await waitFor(() => sb.argv('c7')?.includes('resume') && sb.argv('c7'), 'resume argv');
  assert.deepEqual(argv, ['claude', 'resume', 'conv-1', '--model', 'opus']);
  const row = rows(sb).find((x) => x.name === 'c7');
  assert.deepEqual([row?.live, row?.conversation, row?.cwd], [true, 'conv-1', dir]);
});

test('C8 ensure --origin rebuilds only that origin', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('a'), '--origin', 'vscode');
  sb.cli('new', 'claude', '--cwd', sb.makeDir('b'), '--origin', 'iterm2');
  sb.cli('snapshot');
  killServer(sb);
  sb.cli('ensure', '--origin', 'vscode');
  const live = rows(sb).filter((r) => r.live).map((r) => r.name);
  assert.deepEqual(live, ['a']);
});

test('C9 two concurrent ensure calls rebuild each session once', async (t) => {
  const sb = sandbox(t);
  for (const name of ['p', 'q', 'r']) sb.cli('new', 'claude', '--cwd', sb.makeDir(name));
  sb.cli('snapshot');
  killServer(sb);
  const [one, two] = await Promise.all([sb.cliAsync('ensure'), sb.cliAsync('ensure')]);
  assert.equal(one.status, 0);
  assert.equal(two.status, 0);
  const outcomes = `${one.stdout}\n${two.stdout}`;
  for (const name of ['p', 'q', 'r']) {
    const built = outcomes.split('\n').filter((l) => l.startsWith(`${name}\t`) && !l.includes('skipped-live'));
    assert.equal(built.length, 1, `${name} built ${built.length} times`);
  }
});

test('C10 a session without a conversation is relaunched and reported unbound', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('c10'));
  sb.cli('snapshot');
  killServer(sb);
  assert.match(sb.cli('ensure').stdout, /c10\tlaunched/);
  const argv = await waitFor(() => sb.argv('c10'), 'launch argv');
  assert.equal(argv[1], 'launch');
  assert.match(sb.cli('doctor').stdout, /c10: conversation not bound/);
});
