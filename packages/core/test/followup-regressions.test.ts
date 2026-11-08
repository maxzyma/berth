import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { create, adopt, rename, end, list } from '../src/registry/sessions.js';
import { ensure } from '../src/restore/ensure.js';
import { takeSnapshot } from '../src/snapshot/take.js';
import { withLock } from '../src/restore/lock.js';
import { processLifetime, processOwnerAlive } from '../src/process-owner.js';
import { HostRegistration, workspaceIdentity } from '../src/registry/hosts.js';
import { installHooks, uninstallHooks, hooksInstalled } from '../src/agents/hooks.js';
import { conversationTitle } from '../src/agents/titles.js';
import { opencodePlugin } from '../src/agents/hook-files.js';
import { shellQuote } from '../src/shell.js';
import { sandbox, killServer, waitFor, CLI } from './helpers.js';

test('CR9 PID reuse does not retain server, ticket or workspace ownership', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  const lifetime = processLifetime(process.pid)!;
  assert.equal(processOwnerAlive(process.pid, lifetime.key, Date.now()), true);
  assert.equal(processOwnerAlive(process.pid, 'previous-boot-or-process', Date.now()), false);
  assert.equal(processOwnerAlive(process.pid, undefined, 1), false);
  ctx.store.write([{ name: 'reused', agent: 'shell', cwd: sb.root, argv: '', conversation: '', origin: 'none', serverStart: `1-${process.pid}` }], {});
  assert.equal(ensure(ctx)[0].outcome, 'launched');
  const dir = join(sb.root, 'tickets');
  mkdirSync(join(dir, 'ensure-tickets'), { recursive: true });
  writeFileSync(join(dir, 'ensure-tickets', 'old.json'), JSON.stringify({ id: 'old', number: 0, pid: process.pid, lifetime: 'previous-boot' }));
  assert.equal(withLock(dir, () => 'entered', 500), 'entered');
  const workspace = workspaceIdentity(['file:///workspace/project'])!;
  mkdirSync(join(dir, 'host-claims'), { recursive: true });
  writeFileSync(join(dir, 'host-claims', `${workspace.key}.json`), JSON.stringify({ id: 'old', pid: process.pid, lifetime: 'previous-process' }));
  const host = new HostRegistration(dir, 'Editor', workspace);
  assert.equal(host.claimStartup(), true);
  host.dispose();
});

test('CR10 stopped identity survives explicit and unmanaged name collisions, rename and end', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  sb.cli('new', 'claude', '--cwd', sb.root, '--name', 'saved');
  sb.cli('stamp', '--session', 'saved', 'conversation=exact-saved');
  killServer(sb);
  assert.throws(() => create(ctx, { agent: 'shell', cwd: sb.root, name: 'saved' }), /reserved/);
  ctx.tmux.newSession('saved', sb.root, 'sleep 3600');
  for (let i = 0; i < 2; i++) takeSnapshot(ctx);
  assert.match(list(ctx)[0].bindingIssue ?? '', /stopped conversation/);
  assert.equal(ctx.store.newest()?.sessions[0].conversation, 'exact-saved');
  assert.equal(ensure(ctx)[0].outcome, 'skipped-name-conflict');
  rename(ctx, 'saved', 'other');
  takeSnapshot(ctx);
  assert.equal(ctx.store.newest()?.sessions.find((row) => row.name === 'saved')?.conversation, 'exact-saved');
  ctx.tmux.newSession('saved', sb.root, 'sleep 3600');
  end(ctx, 'saved');
  assert.equal(ctx.store.newest()?.sessions.find((row) => row.name === 'saved')?.conversation, 'exact-saved');
  assert.equal(ensure(ctx, { session: 'saved' })[0].outcome, 'resume-requested');
  takeSnapshot(ctx);
  assert.equal(list(ctx).find((row) => row.name === 'saved')?.bindingIssue, undefined, 'explicit recovery transfers the saved identity');
});

