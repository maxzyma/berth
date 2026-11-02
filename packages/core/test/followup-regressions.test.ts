import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
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
