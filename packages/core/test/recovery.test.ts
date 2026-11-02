import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleHook } from '../src/agents/hooks.js';
import { ensure, retryRecovery, relocateRecovery } from '../src/restore/ensure.js';
import { end, list } from '../src/registry/sessions.js';
import { sandbox, killServer, waitFor } from './helpers.js';

function saved(sb: ReturnType<typeof sandbox>) {
  sb.cli('new', 'claude', '--cwd', sb.makeDir('project'), '--name', 'saved');
  sb.cli('stamp', '--session', 'saved', 'conversation=expected');
  killServer(sb);
}

function acknowledge(sb: ReturnType<typeof sandbox>, id: string) {
  const socket = sb.tmux('display-message', '-p', '-t', '=saved:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=saved:', '#{pane_id}').trim();
  return handleHook('claude', 'SessionStart', JSON.stringify({ session_id: id }), { ...sb.env, TMUX: `${socket},1,0`, TMUX_PANE: pane });
}

test('Resume request is confirmed only by the expected conversation; wrong IDs preserve identity', (t) => {
  const sb = sandbox(t);
  saved(sb);
  const ctx = sb.ctx();
  assert.equal(ensure(ctx)[0].outcome, 'resume-requested');
  assert.equal(list(ctx)[0].recovery, 'requested');
  acknowledge(sb, 'unexpected');
  assert.equal(list(ctx)[0].recovery, 'failed');
  assert.equal(list(ctx)[0].conversation, 'expected');
  assert.equal(ctx.store.newest()?.sessions[0].recovery, 'failed');
  acknowledge(sb, 'expected');
  assert.equal(list(ctx)[0].recovery, 'confirmed');
  assert.equal(sb.tmux('show-options', '-w', '-v', '-t', '=saved:', 'remain-on-exit').trim(), 'off', 'normal exit behavior restored after confirmation');
  acknowledge(sb, 'forked-after-confirmation');
  assert.equal(list(ctx)[0].conversation, 'expected', 'unverified ID replacement is rejected');
  assert.ok(list(ctx)[0].bindingIssue);
});

test('Missing acknowledgement remains unconfirmed and can be confirmed later', (t) => {
  const sb = sandbox(t);
  saved(sb);
  const ctx = sb.ctx();
  ensure(ctx);
  ctx.tmux.setMeta('saved', { recoveryAt: String(Date.now() - 31_000) });
  assert.equal(list(ctx)[0].recovery, 'unconfirmed');
  acknowledge(sb, 'expected');
  assert.equal(list(ctx)[0].recovery, 'confirmed');
});

test('An agent exiting before acknowledgement leaves a failed inspectable pane', async (t) => {
  const sb = sandbox(t, { claude: { resume: '/usr/bin/true' } });
  saved(sb);
  const ctx = sb.ctx();
  ensure(ctx);
  await waitFor(() => list(ctx)[0]?.recovery === 'failed', 'agent exit');
  assert.equal(ctx.tmux.hasSession('saved'), true);
  assert.equal(list(ctx)[0].conversation, 'expected');
});

test('Ending the last session removes its restore record rather than resurrecting it', (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'shell', '--cwd', sb.makeDir('project'), '--name', 'last');
  const ctx = sb.ctx();
  end(ctx, 'last');
  assert.deepEqual(ctx.store.newest()?.sessions, []);
  assert.deepEqual(ensure(ctx), []);
});


test('Retry preserves exact ID and refuses to replace a pending attempt', (t) => {
  const sb = sandbox(t);
  saved(sb);
  const ctx = sb.ctx();
  ensure(ctx);
  ctx.tmux.setMeta('saved', { recovery: 'unconfirmed' });
  assert.equal(retryRecovery(ctx, 'saved').outcome, 'resume-requested');
  assert.equal(list(ctx)[0].conversation, 'expected');
  assert.equal(ctx.tmux.listSessions().length, 1);
  assert.throws(() => retryRecovery(ctx, 'saved'), /no failed or unconfirmed/);
});

test('A retry preflight failure preserves the live attempt', (t) => {
  const sb = sandbox(t);
  saved(sb);
  const ctx = sb.ctx();
  ensure(ctx);
  ctx.tmux.setMeta('saved', { recovery: 'unconfirmed', cwd: '/missing-recovery-fixture' });
  assert.equal(retryRecovery(ctx, 'saved').outcome, 'skipped-missing-cwd');
  assert.equal(ctx.tmux.hasSession('saved'), true);
});


test('Relocating a stopped record changes only its folder and preserves exact identity', (t) => {
  const sb = sandbox(t);
  saved(sb);
  const ctx = sb.ctx();
  const cwd = sb.makeDir('relocated');
  const before = ctx.store.newest()!.sessions[0];
  relocateRecovery(ctx, 'saved', cwd);
  assert.deepEqual(ctx.store.newest()?.sessions[0], { ...before, cwd });
  assert.throws(() => relocateRecovery(ctx, 'saved', '/missing-recovery-fixture'), /existing folder/);
  ensure(ctx);
  assert.throws(() => relocateRecovery(ctx, 'saved', cwd), /live session/);
});

test('CR55 relative resume scripts run in each saved directory and retain the exact conversation', async (t) => {
  const { writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { captureProfile } = await import('../src/agents/profile.js');
  const { doctor } = await import('../src/registry/doctor.js');
  const sb = sandbox(t, { codex: { launch: './resume-fixture', resume: './resume-fixture {conversation}' } });
  const { createContext } = await import('../src/context.js');
  const { resolveBinary } = await import('../src/tools.js');
  const ctx = createContext({ ...sb.env, PATH: '', BERTH_TMUX: resolveBinary('tmux', sb.env) });
  const records = ['one', 'two', 'missing'].map((name) => {
    const cwd = sb.makeDir(name);
    if (name !== 'missing') writeFileSync(join(cwd, 'resume-fixture'), '#!/bin/sh\nprintf "%s" "$PATH" > received-path\nprintf "%s" "$1" > received-id\nexec /bin/sleep 3600\n', { mode: 0o755 });
    return { name, cwd, agent: 'codex', conversation: `conversation-${name}`, argv: 'codex', argvVerified: true,
      origin: 'none', profile: captureProfile('codex', ctx.env) };
  });
  ctx.store.write(records, {});
  assert.deepEqual(doctor(ctx).filter((f) => f.problem.startsWith('executable unavailable:')).map((f) => f.session), ['missing']);
  assert.deepEqual(ensure(ctx).map((r) => r.outcome), ['resume-requested', 'resume-requested', 'skipped-missing-binary']);
  for (const record of records.slice(0, 2)) {
    const file = join(record.cwd, 'received-id');
    await waitFor(() => existsSync(file), 'relative resume execution');
    assert.equal(readFileSync(file, 'utf8'), record.conversation);
    assert.ok(readFileSync(join(record.cwd, 'received-path'), 'utf8') === '', 'explicit empty PATH reaches the agent');
  }
});
