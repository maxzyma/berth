import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { create, list } from '../src/registry/sessions.js';
import { ensure } from '../src/restore/ensure.js';
import { takeSnapshot } from '../src/snapshot/take.js';
import { SnapshotStore } from '../src/snapshot/store.js';
import { loadConfig, socketIdentity } from '../src/config/index.js';
import { shellQuote } from '../src/shell.js';
import { sandbox, killServer, waitFor, CLI } from './helpers.js';

for (const managed of [false, true]) test(`CR1 first hook binds before discovery (owned creation: ${managed})`, async (t) => {
  const sb = sandbox(t);
  const script = join(sb.root, 'codex');
  const ack = join(sb.root, 'ack');
  const env = { ...sb.env };
  writeFileSync(script, `const {spawnSync}=require('node:child_process');
const {writeFileSync}=require('node:fs');
const result=spawnSync(process.execPath,[${JSON.stringify(CLI)},'hook','codex','SessionStart'],{env:{...${JSON.stringify(env)},TMUX:process.env.TMUX,TMUX_PANE:process.env.TMUX_PANE},input:JSON.stringify({session_id:'first-exact-id'}),encoding:'utf8'});
writeFileSync(${JSON.stringify(ack)},String(result.status));setInterval(()=>{},1000);`);
  const command = `${shellQuote(process.execPath)} ${shellQuote(script)}`;
  const ctx = sb.ctx();
  if (managed) create({ ...ctx, config: { ...ctx.config, agents: { codex: { launch: command } } } }, { agent: 'codex', cwd: sb.root, name: 'first' });
  else ctx.tmux.newSession('first', sb.root, command);
  await waitFor(() => existsSync(ack), 'first hook');
  assert.equal(readFileSync(ack, 'utf8'), '0');
  assert.equal(ctx.tmux.listSessions()[0].meta.conversation, 'first-exact-id');
  assert.equal(ctx.store.newest()?.sessions[0].conversation, 'first-exact-id');
});

test('CR2 last normal exit stays ended, abrupt server loss remains recoverable', async (t) => {
  const sb = sandbox(t);
  const ctx = sb.ctx();
  create(ctx, { agent: 'shell', cwd: sb.root, name: 'last' });
  const saved = ctx.store.newest()!.sessions[0];
  const entered = join(sb.root, 'closing');
  const release = join(sb.root, 'release-close');
  const marker = join(ctx.config.stateDir, 'closed', `${saved.serverStart}-${saved.sessionId}`);
  const command = `: > ${shellQuote(entered)}; while [ ! -f ${shellQuote(release)} ]; do sleep 0.01; done; : > ${shellQuote(marker)}`;
  ctx.tmux.run(['set-hook', '-g', 'session-closed[98]', `run-shell ${shellQuote(command)}`]);
  ctx.tmux.killSession('last');
  try {
    await waitFor(() => existsSync(entered), 'closure hook entered');
    assert.deepEqual(ensure(ctx), [], 'pending close hook cannot race a restore');
  } finally { writeFileSync(release, ''); }
  await waitFor(() => readdirSync(join(ctx.config.stateDir, 'closed')).length > 0, 'closure marker');
  assert.deepEqual(list(ctx), []);
  takeSnapshot(ctx);
  assert.deepEqual(ensure(ctx), []);
  create(ctx, { agent: 'shell', cwd: sb.root, name: 'interrupted' });
  killServer(sb);
  assert.equal(ensure(ctx)[0].outcome, 'launched');
});

test('CR3 competing callers ignore a dead ticket without replacing live owners', async (t) => {
  const sb = sandbox(t);
  const dir = join(sb.root, 'locks');
  const tickets = join(dir, 'ensure-tickets');
  mkdirSync(tickets, { recursive: true });
  writeFileSync(join(tickets, 'dead.json'), JSON.stringify({ id: 'dead', pid: 2147483647, number: 1 }));
  const module = new URL('../src/restore/lock.js', import.meta.url).href;
  const source = `import {withLock} from ${JSON.stringify(module)};
import {writeFileSync,unlinkSync,appendFileSync} from 'node:fs';
const root=${JSON.stringify(dir)};
for(let i=0;i<4;i++)withLock(root,()=>{
writeFileSync(root+'/active',String(process.pid),{flag:'wx'});
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
appendFileSync(root+'/completed','done\\n');unlinkSync(root+'/active');},5000);`;
  const results = await Promise.all(Array.from({ length: 6 }, () => new Promise<{ code: number | null; error: string }>((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source]);
    let error = '';
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('close', (code) => resolve({ code, error }));
  })));
  assert.ok(results.every((result) => result.code === 0), JSON.stringify(results));
  assert.equal(readFileSync(join(dir, 'completed'), 'utf8').trim().split('\n').length, 24);
  assert.deepEqual(readdirSync(tickets), ['dead.json'], 'each caller removes only its own ticket');
});

