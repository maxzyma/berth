import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventTime, hookActivityTiming, readActivityTiming } from '../src/agents/activity-timing.js';
import { codexEvents } from '../src/agents/codex-native.js';
import { sandbox } from './helpers.js';

const start = Date.parse('2026-01-01T12:00:00Z');
test('Hook times retain repeated states and distinguish a new turn from resumed work', () => {
  const first = hookActivityTiming(undefined, '', 'working', true, start);
  assert.equal(hookActivityTiming(first, 'working', 'working', false, start + 1000), first);
  const waiting = hookActivityTiming(first, 'working', 'waiting', false, start + 2000);
  const resumed = readActivityTiming(hookActivityTiming(waiting, 'waiting', 'working', false, start + 3000), 'working', start + 4000)!;
  assert.equal(resumed.turnStartedAt, new Date(start).toISOString());
  assert.equal(resumed.stateSince, new Date(start + 3000).toISOString());
  const next = readActivityTiming(hookActivityTiming(first, 'working', 'working', true, start + 4000), 'working', start + 4000)!;
  assert.equal(next.turnStartedAt, new Date(start + 4000).toISOString());
  assert.equal(hookActivityTiming(first, 'working', '', false), '');
});

test('Unknown, future, inconsistent and mismatched timing evidence is omitted', () => {
  assert.equal(eventTime('tomorrow'), undefined);
  assert.equal(eventTime(new Date(start + 1).toISOString(), start), undefined);
  assert.equal(readActivityTiming('broken', 'working'), undefined);
  const raw = hookActivityTiming(undefined, '', 'working', true, start);
  assert.equal(readActivityTiming(raw, 'done'), undefined);
  assert.equal(readActivityTiming(raw, 'working', start - 1), undefined);
});

test('Native timing comes from typed events, never sampling time or file writes', () => {
  const event = (type: string, timestamp?: string) => JSON.stringify({ type: 'event_msg', timestamp, payload: { type } });
  const lines = [event('task_started', new Date(start).toISOString()), event('task_complete', new Date(start + 5000).toISOString())];
  const first = codexEvents(lines).activityTiming!;
  assert.equal(first.turnStartedAt, new Date(start).toISOString());
  assert.equal(first.stateSince, new Date(start + 5000).toISOString());
  assert.deepEqual(codexEvents(lines).activityTiming, first);
  assert.equal(codexEvents([event('task_complete')]).activityTiming, undefined);
  assert.equal(codexEvents([...lines, event('turn_aborted')]).activityTiming, undefined);
});

test('State writes without timestamp evidence clear old timing', t => {
  const sb = sandbox(t), ctx = sb.ctx();
  ctx.tmux.newSession('time', sb.root, 'sleep 30');
  ctx.tmux.setMeta('time', { state: 'working', activityTiming: hookActivityTiming(undefined, '', 'working', true, start) });
  assert.ok(ctx.tmux.listSessions()[0].meta.activityTiming);
  ctx.tmux.setMeta('time', { state: 'done' });
  assert.equal(ctx.tmux.listSessions()[0].meta.activityTiming, undefined);
});
