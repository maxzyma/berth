import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.js';
import { copilotCursor, copilotState } from '../src/agents/copilot-state.js';

const copilotInactive = (...args: Parameters<typeof copilotState>) => copilotState(...args) === '';

const event = (type: string, data: object) => `${JSON.stringify({ type, data, timestamp: new Date().toISOString() })}\n`;

test('CR64 Copilot terminal outcomes require current native turn completion', (t) => {
  const sb = sandbox(t);
  sb.env.COPILOT_HOME = sb.makeDir('copilot');
  const dir = join(sb.env.COPILOT_HOME, 'session-state', 'exact');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'events.jsonl');
  writeFileSync(file, event('session.start', { sessionId: 'exact' }));
  const cursor = copilotCursor('exact', sb.env);
  assert.ok(cursor);
  const check = () => copilotInactive(cursor, 'exact', sb.env);
  appendFileSync(file, event('user.message', { parentAgentTaskId: 'native-root-request-task' })
    + event('assistant.turn_start', { turnId: '0' })
    + event('hook.start', { hookType: 'errorOccurred', input: { recoverable: true } })
    + event('hook.end', { success: true }));
  assert.equal(check(), false, 'retry error hook must not clear working');
  appendFileSync(file, event('session.error', { errorType: 'authentication', message: 'failure' }));
  assert.equal(check(), false, 'missing turn-end');
  appendFileSync(file, event('assistant.turn_end', { turnId: 'other' }) + event('session.error', { errorType: 'authentication', message: 'failure' }));
  assert.equal(check(), false, 'mismatched turn end');
  appendFileSync(file, event('assistant.turn_end', { turnId: '0' }));
  assert.equal(check(), false, 'turn-end alone does not establish failure');
  appendFileSync(file, event('session.error', { errorType: 'authentication', message: 'failure' }));
  assert.equal(check(), true);
  assert.equal(copilotInactive(cursor, 'foreign', sb.env), false);
  assert.equal(copilotInactive(cursor, 'exact', { HOME: sb.makeDir('foreign-home') }), false);
  assert.equal(copilotCursor('../exact', sb.env), '');
  const nextCursor = copilotCursor('exact', sb.env);
  assert.equal(copilotInactive(nextCursor, 'exact', sb.env), false, 'old outcome');
  appendFileSync(file, event('user.message', { content: 'next' }));
  assert.equal(check(), false, 'later request invalidates old error');
  appendFileSync(file, event('assistant.turn_end', { turnId: '0' }) + event('abort', { reason: 'user_initiated' }));
  assert.equal(copilotInactive(nextCursor, 'exact', sb.env), true);
  appendFileSync(file, '{');
  assert.equal(check(), false, 'partial row');
});

test('CR64 malformed or child outcomes cannot acknowledge a root failure', (t) => {
  const sb = sandbox(t);
  sb.env.COPILOT_HOME = sb.makeDir('copilot');
  const dir = join(sb.env.COPILOT_HOME, 'session-state', 'exact');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'events.jsonl');
  for (const data of [{}, { message: 'failure' }, { errorType: 'failure', message: [] },
    { errorType: 'failure', message: ' ' }, { errorType: 'failure', message: 'failed', parentAgentTaskId: 'child' }]) {
    writeFileSync(file, event('session.start', { sessionId: 'exact' }));
    const cursor = copilotCursor('exact', sb.env);
    appendFileSync(file, event('assistant.turn_end', { turnId: '0' }) + event('session.error', data));
    assert.equal(copilotInactive(cursor, 'exact', sb.env), false);
  }
});

test('CR65 Copilot approval reconciliation waits for every request and a new model turn', (t) => {
  const sb = sandbox(t);
  sb.env.COPILOT_HOME = sb.makeDir('copilot');
  const dir = join(sb.env.COPILOT_HOME, 'session-state', 'exact');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'events.jsonl');
  writeFileSync(file, event('session.start', { sessionId: 'exact' }));
  const cursor = copilotCursor('exact', sb.env);
  const state = () => copilotState(cursor, 'exact', sb.env);
  const requested = (requestId: string, tool: string) => event('permission.requested', {
    requestId, ownerSessionId: 'exact', permissionRequest: { toolCallId: tool },
  });
  const completed = (requestId: string, toolCallId: string) => event('permission.completed', {
    requestId, toolCallId, result: { kind: 'approved' },
  });
  appendFileSync(file, requested('first', 'tool-one') + requested('second', 'tool-two') + completed('first', 'tool-one'));
  assert.equal(state(), undefined, 'one unresolved approval');
  appendFileSync(file, event('assistant.turn_start', { turnId: 'next' }));
  assert.equal(state(), undefined, 'model work alone cannot erase pending approval');
  appendFileSync(file, completed('second', 'tool-two'));
  assert.equal(state(), undefined, 'decisions alone do not establish resumed model work');
  appendFileSync(file, event('assistant.turn_start', { turnId: 'next' }));
  assert.equal(state(), 'working');
  appendFileSync(file, event('assistant.turn_end', { turnId: 'next' }));
  assert.equal(state(), undefined, 'completed work cannot be reopened by earlier decisions');
  appendFileSync(file, event('user.message', { content: 'new turn' }) + event('assistant.turn_start', { turnId: '0' }));
  assert.equal(state(), undefined, 'decisions belong to their prompt');
  appendFileSync(file, completed('unknown', 'tool-other'));
  assert.equal(state(), undefined, 'unknown completion fails closed');
});
