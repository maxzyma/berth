import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.js';
import { geminiCursor, geminiInactive } from '../src/agents/gemini-state.js';

const encode = (record: unknown) => `${JSON.stringify(record)}\n`;
const cancellation = () => ({ id: 'native-event', type: 'info', timestamp: new Date().toISOString(), content: 'Request cancelled.' });

test('CR59 transcript cursor excludes old, foreign, partial and untyped cancellation', (t) => {
  const sb = sandbox(t), root = join(sb.env.HOME!, '.gemini');
  mkdirSync(root, { recursive: true });
  const file = join(root, 'session.jsonl'), header = encode({ sessionId: 'exact-id' });
  writeFileSync(file, header + encode(cancellation()));
  const cursor = geminiCursor(file, 'exact-id', sb.env);
  assert.ok(cursor);
  assert.equal(geminiInactive(cursor, 'exact-id', sb.env), false, 'old cancellation');
  for (const record of [{ ...cancellation(), type: 'user' }, { ...cancellation(), type: 'gemini' },
    { ...cancellation(), content: ['Request cancelled.'] }, { ...cancellation(), timestamp: '2000-01-01T00:00:00Z' },
    { ...cancellation(), timestamp: new Date(Date.now() + 100000).toISOString() }, { unknown: true }]) {
    const requestCursor = geminiCursor(file, 'exact-id', sb.env);
    appendFileSync(file, encode(record));
    assert.equal(geminiInactive(requestCursor, 'exact-id', sb.env), false);
    // A fresh request advances beyond irrelevant or unknown prior records.
    writeFileSync(file, header + encode(cancellation()));
  }
  const fresh = geminiCursor(file, 'exact-id', sb.env);
  appendFileSync(file, encode(cancellation()));
  assert.equal(geminiInactive(fresh, 'exact-id', sb.env), true);
  assert.equal(geminiInactive(fresh, 'foreign-id', sb.env), false);
  assert.equal(geminiCursor(file, 'foreign-id', sb.env), '');
  assert.equal(geminiInactive(fresh, 'exact-id', { HOME: sb.makeDir('other-home') }), false);
  appendFileSync(file, '{');
  assert.equal(geminiInactive(fresh, 'exact-id', sb.env), false, 'partial record');
  assert.equal(geminiCursor(file, 'exact-id', sb.env), '');
});

test('CR59 changed files and later turns cannot acknowledge an old cancellation', (t) => {
  const sb = sandbox(t), root = join(sb.env.HOME!, '.gemini');
  mkdirSync(root, { recursive: true });
  const file = join(root, 'session.jsonl'), header = encode({ sessionId: 'exact-id' });
  writeFileSync(file, header);
  const cursor = geminiCursor(file, 'exact-id', sb.env);
  appendFileSync(file, encode(cancellation()) + encode({ $rewindTo: 'cancelled-user-message' }) + encode({ $set: { lastUpdated: new Date().toISOString() } }));
  assert.equal(geminiInactive(cursor, 'exact-id', sb.env), true);
  appendFileSync(file, encode({ id: 'next', type: 'user', content: 'next request' }));
  assert.equal(geminiInactive(cursor, 'exact-id', sb.env), false);
  writeFileSync(file, header.replace('exact-id', 'other-id') + encode(cancellation()));
  assert.equal(geminiInactive(cursor, 'exact-id', sb.env), false);
  writeFileSync(file, header);
  const replacement = `${file}.new`;
  writeFileSync(replacement, header + encode(cancellation())); renameSync(replacement, file);
  assert.equal(geminiInactive(cursor, 'exact-id', sb.env), false, 'replacement inode');
});

test('CR59 bounded tail can observe a native cancellation after a large response', (t) => {
  const sb = sandbox(t), root = join(sb.env.HOME!, '.gemini');
  mkdirSync(root, { recursive: true });
  const file = join(root, 'session.jsonl');
  writeFileSync(file, encode({ sessionId: 'exact-id' }));
  const cursor = geminiCursor(file, 'exact-id', sb.env);
  appendFileSync(file, encode({ type: 'gemini', content: 'x'.repeat(2 * 1024 * 1024) }) + encode(cancellation()));
  assert.equal(geminiInactive(cursor, 'exact-id', sb.env), true);
});


test('CR61 native errors need loop completion and cannot override a later response', (t) => {
  const sb = sandbox(t), root = join(sb.env.HOME!, '.gemini');
  mkdirSync(root, { recursive: true });
  const file = join(root, 'session.jsonl');
  writeFileSync(file, encode({ sessionId: 'exact-id' }));
  const cursor = geminiCursor(file, 'exact-id', sb.env);
  for (const content of [undefined, [], '', '  ']) {
    appendFileSync(file, encode({ ...cancellation(), type: 'error', content }));
    assert.equal(geminiInactive(cursor, 'exact-id', sb.env, true), false, 'unknown error schema');
  }
  appendFileSync(file, encode({ ...cancellation(), type: 'error', content: 'Provider error' }));
  assert.equal(geminiInactive(cursor, 'exact-id', sb.env), false, 'error during active work is insufficient');
  assert.equal(geminiInactive(cursor, 'exact-id', sb.env, true), true, 'error after loop end');
  appendFileSync(file, encode({ ...cancellation(), content: 'This request failed. Press F12 for diagnostics, or run /settings and change "Error Verbosity" to full for full details.' }));
  assert.equal(geminiInactive(cursor, 'exact-id', sb.env, true), true, 'reduced verbosity summary');
  appendFileSync(file, encode({ ...cancellation(), type: 'gemini', content: 'Successful response' }));
  assert.equal(geminiInactive(cursor, 'exact-id', sb.env, true), false, 'later success');
});
