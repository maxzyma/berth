import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, openSync, closeSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { rolloutBinding, writableFiles, codexProcessBinding } from '../src/agents/codex-binding.js';
import { sessionProducers } from '../src/registry/discover.js';
import { shellQuote } from '../src/shell.js';
import { sandbox, waitFor } from './helpers.js';

const ID = '11111111-2222-4333-8444-555555555555';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
function rollout(root: string, change: Record<string, unknown> = {}) {
  const dir = join(root, 'sessions', '2026', '11', '02');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-2026-11-02T00-00-00-${ID}.jsonl`);
  writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: ID, source: 'cli', ...change } }) + '\n');
  return file;
}

test('native header validates exact ID, CLI source and root, without directory recency', t => {
  const sb = sandbox(t), root = sb.makeDir('codex-profile');
  assert.deepEqual(rolloutBinding(rollout(root)), { conversation: ID, root: realpathSync(root) });
  for (const change of [{ id: OTHER }, { source: 'vscode' }, { source: { subagent: 'worker' } }, { parent_thread_id: OTHER }]) {
    assert.equal(rolloutBinding(rollout(root, change)), undefined);
  }
  const file = rollout(root);
  writeFileSync(file, '{incomplete');
  assert.equal(rolloutBinding(file), undefined);
});

test('descriptor ownership excludes readers, other processes and nonnumeric descriptors', () => {
  const data = 'p42\nf3\nar\nn/read\nf4\naw\nn/write\nf5\nau\nn/update\nfcwd\nau\nn/not-descriptor\np43\nf7\naw\nn/foreign\n';
  assert.deepEqual(writableFiles(data, 42), ['/write', '/update']);
});

for (const conflict of [false, true]) test(`first installation observes native writer without hooks; existing conflict=${conflict}`, async t => {
  const sb = sandbox(t), ctx = sb.ctx(), root = sb.makeDir('codex-profile');
  const file = rollout(root), agent = join(sb.root, 'codex');
  writeFileSync(agent, `const fs = require('fs'); const fd = fs.openSync(${JSON.stringify(file)}, 'a'); setInterval(() => fs.fstatSync(fd), 1000);`);
  ctx.tmux.newSession('native', sb.root, `${shellQuote(process.execPath)} ${shellQuote(agent)}`);
  await waitFor(() => sessionProducers(ctx, 'native')[0], 'Codex writer process');
  if (conflict) ctx.tmux.setMeta('native', { agent: 'codex', conversation: OTHER });
  // Wait for the child to open its rollout before the first optional probe.
  const { spawnSync } = await import('node:child_process');
  const producer = sessionProducers(ctx, 'native')[0];
  await waitFor(() => spawnSync('lsof', ['-p', String(producer.pid), '-Fn'], { encoding: 'utf8' }).stdout.includes(file), 'open rollout');
  sb.cli('ls');
  const row = ctx.tmux.listSessions()[0];
  assert.equal(row.meta.conversation, conflict ? OTHER : ID);
  if (!conflict) {
    assert.ok(row.meta.producerLifetime);
    assert.equal(JSON.parse(row.meta.profile!).environment.CODEX_HOME, realpathSync(root));
    assert.equal(row.meta.bindingIssue, undefined);
    sb.cli('ls');
    assert.equal(ctx.store.newest()?.sessions[0].conversation, ID);
  }
});


test('multiple writer rollouts and wrong process lifetime cannot establish identity', async t => {
  const sb = sandbox(t);
  const first = rollout(sb.makeDir('one')), second = rollout(sb.makeDir('two'));
  const fds = [openSync(first, 'a'), openSync(second, 'a')];
  t.after(() => fds.forEach(fd => closeSync(fd)));
  const { processLifetime } = await import('../src/process-owner.js');
  assert.equal(codexProcessBinding(process.pid, 'stale-process'), undefined);
  assert.equal(codexProcessBinding(process.pid, processLifetime(process.pid)!.key), undefined);
});
