import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { adopt, adoptLaunched, create, forget } from '../src/registry/sessions.js';
import { takeSnapshot } from '../src/snapshot/take.js';
import { withLock } from '../src/restore/lock.js';
import { sandbox, killServer } from './helpers.js';
import { ensure, relocateRecovery, setRecoveryProfile, setRecoveryOptions } from '../src/restore/ensure.js';

test('CR15 a later nested snapshot cannot resurrect a successful Forget', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  ctx.tmux.newSession('keep', sb.root, 'sleep 3600');
  ctx.store.write([{ name: 'saved', agent: 'claude', cwd: sb.root, argv: '', conversation: 'exact', origin: 'none', serverStart: 'old-server' }], {});
  let injected = false;
  const store = new Proxy(ctx.store, { get(target, key) {
    if (key === 'write') return (...args: Parameters<typeof target.write>) => {
      if (!injected) { injected = true; takeSnapshot(ctx, new Date(Date.now() + 1000)); }
      return target.write(...args);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  forget({ ...ctx, store }, 'saved');
  assert.equal(ctx.store.newest()?.sessions.some((s) => s.name === 'saved'), false);
  takeSnapshot(ctx);
  assert.equal(ctx.store.newest()?.sessions.some((s) => s.name === 'saved'), false);
});

test('CR15 nested state operations share their owner and release after errors', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  assert.throws(() => withLock(ctx.config.stateDir, () => {
    create(ctx, { agent: 'shell', cwd: sb.root, name: 'nested' });
    takeSnapshot(ctx);
    throw new Error('injected failure');
  }), /injected failure/);
  assert.equal(withLock(ctx.config.stateDir, () => 'released', 50), 'released');
  assert.equal(ctx.store.newest()?.sessions[0].name, 'nested');
});

test('CR16 fresh same-name sessions stay unbound and cannot restore a historic ID', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  const dir = join(sb.env.HOME, '.claude', 'projects', sb.root.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'historic.jsonl'), JSON.stringify({ type: 'custom-title', customTitle: 'reuse' }));
  create(ctx, { agent: 'claude', cwd: sb.root, name: 'reuse' });
  assert.equal(ctx.tmux.listSessions()[0].meta.conversation, undefined);
  killServer(sb);
  assert.equal(ensure(ctx)[0].outcome, 'skipped-unbound');
});

test('CR17 changing agent without a conflict flag clears the old identity atomically', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  create(ctx, { agent: 'claude', cwd: sb.root, name: 'change' });
  ctx.tmux.setMeta('change', { conversation: 'old-claude', recovery: 'confirmed', state: 'working', topic: 'old', note: 'old', producerPane: '%obsolete' });
  adopt(ctx, 'change', 'codex');
  const meta = ctx.tmux.listSessions()[0].meta;
  assert.equal(meta.agent, 'codex');
  for (const key of ['conversation', 'recovery', 'state', 'topic', 'note', 'producerPane'] as const) assert.equal(meta[key], undefined, key);
  assert.match(meta.argv ?? '', /^codex/);
  assert.equal(ctx.store.newest()?.sessions[0].conversation, '');
});

test('CR17 public stamp cannot retain another agent identity or obsolete recovery success', async (t) => {
  const { stamp } = await import('../src/registry/sessions.js');
  const sb = sandbox(t), ctx = sb.ctx();
  create(ctx, { agent: 'claude', cwd: sb.root, name: 'stamp' });
  stamp(ctx, 'stamp', { conversation: 'old' });
  ctx.tmux.setMeta('stamp', { recovery: 'confirmed' });
  stamp(ctx, 'stamp', { agent: 'codex' });
  assert.equal(ctx.tmux.listSessions()[0].meta.conversation, undefined);
  assert.equal(ctx.tmux.listSessions()[0].meta.recovery, undefined);
  stamp(ctx, 'stamp', { conversation: 'new' });
  ctx.tmux.setMeta('stamp', { recovery: 'confirmed' });
  stamp(ctx, 'stamp', { conversation: 'another' });
  assert.equal(ctx.tmux.listSessions()[0].meta.recovery, undefined);
});

test('CR21 a replacement producer in the same pane cannot inherit the old conversation', async (t) => {
  const { discover, sessionProducers } = await import('../src/registry/discover.js');
  const { stamp } = await import('../src/registry/sessions.js');
  const { shellQuote } = await import('../src/shell.js');
  const { waitFor } = await import('./helpers.js');
  const sb = sandbox(t), ctx = sb.ctx(), script = join(sb.root, 'claude');
  writeFileSync(script, 'setInterval(()=>{},10000)');
  const command = `${shellQuote(process.execPath)} ${shellQuote(script)}`;
  ctx.tmux.newSession('owned', sb.root, command);
  const first = await waitFor(() => sessionProducers(ctx, 'owned')[0], 'first producer');
  discover(ctx);
  stamp(ctx, 'owned', { conversation: 'old-id' });
  ctx.tmux.run(['respawn-pane', '-k', '-t', '=owned:', command]);
  const second = await waitFor(() => { const found = sessionProducers(ctx, 'owned')[0]; return found && found.pid !== first.pid ? found : undefined; }, 'replacement producer');
  assert.equal(second.pane, first.pane);
  discover(ctx);
  assert.match(ctx.tmux.listSessions()[0].meta.bindingIssue ?? '', /producer changed/);
  adopt(ctx, 'owned', 'claude');
  assert.equal(ctx.tmux.listSessions()[0].meta.conversation, undefined);
  assert.equal(ctx.tmux.listSessions()[0].meta.bindingIssue, undefined);
  assert.ok(ctx.tmux.listSessions()[0].meta.producerLifetime);
});

