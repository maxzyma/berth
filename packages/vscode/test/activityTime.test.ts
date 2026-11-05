import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityTimeLines } from '../src/activityTime.js';
import type { SessionRow } from '@berthdev/berth';
const now = Date.parse('2026-01-01T12:05:00Z');
const started = '2026-01-01T12:00:00.000Z';
const row: SessionRow = { name: 'test', managed: true, agent: 'codex', cwd: '/fixture', conversation: '', origin: 'none', state: 'waiting', note: '', topic: '', attachedClients: 0, live: true, hooks: 'installed', activityTiming: { state: 'waiting', turnStartedAt: started, stateSince: '2026-01-01T12:02:00.000Z' } };
test('Hover time describes the event, includes absolute local time and copies ISO', () => {
  const lines = activityTimeLines(row, now);
  assert.equal(lines.length, 2);
  assert.match(lines[0].text, /^Turn started 5m ago · /);
  assert.match(lines[1].text, /^Waiting for 3m · /);
  assert.equal(lines[0].copyValue, started);
  assert.match(activityTimeLines({ ...row, state: 'done', activityTiming: { state: 'done', stateSince: started } }, now)[0].text, /^Finished 5m ago · /);
});
test('Hover omits unknown, stopped, mismatched, future and unverified times', () => {
  for (const change of [{ live: false }, { activityTiming: undefined }, { state: 'working' }, { bindingIssue: 'unverified' }]) {
    assert.deepEqual(activityTimeLines({ ...row, ...change }, now), []);
  }
  assert.deepEqual(activityTimeLines(row, now - 600_000), []);
});
