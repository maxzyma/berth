import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLayoutQueue } from '../src/layoutRuntime.js';
import { LayoutStore } from '../src/layoutStore.js';

test('Legacy inspection preserves the journal and does not migrate memento state', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'berth-test-layout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'layout.json');
  const legacy = { schema: 1 as const, backup: { 'workbench.sideBar.location': 'left' }, applied: { 'workbench.sideBar.location': 'right' }, version: 7 };
  const store = new LayoutStore(file, () => legacy);
  assert.deepEqual(store.read(), legacy);
  assert.equal(existsSync(file), false);
  const bytes = JSON.stringify(legacy);
  writeFileSync(file, bytes);
  assert.deepEqual(store.read(), legacy);
  assert.equal(readFileSync(file, 'utf8'), bytes);
  writeFileSync(file, '{broken');
  assert.throws(() => store.read());
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});

test('Earlier layout evidence exists only when a journal or legacy state holds something', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'berth-test-layout-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'layout.json');
  assert.equal(new LayoutStore(file).hasEvidence(), false, 'no journal and no legacy state');
  assert.equal(new LayoutStore(file, () => ({ schema: 1, backup: {}, applied: {}, version: 3 })).hasEvidence(), true);
  writeFileSync(file, JSON.stringify({ schema: 1, backup: { 'workbench.sideBar.location': 'left' }, applied: {} }));
  assert.equal(new LayoutStore(file).hasEvidence(), true);
  writeFileSync(file, '{broken');
  assert.equal(new LayoutStore(file).hasEvidence(), true, 'a damaged journal is still evidence to inspect');
});

test('queued profile creation waits for prior requests and continues after an earlier failure', async () => {
  const enqueue = createLayoutQueue(), order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const apply = enqueue(async () => { order.push('apply'); await gate; throw new Error('fixture failure'); });
  const failure = assert.rejects(apply, /fixture failure/);
  const revert = enqueue(async () => { order.push('revert'); });
  await Promise.resolve();
  assert.deepEqual(order, ['apply']);
  release();
  await Promise.all([failure, revert]);
  assert.deepEqual(order, ['apply', 'revert']);
});
