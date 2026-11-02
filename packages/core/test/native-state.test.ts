import { geminiCursor } from '../src/agents/gemini-state.js';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, waitFor } from './helpers.js';
import { captureProfile } from '../src/agents/profile.js';
import { processLifetime } from '../src/process-owner.js';
import { sessionProducers } from '../src/registry/discover.js';
import { shellQuote } from '../src/shell.js';
import { applyNativeState, nativeIdle, observeNativeState, prepareNativeState } from '../src/registry/native-state.js';

async function fixture(t: TestContext) {
  const sb = sandbox(t), bin = sb.makeDir('bin');
  const script = join(bin, 'claude'), report = join(sb.root, 'report.json');
  writeFileSync(script, `#!${process.execPath}\nif(process.argv[2]==='agents'){process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(report)},'utf8'));}else{setInterval(()=>{},10000);}`);
  chmodSync(script, 0o755);
  sb.env.PATH = `${bin}:${sb.env.PATH}`;
  const ctx = sb.ctx();
  ctx.tmux.newSession('active', sb.root, `${shellQuote(process.execPath)} ${shellQuote(script)}`);
  const producer = await waitFor(() => sessionProducers(ctx, 'active')[0], 'producer');
  const lifetime = processLifetime(producer.pid)!;
  ctx.tmux.setMeta('active', { agent: 'claude', conversation: 'exact-id',
    producerPane: producer.pane, producerLifetime: lifetime.key, state: 'working',
    profile: JSON.stringify(captureProfile('claude', sb.env)), topic: 'retain topic', note: 'old note' });
  const record = { pid: producer.pid, sessionId: 'exact-id', kind: 'interactive', status: 'idle', startedAt: Date.now() };
  writeFileSync(report, JSON.stringify([record]));
  return { sb, ctx, script, report, record, meta: () => ctx.tmux.listSessions()[0].meta };
}

test('CR44 exact native idle clears activity without binding or success', async (t) => {
  const f = await fixture(t);
  const candidates = prepareNativeState(f.ctx);
  assert.equal(candidates.length, 1);
  applyNativeState(f.ctx, observeNativeState(f.ctx, candidates));
  assert.equal(f.meta().state, undefined);
  assert.equal(f.meta().note, undefined);
  assert.equal(f.meta().topic, 'retain topic');
  assert.equal(f.meta().conversation, 'exact-id');
  f.ctx.tmux.setMeta('active', { state: 'done' });
  assert.deepEqual(prepareNativeState(f.ctx), []);
});

test('CR44 malformed, ambiguous, stale-lifetime and foreign native records are inert', async (t) => {
  const f = await fixture(t), candidate = prepareNativeState(f.ctx)[0];
  for (const data of [null, {}, [f.record, f.record], [{ ...f.record, pid: f.record.pid + 1 }],
    [{ ...f.record, sessionId: 'other' }], [{ ...f.record, startedAt: candidate.bornAt - 1 }],
    [{ ...f.record, status: 'busy' }], [{ ...f.record, kind: 'background' }],
    [{ ...f.record, startedAt: 'yesterday' }], [{ ...f.record, startedAt: Date.now() + 100_000 }]]) {
    assert.equal(nativeIdle(data, candidate), false, JSON.stringify(data));
  }
  writeFileSync(f.report, 'invalid JSON');
  assert.deepEqual(observeNativeState(f.ctx, [candidate]), []);
  assert.equal(f.meta().state, 'working');
});

test('CR44 newer turn invalidates sampled idle even after an activity ABA cycle', async (t) => {
  const f = await fixture(t);
  const observations = observeNativeState(f.ctx, prepareNativeState(f.ctx));
  const revision = f.meta().stateRevision;
  f.ctx.tmux.setMeta('active', { state: 'done' });
  f.ctx.tmux.setMeta('active', { state: 'working' });
  assert.notEqual(f.meta().stateRevision, revision);
  applyNativeState(f.ctx, observations);
  assert.equal(f.meta().state, 'working');
  const next = observeNativeState(f.ctx, prepareNativeState(f.ctx));
  f.ctx.tmux.setMeta('active', { conversation: 'replacement-id' });
  applyNativeState(f.ctx, next);
  assert.equal(f.meta().state, 'working');
});

