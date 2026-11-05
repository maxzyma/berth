import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { codexEvents, codexNativeRecord, codexRollout } from '../src/agents/codex-native.js';
import { sandbox } from './helpers.js';

const id = '11111111-2222-3333-4444-555555555555';
const other = '22222222-2222-3333-4444-555555555555';
const event = (type: string, values = {}) => JSON.stringify({ type: 'event_msg', payload: { type, ...values } });
function fixture(t: Parameters<typeof sandbox>[0]) {
  const sb = sandbox(t), root = sb.makeDir('codex-home');
  const dir = join(root, 'sessions', '2026', '01', '01');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-2026-01-01-${id}.jsonl`);
  const header = JSON.stringify({ type: 'session_meta', payload: { id, source: 'cli' } });
  writeFileSync(file, `${header}\n${event('user_message', { message: 'Current task\nprivate next line' })}\n${event('task_started')}\n`);
  const db = join(root, 'state_5.sqlite');
  const sql = `CREATE TABLE threads(id TEXT,rollout_path TEXT,source TEXT,archived INT); INSERT INTO threads VALUES('${id}','${file.replace(/'/g, "''")}','cli',0);`;
  assert.equal(spawnSync('sqlite3', [db, sql]).status, 0);
  return { root, file, header };
}

test('exact native ID lookup yields only typed root prompt and lifecycle', t => {
  const f = fixture(t);
  assert.equal(codexNativeRecord(f.root, id)?.topic, 'Current task');
  assert.equal(codexNativeRecord(f.root, id)?.state, 'working');
  assert.equal(codexNativeRecord(f.root, other), undefined);
  assert.equal(codexNativeRecord(f.root, "' OR 1=1"), undefined);
  appendFileSync(f.file, `${JSON.stringify({ type: 'response_item', payload: { type: 'task_complete' } })}\n`);
  assert.equal(codexNativeRecord(f.root, id)?.state, 'working');
  appendFileSync(f.file, `${event('task_complete')}\n`);
  assert.equal(codexNativeRecord(f.root, id)?.state, 'done');
  appendFileSync(f.file, `${event('turn_aborted')}\n`);
  assert.equal(codexNativeRecord(f.root, id)?.state, '');
});

test('child, mismatched root, partial and invalid rollout evidence never binds', t => {
  const f = fixture(t);
  assert.equal(codexRollout(join(f.root, 'other'), id, f.file), undefined);
  writeFileSync(f.file, `${JSON.stringify({ type: 'session_meta', payload: { id, source: { subagent: 'spawn' } } })}\n`);
  assert.equal(codexNativeRecord(f.root, id), undefined);
  writeFileSync(f.file, `${f.header}\n${event('task_started')}`);
  assert.equal(codexNativeRecord(f.root, id), undefined);
  writeFileSync(f.file, `${f.header}\nnot json\n`);
  assert.equal(codexNativeRecord(f.root, id), undefined);
});

test('topic sanitization is bounded and unknown events cannot report completion', () => {
  const result = codexEvents([event('user_message', { message: 'x'.repeat(150) }), event('unrecognized')]);
  assert.equal(result.topic?.length, 120);
  assert.equal(result.state, 'working');
});


test('typed native UserMessage items supply prompts without trusting raw user-role context', () => {
  const items = [JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'context, not task' }] } }),
    event('item_completed', { thread_id: id, item: { type: 'UserMessage', content: [{ type: 'text', text: 'Actual task' }] } }),
    event('item_completed', { thread_id: other, item: { type: 'UserMessage', content: [{ type: 'text', text: 'Foreign task' }] } })];
  assert.equal(codexEvents(items, id).topic, 'Actual task');
});
