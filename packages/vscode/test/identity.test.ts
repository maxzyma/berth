import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionRow } from '@berthdev/berth';
import { rowView } from '../src/model.js';

const row: SessionRow = { name: 'job-2', agent: 'codex', managed: true, cwd: '/workspace/product', conversation: 'exact-id', conversationTitle: 'Fix search', origin: 'iterm2', state: 'working', note: '', topic: '', hooks: 'installed', live: true, attachedClients: 2, connections: [
  { pid: 30, ancestors: [30, 20], terminal: '/dev/ttys1', application: 'VS Code' },
  { pid: 50, ancestors: [50, 40], terminal: '/dev/ttys2', application: 'iTerm2' },
] };
const input = { here: new Set<string>(), terminalPids: new Set([20]), unread: new Set<string>(), branch: () => '' };

test('manual local attachment and remote clients are both visible', () => {
  const view = rowView(row, input);
  assert.equal(view.details, 'VS Code · This window +1');
  assert.ok(view.hover.some((line) => line.text.includes('iTerm2')));
  assert.ok(view.hover.some((line) => line.text === 'Conversation: Fix search'));
  assert.ok(view.hover.some((line) => line.text === 'Conversation ID: exact-id'));
  assert.equal(view.name, 'job-2');
  assert.equal(view.location.hostApplication, 'VS Code');
  assert.equal(view.location.currentWindow, true);
  assert.equal(view.hover.find(line => line.hostApplication === 'iTerm2')?.currentWindow, false);
});

test('stale local bookkeeping and origin do not determine connection', () => {
  const view = rowView({ ...row, connections: [], attachedClients: 0 }, { ...input, here: new Set(['job-2']) });
  assert.equal(view.details, 'detached');
  assert.equal(view.icon, 'working');
  assert.equal(rowView({ ...row, connections: [], attachedClients: 1 }, input).details, 'Connected');
  assert.equal(rowView({ ...row, live: false }, input).details, 'stopped');
});


test('broken hooks expose repair and uncertain arguments expose review', () => {
  const view = rowView({ ...row, hooks: 'broken', live: false, recoveryOptionsRequired: true }, input);
  assert.match(view.contextValue, /hooks-missing/);
  assert.ok(view.hover.some((line) => line.kind === 'warning' && /incomplete/.test(line.text)));
  assert.ok(view.hover.some((line) => /unsupported syntax/.test(line.text)));
});

test('CR32 configured hooks display native activation guidance as information', () => {
  const hookSetup = 'Codex manages hook trust in /hooks. Review new or changed Berth hooks there before they can run.';
  const view = rowView({ ...row, hookSetup }, input);
  assert.ok(view.hover.some((line) => line.icon === 'info' && line.text === hookSetup));
  assert.doesNotMatch(view.contextValue, /hooks-missing/);
});

test('live client evidence outranks an older zero count while window identity resolves', () => {
  const stale = { ...row, attachedClients: 0 };
  const pending = rowView(stale, { ...input, terminalPids: new Set<number>(), terminalPidsReady: false });
  assert.match(pending.contextValue, /attached-unknown/);
  assert.ok(pending.hover.some(line => /window has not yet been identified/.test(line.text)));
  const ready = rowView(stale, input);
  assert.match(ready.contextValue, /attached-here/);
  assert.equal(ready.location.icon, 'terminal');
  assert.equal(ready.location.currentWindow, true);
  assert.equal(ready.location.additional, 1);
  const elsewhere = rowView(stale, { ...input, terminalPids: new Set([99]) });
  assert.match(elsewhere.contextValue, /attached-elsewhere/);
  assert.equal(elsewhere.location.icon, 'terminal');
  assert.equal(elsewhere.location.hostApplication, 'VS Code');
  assert.match(rowView({ ...row, attachedClients: 0, connections: [] }, input).contextValue, /detached/);
});

test('the local host icon is selected from the same sorted connection as its label', () => {
  const view = rowView({ ...row, connections: [...row.connections!].reverse() }, input);
  assert.equal(view.location.hostApplication, 'VS Code');
  assert.equal(view.location.currentWindow, true);
  const external = rowView(row, { ...input, terminalPids: new Set([99]) });
  assert.equal(external.location.currentWindow, false);
});

test('working suppresses old unread decoration while retaining the read marker', () => {
  const view = rowView(row, { ...input, unread: new Set([row.name]) });
  assert.equal(view.unread, true);
  assert.equal(view.icon, 'working');
  assert.equal(view.attention, '');
  assert.equal(view.hover[0].chip?.tone, 'muted');
  const waiting = rowView({ ...row, state: 'waiting' }, { ...input, unread: new Set([row.name]) });
  assert.equal(waiting.attention, 'waiting');
});


test('Visible terminal preview is a live-only fallback with explicit hover provenance', () => {
  const previewRow = { ...row, topic: '', conversationTitle: '', terminalPreview: 'Visible question' };
  const view = rowView(previewRow, input);
  assert.equal(view.subtitle, 'Visible question');
  assert.ok(view.hover.some(line => line.text === 'Visible terminal prompt: Visible question'));
  assert.equal(rowView({ ...previewRow, topic: 'Verified task' }, input).subtitle, 'Verified task');
  assert.equal(rowView({ ...previewRow, conversationTitle: 'Verified title' }, input).subtitle, 'Verified title');
  assert.equal(rowView({ ...previewRow, live: false }, input).subtitle, '');
});

test('a stopped session offers only the recovery repairs its blockers need', () => {
  const stopped = { ...row, live: false, profile: { environment: { HOME: '/home/test' } } };
  const tokens = (value: SessionRow) => rowView(value, input).contextValue.split(' ').filter(token => ['cwd-missing', 'profile-unknown', 'options-required'].includes(token));
  assert.deepEqual(tokens(stopped), [], 'nothing to repair');
  assert.deepEqual(tokens({ ...stopped, cwdMissing: true, profile: undefined, recoveryOptionsRequired: true }), ['cwd-missing', 'profile-unknown', 'options-required']);
  assert.deepEqual(tokens({ ...stopped, agent: 'shell', profile: undefined, recoveryOptionsRequired: true }), [], 'a shell has no agent profile or options');
  assert.deepEqual(tokens({ ...stopped, live: true, cwdMissing: true, profile: undefined }), [], 'a running session is not repaired from here');
});
