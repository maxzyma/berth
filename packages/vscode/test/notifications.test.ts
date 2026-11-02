import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchNotification, notificationCommand, notificationChannel } from '../src/notifications.js';

test('CR48 missing or non-executable notification helpers are contained', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'berth-test-notification-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(await launchNotification(join(root, 'missing'), []), false);
  const blocked = join(root, 'blocked');
  writeFileSync(blocked, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
  assert.equal(await launchNotification(blocked, []), false);
  assert.equal(await launchNotification(process.execPath, ['-e', 'process.exit(0)']), true);
});

test('CR48 notification invocation preserves arguments and platform fallbacks', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'berth-test-notifier-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const notifier = join(root, 'terminal-notifier');
  writeFileSync(notifier, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const body = 'Approval: "quotes", $HOME and `literal`';
  assert.deepEqual(notificationCommand('Berth', body, 'Visual Studio Code', 'darwin', { PATH: root }), {
    command: notifier, args: ['-title', 'Berth', '-message', body, '-activate', 'com.microsoft.VSCode'],
  });
  assert.deepEqual(notificationCommand('Berth', body, 'Unknown editor', 'darwin', { PATH: root }), {
    command: notifier, args: ['-title', 'Berth', '-message', body],
  });
  assert.deepEqual(notificationCommand('Berth', body, 'Visual Studio Code', 'darwin', { PATH: '' }), {
    command: 'osascript', args: ['-e', `display notification ${JSON.stringify(body)} with title "Berth"`],
  });
  assert.deepEqual(notificationCommand('Berth', body, 'Visual Studio Code', 'linux'), {
    command: 'notify-send', args: ['Berth', body],
  });
  assert.equal(notificationCommand('Berth', body, 'Visual Studio Code', 'win32'), undefined);
});


test('quiet lifecycle selects one notification channel and never duplicates visible work', () => {
  assert.equal(notificationChannel('waiting', true, true, true), 'none');
  assert.equal(notificationChannel('done', true, false, true), 'none');
  assert.equal(notificationChannel('waiting', true, false, true), 'editor');
  for (const state of ['waiting', 'done'] as const) {
    assert.equal(notificationChannel(state, false, true, true), 'system');
    assert.equal(notificationChannel(state, false, false, false), 'editor');
  }
});
