import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { handoffSources, persistentTerminalOptions, restoredTerminalSession, terminalProcessOwned, TERMINAL_OWNER_ENV } from '../src/terminalOwnership.js';

test('an unresolved terminal does not block detached targets or owned views, but cannot authorize handoff', () => {
  const local = { ancestors: [42, 1] }, unknown = { ancestors: [99, 1] };
  assert.deepEqual(handoffSources([], new Set(), false, false), []);
  assert.throws(() => handoffSources([unknown], new Set(), false, false), /identification/);
  assert.deepEqual(handoffSources([local, unknown], new Set([42]), false, true), [local]);
  assert.deepEqual(handoffSources([local, unknown], new Set([42]), true, false), [local]);
});

test('persisted creation metadata re-adopts the live session after host recreation', () => {
  const options = JSON.parse(JSON.stringify(persistentTerminalOptions('owner-one')));
  assert.equal(options.isTransient, false);
  assert.equal(restoredTerminalSession(options.env, 'owner-one', 42, new Map([[42, 'changed-session']])), 'changed-session');
});

test('native revival requires a matching process marker and a live session mapping', async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    env: { PATH: process.env.PATH, [TERMINAL_OWNER_ENV]: 'fixture-owner' }, stdio: 'ignore',
  });
  t.after(() => child.kill('SIGKILL'));
  await once(child, 'spawn');
  const pid = child.pid!;
  const owned = await terminalProcessOwned(pid, 'fixture-owner');
  assert.equal(owned, true);
  assert.equal(await terminalProcessOwned(pid, 'foreign-owner'), false);
  assert.equal(restoredTerminalSession(undefined, 'fixture-owner', pid, new Map([[pid, 'session']]), owned), 'session');
  assert.equal(restoredTerminalSession(undefined, 'fixture-owner', pid, new Map(), owned), undefined);
  assert.equal(restoredTerminalSession({ [TERMINAL_OWNER_ENV]: 'foreign-owner' }, 'fixture-owner', pid, new Map([[pid, 'session']]), owned), undefined);
});

test('restoration rejects unrelated terminals and missing live identity', () => {
  const sessions = new Map([[42, 'session']]);
  assert.equal(restoredTerminalSession(undefined, 'owner-one', 42, sessions), undefined);
  assert.equal(restoredTerminalSession({ [TERMINAL_OWNER_ENV]: 'other' }, 'owner-one', 42, sessions), undefined);
  const env = persistentTerminalOptions('owner-one').env;
  assert.equal(restoredTerminalSession(env, 'owner-one', undefined, sessions), undefined);
  assert.equal(restoredTerminalSession(env, 'owner-one', 43, sessions), undefined);
  assert.equal(restoredTerminalSession(env, '', 42, sessions), undefined);
});