test('CR44 profile scheduling is fair and changed ownership rejects a sample', async (t) => {
  const f = await fixture(t);
  f.ctx.tmux.newSession('other-profile', f.sb.root, 'sleep 3600');
  f.ctx.tmux.setMeta('other-profile', { ...f.meta(), nativeCheckedAt: '',
    profile: JSON.stringify(captureProfile('claude', { ...f.sb.env, HOME: f.sb.makeDir('other-home') })) });
  const first = prepareNativeState(f.ctx);
  assert.equal(first.length, 1);
  // The other profile has no matching producer, but still gets its next attempt.
  assert.deepEqual(prepareNativeState(f.ctx), []);
  const other = f.ctx.tmux.listSessions().find((s) => s.name === 'other-profile')!;
  assert.ok(Number(other.meta.nativeCheckedAt) > 0);
  f.ctx.tmux.setMeta('active', { producerLifetime: 'reused-pid' });
  applyNativeState(f.ctx, first);
  assert.equal(f.meta().state, 'working');
});


test('CR45 overlapping observers do not invalidate each other through scheduling metadata', async (t) => {
  const f = await fixture(t);
  const first = observeNativeState(f.ctx, prepareNativeState(f.ctx));
  const second = prepareNativeState(f.ctx);
  assert.equal(second.length, 1);
  assert.notEqual(first[0].session.meta.nativeCheckedAt, second[0].session.meta.nativeCheckedAt);
  applyNativeState(f.ctx, first);
  assert.equal(f.meta().state, undefined);
});

test('CR45 an unresponsive native query is killed even when it ignores SIGTERM', async (t) => {
  const f = await fixture(t);
  const candidates = prepareNativeState(f.ctx);
  writeFileSync(f.script, `#!${process.execPath}\nprocess.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),3500);`);
  const started = performance.now();
  assert.deepEqual(observeNativeState(f.ctx, candidates), []);
  assert.ok(performance.now() - started < 3000, 'native query exceeded its bounded budget');
  assert.equal(f.meta().state, 'working');
});

test('CR59 Gemini cancellation reconciles only the verified unchanged producer and turn', async (t) => {
  const sb = sandbox(t), bin = sb.makeDir('bin');
  const script = join(bin, 'gemini');
  writeFileSync(script, `#!${process.execPath}\nsetInterval(()=>{},10000);`); chmodSync(script, 0o755);
  const ctx = sb.ctx(); ctx.tmux.newSession('gemini', sb.root, `${shellQuote(process.execPath)} ${shellQuote(script)}`);
  const producer = await waitFor(() => sessionProducers(ctx, 'gemini')[0], 'Gemini producer');
  const root = join(sb.env.HOME!, '.gemini'); mkdirSync(root, { recursive: true });
  const file = join(root, 'session.jsonl');
  writeFileSync(file, `${JSON.stringify({ sessionId: 'bound' })}\n`);
  ctx.tmux.setMeta('gemini', { agent: 'gemini', conversation: 'bound', producerPane: producer.pane,
    producerLifetime: processLifetime(producer.pid)!.key, state: 'working',
    profile: JSON.stringify(captureProfile('gemini', sb.env)), nativeTranscript: geminiCursor(file, 'bound', sb.env) });
  appendFileSync(file, `${JSON.stringify({ id: 'cancel', type: 'info', content: 'Request cancelled.', timestamp: new Date().toISOString() })}\n`);
  const observed = observeNativeState(ctx, prepareNativeState(ctx));
  assert.equal(observed.length, 1);
  ctx.tmux.setMeta('gemini', { state: 'working' });
  applyNativeState(ctx, observed);
  assert.equal(ctx.tmux.listSessions()[0].meta.state, 'working', 'new revision rejects old observation');
  ctx.tmux.setMeta('gemini', { state: 'done' });
  applyNativeState(ctx, observeNativeState(ctx, prepareNativeState(ctx)));
  assert.equal(ctx.tmux.listSessions()[0].meta.state, undefined, 'cancel overrides late completion');
  ctx.tmux.setMeta('gemini', { state: 'working', nativeTranscript: geminiCursor(file, 'bound', sb.env) });
  assert.deepEqual(observeNativeState(ctx, prepareNativeState(ctx)), [], 'old cancellation predates new cursor');
  ctx.tmux.setMeta('gemini', { producerLifetime: 'different-process' });
  assert.deepEqual(prepareNativeState(ctx), []);
});