test('CR11 re-adoption clears every recovery expectation before the next verified start', async (t) => {
  const sb = sandbox(t), ctx = sb.ctx(), script = join(sb.root, 'claude'), ack = join(sb.root, 'ack');
  const env = Object.fromEntries(['HOME', 'PATH', 'TMUX_TMPDIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'BERTH_TMUX_SOCKET'].map((key) => [key, sb.env[key]]));
  writeFileSync(script, `const {spawnSync}=require('node:child_process');const {writeFileSync}=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',id=>{const r=spawnSync(process.execPath,[${JSON.stringify(CLI)},'hook','claude','SessionStart'],{env:{...process.env,...${JSON.stringify(env)}},input:JSON.stringify({session_id:id}),encoding:'utf8'});writeFileSync(${JSON.stringify(ack)},id+':'+r.status);});`);
  ctx.tmux.newSession('bound', sb.root, `${shellQuote(process.execPath)} ${shellQuote(script)}`);
  for (const recovery of ['failed', 'requested', 'unconfirmed']) {
    ctx.tmux.setMeta('bound', { agent: 'claude', cwd: sb.root, conversation: 'old', bindingIssue: 'conflict', recovery, recoveryAt: '1', recoveryDetail: 'old failure' });
    adopt(ctx, 'bound', 'claude');
    const before = ctx.tmux.listSessions()[0].meta;
    assert.equal(before.recovery, undefined);
    assert.equal(before.recoveryAt, undefined);
    assert.equal(before.recoveryDetail, undefined);
    const id = `new-${recovery}`;
    sb.tmux('send-keys', '-t', '=bound:', '-l', id);
    sb.tmux('send-keys', '-t', '=bound:', 'Enter');
    await waitFor(() => existsSync(ack) && readFileSync(ack, 'utf8') === `${id}:0`, 'verified start');
    assert.equal(ctx.tmux.listSessions()[0].meta.conversation, id);
  }
});

test('CR12 hook lifecycle and name/title readers share the selected profile', (t) => {
  const sb = sandbox(t);
  const env: Record<string, string> = { ...sb.env, CLAUDE_CONFIG_DIR: join(sb.root, 'claude-profile'), CODEX_HOME: join(sb.root, 'codex-profile') };
  for (const [agent, root] of [['claude', env.CLAUDE_CONFIG_DIR], ['codex', env.CODEX_HOME]]) {
    const file = installHooks(agent, CLI, env);
    assert.ok(file.startsWith(root + '/'));
    assert.equal(hooksInstalled(agent, env), true);
    assert.equal(existsSync(join(env.HOME, `.${agent}`)), false, 'default profile untouched');
    uninstallHooks(agent, env);
    assert.equal(hooksInstalled(agent, env), false);
  }
  for (const [root, id] of [[join(env.HOME, '.claude'), 'wrong'], [env.CLAUDE_CONFIG_DIR, 'correct']]) {
    const dir = join(root, 'projects', sb.root.replace(/[^A-Za-z0-9]/g, '-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.jsonl`), JSON.stringify({ type: 'custom-title', customTitle: 'same-name' }));
  }
  assert.equal(conversationTitle('claude', sb.root, 'correct', env), 'same-name');
  assert.equal(conversationTitle('claude', sb.root, 'wrong', env), undefined);
});

for (const electron of [true, false]) test(`CR13 generated OpenCode hook preserves runtime contract (Electron: ${electron})`, async (t) => {
  const sb = sandbox(t), runtime = join(sb.root, 'runtime'), out = join(sb.root, 'mode'), plugin = join(sb.root, 'plugin.mjs');
  writeFileSync(runtime, `#!/bin/sh\nprintf '%s' "\${ELECTRON_RUN_AS_NODE:-missing}" > ${shellQuote(out)}\n`);
  chmodSync(runtime, 0o755);
  writeFileSync(plugin, opencodePlugin(runtime, '/synthetic/cli.mjs', ['session.created'], electron));
  const { spawn } = await import('node:child_process');
  const script = `import {BerthPlugin} from ${JSON.stringify(pathToFileURL(plugin).href)};await(await BerthPlugin()).event({event:{type:'session.created',properties:{info:{id:'exact'}}}});`;
  const env: Record<string, string> = { ...sb.env, TMUX_PANE: '%fixture' };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`plugin exit ${code}`)));
  });
  assert.equal(readFileSync(out, 'utf8'), electron ? '1' : 'missing');
});

