import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingTerminalPersistence, terminalPersistenceSettings } from '../src/terminalPersistence.js';

test('prepared Profile upgrade preserves opt-outs at every scope', () => {
  assert.deepEqual(missingTerminalPersistence(() => undefined), terminalPersistenceSettings);
  for (const scope of ['globalValue', 'workspaceValue', 'workspaceFolderValue']) {
    assert.deepEqual(missingTerminalPersistence(key => ({
      [scope]: key.endsWith('enablePersistentSessions') ? false : 'never',
    })), []);
  }
  assert.deepEqual(missingTerminalPersistence(key => key.endsWith('enablePersistentSessions')
    ? { globalValue: true } : undefined), [terminalPersistenceSettings[1]]);
});
