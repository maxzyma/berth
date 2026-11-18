import { test } from 'node:test';
import assert from 'node:assert/strict';
import { list, rename } from '../src/registry/sessions.js';
import { killServer, sandbox } from './helpers.js';

// spec §4.2: one agent conversation, one Berth session.
const X = '11111111-2222-4333-8444-555555555555';
const Y = '66666666-7777-4888-8999-aaaaaaaaaaaa';

test('the Berth session whose binding changed last keeps a shared agent conversation; the other shows a conflict', async (t) => {
  const sb = sandbox(t);
  const dir = sb.makeDir('work');
  for (const name of ['first', 'second']) assert.equal(sb.cli('new', 'claude', '--cwd', dir, '--name', name).status, 0);
  const ctx = sb.ctx();
  ctx.tmux.setMeta('second', { conversation: X });
  await new Promise((resolve) => setTimeout(resolve, 5));
  ctx.tmux.setMeta('first', { conversation: X }); // first resumed X last
  const boundAt = ctx.tmux.listSessions().find((s) => s.name === 'first')?.meta.boundAt;
  ctx.tmux.setMeta('first', { conversation: X });
  assert.equal(ctx.tmux.listSessions().find((s) => s.name === 'first')?.meta.boundAt, boundAt, 'the same ID again is not a new binding');

  const rows = list(ctx);
  const first = rows.find((r) => r.name === 'first');
  const second = rows.find((r) => r.name === 'second');
  assert.equal(first?.bindingIssue, undefined, 'the latest binding keeps the agent conversation');
  assert.match(second?.bindingIssue ?? '', /also open in first/);
  assert.deepEqual(first?.sharedWith, ['second']);
  assert.deepEqual(second?.sharedWith, ['first']);

  assert.equal(sb.cli('snapshot').status, 0);
  const saved = ctx.store.newest()?.sessions ?? [];
  assert.equal(saved.find((s) => s.name === 'first')?.bindingIssue, undefined);
  assert.match(saved.find((s) => s.name === 'second')?.bindingIssue ?? '', /also open in first/, 'recovery skips the other');

  rename(ctx, 'second', 'second-2');
  assert.equal(ctx.tmux.listSessions().find((s) => s.name === 'second-2')?.meta.nameSync, undefined, 'only the keeper receives rename naming');
  rename(ctx, 'first', 'first-2');
  assert.equal(ctx.tmux.listSessions().find((s) => s.name === 'first-2')?.meta.nameSync, '1');
});

test('a stopped Berth session whose agent conversation now runs live elsewhere is dropped from listing and recovery', (t) => {
  const sb = sandbox(t);
  const dir = sb.makeDir('work');
  assert.equal(sb.cli('new', 'claude', '--cwd', dir, '--name', 'old').status, 0);
  sb.ctx().tmux.setMeta('old', { conversation: Y });
  assert.equal(sb.cli('snapshot').status, 0);
  killServer(sb);
  assert.equal(sb.cli('new', 'claude', '--cwd', dir, '--name', 'other').status, 0);
  const ctx = sb.ctx();
  assert.equal(list(ctx).find((r) => r.name === 'old')?.live, false, 'stopped before anything runs its conversation');
  ctx.tmux.setMeta('other', { conversation: Y });
  assert.equal(list(ctx).some((r) => r.name === 'old'), false);
  assert.equal(sb.cli('snapshot').status, 0);
  assert.equal(ctx.store.newest()?.sessions.some((s) => s.name === 'old'), false);
});