test('macOS boot clock drift preserves host identity while a different boot is rejected', { skip: process.platform !== 'darwin' }, t => {
  const sb = sandbox(t), bin = join(sb.root, 'boot-tools');
  mkdirSync(bin);
  writeFileSync(join(bin, 'sysctl'), `#!/bin/sh
case "$2" in
kern.bootsessionuuid) echo "$FIXTURE_BOOT_UUID" ;;
kern.boottime) echo "{ sec = 100, usec = $FIXTURE_BOOT_USEC } fixture" ;;
esac
`, { mode: 0o755 });
  const module = new URL('../src/process-owner.js', import.meta.url).href;
  const probe = (uuid: string, usec: string) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import {processLifetime,processOwnerAlive} from ${JSON.stringify(module)};
      const current=processLifetime(${process.pid});
      const legacy='{ sec = 100, usec = 1 } fixture:${process.pid}:'+current.bornAt;
      console.log(JSON.stringify({key:current.key,legacy:processOwnerAlive(${process.pid},legacy,Date.now()),wrong:processOwnerAlive(${process.pid},legacy.replace(':'+current.bornAt, ':'+(current.bornAt-1000)),Date.now())}));
    `], { env: { ...process.env, PATH: bin + ':' + process.env.PATH, FIXTURE_BOOT_UUID: uuid, FIXTURE_BOOT_USEC: usec }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const first = probe('11111111-1111-4111-8111-111111111111', '1');
  const drifted = probe('11111111-1111-4111-8111-111111111111', '999999');
  assert.equal(first.key, drifted.key);
  assert.equal(drifted.legacy, true);
  assert.equal(drifted.wrong, false);
  assert.notEqual(first.key, probe('22222222-2222-4222-8222-222222222222', '1').key);
});


test('dead lock tickets are reclaimed while live and unverified owners remain protected', t => {
  const sb = sandbox(t), dir = join(sb.root, 'lock-load'), tickets = join(dir, 'ensure-tickets');
  mkdirSync(tickets, { recursive: true });
  const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(exited.status, 0);
  for (let i = 0; i < 500; i++) writeFileSync(join(tickets, `dead-${i}.json`),
    JSON.stringify({ id: `dead-${i}`, pid: exited.pid, number: 1, createdAt: Date.now() }));
  assert.equal(withLock(dir, () => 'entered'), 'entered');
  assert.deepEqual(readdirSync(tickets), [], 'dead tickets must not be scanned on every later operation');
  const live = join(tickets, 'live.json');
  writeFileSync(live, JSON.stringify({ id: 'live', pid: process.pid, number: 0,
    lifetime: processLifetime(process.pid)!.key, createdAt: Date.now() }));
  assert.throws(() => withLock(dir, () => assert.fail('must not steal live lock'), 30), new RegExp(`process ${process.pid}\\) is still using`));
  assert.ok(existsSync(live));
  writeFileSync(live, '{invalid');
  assert.throws(() => withLock(dir, () => assert.fail('must not bypass unknown owner'), 30));
  assert.ok(existsSync(live));
});

test('creation snapshot records the new session and keeps saved scrollback of the others', async (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  create(ctx, { agent: 'shell', cwd: sb.root, name: 'earlier' });
  takeSnapshot(ctx);
  sb.tmux('send-keys', '-t', '=earlier:', 'echo AFTER-SAVE', 'Enter');
  await waitFor(() => ctx.tmux.capturePane('earlier', 50).includes('AFTER-SAVE'), 'output after the saved snapshot');
  create(ctx, { agent: 'shell', cwd: sb.root, name: 'created' });
  const snapshot = ctx.store.newest()!;
  assert.deepEqual(snapshot.sessions.map((session) => session.name).sort(), ['created', 'earlier']);
  assert.doesNotMatch(ctx.store.scrollback(snapshot.dir, 'earlier'), /AFTER-SAVE/);
  assert.notEqual(ctx.store.optionalScrollback(snapshot.dir, 'created'), undefined);
  takeSnapshot(ctx);
  assert.match(ctx.store.scrollback(ctx.store.newest()!.dir, 'earlier'), /AFTER-SAVE/);
});

test('rename snapshot keeps saved scrollback under the new name', async (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  create(ctx, { agent: 'shell', cwd: sb.root, name: 'before' });
  takeSnapshot(ctx);
  sb.tmux('send-keys', '-t', '=before:', 'echo AFTER-SAVE', 'Enter');
  await waitFor(() => ctx.tmux.capturePane('before', 50).includes('AFTER-SAVE'), 'output after the saved snapshot');
  const saved = ctx.store.scrollback(ctx.store.newest()!.dir, 'before');
  assert.equal(sb.cli('rename', 'before', 'after').status, 0);
  const snapshot = ctx.store.newest()!;
  assert.deepEqual(snapshot.sessions.map((session) => session.name), ['after']);
  assert.equal(ctx.store.scrollback(snapshot.dir, 'after'), saved);
  const refused = sb.cli('rename', 'after', 'bad.name');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /does not allow : or \./);
});

test('session names keep CJK and spaces through rename, creation and snapshot', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  create(ctx, { agent: 'shell', cwd: sb.root, name: '前端 重构' });
  assert.equal(sb.cli('rename', '前端 重构', '后端-接口').status, 0);
  assert.deepEqual(ctx.store.newest()!.sessions.map((session) => session.name), ['后端-接口']);
  assert.ok(list(ctx).some((row) => row.name === '后端-接口'));
  assert.equal(create(ctx, { agent: 'shell', cwd: sb.root, name: 'v1.2:beta' }), 'v1-2-beta');
  assert.match(sb.cli('rename', '后端-接口', ' padded').stderr, /spaces at the start or end/);
  killServer(sb);
  ensure(ctx);
  assert.ok(ctx.tmux.hasSession('后端-接口'), 'a CJK-named session is rebuilt after server loss');
});