test('CR22 retry preserves a different live conversation occupying a stopped name', async (t) => {
  const { retryRecovery } = await import('../src/restore/ensure.js');
  const { stamp } = await import('../src/registry/sessions.js');
  const { captureProfile } = await import('../src/agents/profile.js');
  const sb = sandbox(t), ctx = sb.ctx();
  create(ctx, { agent: 'claude', name: 'saved', cwd: sb.root });
  stamp(ctx, 'saved', { conversation: 'original' });
  killServer(sb);
  ctx.tmux.newSession('saved', sb.root, 'sleep 3600');
  ctx.tmux.setMeta('saved', { agent: 'codex', conversation: 'replacement', recovery: 'failed', profile: JSON.stringify(captureProfile('codex', sb.env)) });
  const before = ctx.tmux.listSessions()[0];
  assert.equal(retryRecovery(ctx, 'saved').outcome, 'skipped-name-conflict');
  const after = ctx.tmux.listSessions()[0];
  assert.equal(after.serverStart, before.serverStart);
  assert.equal(after.sessionId, before.sessionId);
  assert.equal(after.meta.conversation, 'replacement');
  assert.equal(ctx.store.newest()?.sessions[0].conversation, 'original');
});


test('CR76 prototype-like session names preserve captured and retained scrollback', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  const names = ['__proto__', 'constructor', 'toString'];
  for (const name of names) create(ctx, { agent: 'shell', cwd: sb.root, name });
  const tmux = new Proxy(ctx.tmux, { get(target, key) {
    if (key === 'capturePane') return (name: string) => `saved output: ${name}\n`;
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const captured = takeSnapshot({ ...ctx, tmux });
  for (const name of names) assert.equal(ctx.store.scrollback(captured, name), `saved output: ${name}\n`);
  killServer(sb);
  const retained = takeSnapshot(ctx);
  assert.deepEqual(ctx.store.read(retained).sessions.map(({ name }) => name).sort(), [...names].sort());
  for (const name of names) assert.equal(ctx.store.scrollback(retained, name), `saved output: ${name}\n`);
});

for (const action of ['snapshot', 'folder', 'profile', 'options'] as const) {
  test(`CR81 ${action} preserves the latest snapshot when saved output cannot be read`, (t) => {
    const sb = sandbox(t), ctx = sb.ctx();
    const before = ctx.store.write([{ name: 'saved', agent: 'claude', cwd: sb.root,
      argv: '', conversation: 'exact', origin: 'none', retained: true }], {});
    // A directory produces a deterministic read error even when tests run as root.
    mkdirSync(join(before, 'scrollback', 'saved.txt'));
    const run = () => {
      if (action === 'snapshot') return takeSnapshot(ctx);
      if (action === 'folder') return relocateRecovery(ctx, 'saved', sb.root);
      if (action === 'profile') return setRecoveryProfile(ctx, 'saved');
      return setRecoveryOptions(ctx, 'saved', []);
    };
    assert.throws(run, /EISDIR/);
    assert.deepEqual(ctx.store.list(), [before]);
    rmSync(join(before, 'scrollback', 'saved.txt'), { recursive: true });
    assert.doesNotThrow(run, 'a genuinely missing scrollback remains optional');
    const after = ctx.store.newest()!;
    assert.notEqual(after.dir, before);
    assert.equal(ctx.store.optionalScrollback(after.dir, 'saved'), undefined);
    assert.equal(after.sessions[0].conversation, 'exact');
  });
}

test('a launched session settles on the agent stamped while Berth waited for the state lock', async (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  const startedAt = Date.now();
  ctx.tmux.newSession('launched', sb.root, 'sleep 3600');
  // Another process holds the state lock and stamps the agent before releasing it.
  const module = new URL('../src/restore/lock.js', import.meta.url).href;
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import { withAsyncLock } from ${JSON.stringify(module)};
    import { spawnSync } from 'node:child_process';
    await withAsyncLock(process.argv[1], async () => {
      process.stdout.write('owned');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const stamped = spawnSync('tmux', ['-L', process.argv[2], 'set-option', '-t', '=launched:', '@berth_agent', 'codex']);
      if (stamped.status !== 0) process.exit(3);
    });
  `, ctx.config.stateDir, sb.socket], { env: sb.env, stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = once(holder, 'exit');
  t.after(async () => { if (holder.exitCode === null) holder.kill('SIGKILL'); await exited; });
  const ready = await Promise.race([once(holder.stdout, 'data').then(([data]) => String(data)), exited.then(() => 'holder exited')]);
  assert.equal(ready, 'owned');
  assert.equal(adoptLaunched(ctx, 'launched', { agent: 'claude', startedAt, origin: 'vscode' }), 'settled');
  const meta = ctx.tmux.listSessions().find((session) => session.name === 'launched')?.meta;
  assert.equal(meta?.agent, 'codex', 'the stamped agent is kept, not replaced by the chosen one');
  assert.equal(meta?.origin, 'vscode');
});
