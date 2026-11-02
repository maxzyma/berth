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
  assert.equal(view.details, 'This window +1');
  assert.ok(view.hover.some((line) => line.text.includes('iTerm2')));
  assert.ok(view.hover.some((line) => line.text === 'Conversation: Fix search'));
  assert.ok(view.hover.some((line) => line.text === 'Conversation ID: exact-id'));
  assert.equal(view.name, 'job-2');
});

test('stale local bookkeeping and origin do not determine connection', () => {
  const view = rowView({ ...row, connections: [], attachedClients: 0 }, { ...input, here: new Set(['job-2']) });
  assert.equal(view.details, 'detached');
  assert.equal(view.icon, 'working');
  assert.equal(rowView({ ...row, connections: [], attachedClients: 1 }, input).details, 'Other terminal');
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
