import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverNotification, launchNotification, notificationCommand, notificationChannel } from '../src/notifications.js';

test('CR48 missing or non-executable notification helpers are contained', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'berth-test-notification-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(await launchNotification(join(root, 'missing'), []), false);
  const blocked = join(root, 'blocked');
  writeFileSync(blocked, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
  assert.equal(await launchNotification(blocked, []), false);
  assert.equal(await launchNotification(process.execPath, ['-e', 'process.exit(0)']), true);
  assert.equal(await launchNotification(process.execPath, ['-e', 'process.exit(1)']), false);
});

test('remote workspaces notify through the client editor instead of the server desktop', () => {
  for (const state of ['waiting', 'done'] as const) {
    assert.equal(notificationChannel(state, false, false, true, true), 'editor');
    assert.equal(notificationChannel(state, false, true, true, true), 'editor');
  }
  assert.equal(notificationChannel('waiting', true, true, true, true), 'none');
});

test('a stalled notification helper cannot block the editor fallback', async () => {
  assert.equal(await launchNotification(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"]), false);
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


test('quiet lifecycle suppresses visible work and chooses the attention channel', () => {
  assert.equal(notificationChannel('waiting', true, true, true), 'none');
  assert.equal(notificationChannel('done', true, false, true), 'none');
  assert.equal(notificationChannel('waiting', true, false, true), 'editor');
  for (const state of ['waiting', 'done'] as const) {
    assert.equal(notificationChannel(state, false, true, true), 'system');
    assert.equal(notificationChannel(state, false, false, false), 'editor');
  }
});

test('Open is available before system delivery completes and is not duplicated on failure', async () => {
  for (const success of [true, false]) {
    let actions = 0;
    let finish!: (ok: boolean) => void;
    const delivered = deliverNotification('system', () => { actions += 1; },
      () => new Promise<boolean>(resolve => { finish = resolve; }));
    assert.equal(actions, 1);
    finish(success);
    await delivered;
    assert.equal(actions, 1);
  }
  await deliverNotification('none', () => assert.fail('visible work must stay quiet'),
    async () => { assert.fail('must not launch a system helper'); });
  let actions = 0;
  await deliverNotification('editor', () => { actions += 1; },
    async () => { assert.fail('editor-only must not launch a system helper'); });
  assert.equal(actions, 1);
});
