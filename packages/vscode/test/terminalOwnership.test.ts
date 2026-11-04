import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistentTerminalOptions, restoredTerminalSession, TERMINAL_OWNER_ENV } from '../src/terminalOwnership.js';

test('persisted creation metadata re-adopts the live session after host recreation', () => {
  const options = JSON.parse(JSON.stringify(persistentTerminalOptions('owner-one')));
  assert.equal(options.isTransient, false);
  assert.equal(restoredTerminalSession(options.env, 'owner-one', 42, new Map([[42, 'changed-session']])), 'changed-session');
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