test('CR4 regular-file cwd is skipped without launching elsewhere', (t) => {
  const sb = sandbox(t);
  const ctx = sb.ctx();
  const file = join(sb.root, 'not-a-directory');
  writeFileSync(file, 'x');
  ctx.store.write([{ name: 'bad', agent: 'shell', cwd: file, argv: '', conversation: '', origin: 'none' }], {});
  assert.equal(ensure(ctx)[0].outcome, 'skipped-missing-cwd');
  assert.equal(ctx.tmux.hasSession('bad'), false);
});

test('CR5 partial restore cleans its placeholder, continues batch and remains retryable', (t) => {
  const sb = sandbox(t);
  const ctx = sb.ctx();
  ctx.store.write(['bad', 'good'].map((name) => ({ name, agent: 'shell', cwd: sb.root, argv: '', conversation: '', origin: 'none' })), {});
  const tmux = new Proxy(ctx.tmux, { get(target, key) {
    if (key === 'run') return (args: string[], allowFail?: boolean) => {
      if (args[0] === 'respawn-pane' && args.includes('=bad:')) throw new Error('injected respawn failure');
      return target.run(args, allowFail);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  assert.deepEqual(ensure({ ...ctx, tmux }).map((result) => result.outcome), ['failed', 'launched']);
  assert.equal(ctx.tmux.hasSession('bad'), false);
  assert.equal(ctx.tmux.hasSession('good'), true);
  assert.equal(ctx.store.newest()?.sessions.find((session) => session.name === 'bad')?.recovery, 'failed');
  assert.equal(ensure(ctx, { session: 'bad' })[0].outcome, 'launched');
});

test('CR6 endpoint identity separates custom paths and converges equivalent selectors', (t) => {
  const sb = sandbox(t);
  const one = loadConfig({ ...sb.env, BERTH_TMUX_SOCKET_PATH: '/workspace/one/shared.sock' });
  const two = loadConfig({ ...sb.env, BERTH_TMUX_SOCKET_PATH: '/workspace/two/shared.sock' });
  assert.notEqual(one.stateDir, two.stateDir);
  const path = join(sb.env.TMUX_TMPDIR, `tmux-${process.getuid!()}`, sb.socket);
  assert.equal(socketIdentity(sb.socket, undefined, sb.env), socketIdentity(undefined, path, sb.env));
  assert.notEqual(socketIdentity(sb.socket, undefined, sb.env), socketIdentity(sb.socket, undefined, { ...sb.env, TMUX_TMPDIR: '/workspace/another' }));
  assert.equal(socketIdentity('default', undefined, {}), 'default');
  const fresh = { ...sb.env, TMUX_TMPDIR: join(sb.root, 'new-socket-root') };
  const before = socketIdentity('new', undefined, fresh);
  mkdirSync(join(fresh.TMUX_TMPDIR, `tmux-${process.getuid!()}`), { recursive: true });
  assert.equal(socketIdentity('new', undefined, fresh), before, 'identity is stable before endpoint directory creation');
  const legacy = join(sb.env.XDG_STATE_HOME, 'berth', 'servers', sb.socket, 'snapshots');
  mkdirSync(legacy, { recursive: true });
  assert.equal(loadConfig(sb.env).legacySnapshotRoot, legacy);

});

test('CR8 newest and retention use numeric suffix order', (t) => {
  const sb = sandbox(t);
  const store = new SnapshotStore(join(sb.root, 'ordered'));
  const now = new Date('2026-11-01T00:00:00.000Z');
  for (let i = 1; i <= 101; i++) store.write([{ name: `record-${i}`, agent: 'shell', cwd: sb.root, argv: '', conversation: '', origin: 'none' }], {}, now);
  assert.equal(store.newest()?.sessions[0].name, 'record-101');
  store.prune(2);
  assert.deepEqual(store.list().map((dir) => store.read(dir).sessions[0].name), ['record-101', 'record-100']);
});
