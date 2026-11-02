import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const load = p => import(pathToFileURL(join(process.cwd(), p)));
const { sandbox } = await load('packages/core/dist/test/helpers.js');
const { Controller } = await load('packages/vscode/dist-test/src/controller.js');
const { list, stamp } = await load('packages/core/dist/src/registry/sessions.js');
const { resolveBinary } = await load('packages/core/dist/src/tools.js');
const host = () => ({ mainTerminalPid: async () => undefined, openTerminal: async () => {}, sessionsHere: () => new Set(), notify: () => {}, ownerWorkspace: () => 'fixture' });
test('review: opening a bell row replays stale waiting after clearing it', async t => {
  const sb = sandbox(t), ctx = sb.ctx(), h = host();
  assert.equal(sb.cli('new','shell','--cwd',sb.makeDir('repo'),'--name','bell-row').status,0);
  stamp(ctx,'bell-row',{state:'waiting',note:'bell'});
  const c = new Controller(ctx,h); c.acceptInventory(list(ctx));
  const output = join(sb.root,'tty-output'); writeFileSync(output,'');
  const run = ctx.tmux.run.bind(ctx.tmux);
  ctx.tmux.run = (args,...rest) => args[0] === 'list-clients' && args.includes('-t')
    ? {ok:true,stdout: `${output}\x1fxterm-256color\n`,stderr:''}
    : run(args,...rest);
  await c.show('bell-row');
  assert.equal(list(ctx).find(r=>r.name==='bell-row').state,'');
  const bytes = readFileSync(output,'utf8');
  assert.ok(bytes.lastIndexOf('\x1b]9;4;4;0') > bytes.lastIndexOf('\x1b]9;4;0;0'));
  console.log('confirmed: core idle; final emitted terminal state waiting');
});
test('review: a failed custom launch retains adoption intent', async t => {
  const sb = sandbox(t), ctx=sb.ctx(), h=host();
  h.openTerminal = async()=>{throw new Error('fixture launch failure');};
  const c=new Controller(ctx,h);
  await assert.rejects(c.newSession('codex',sb.makeDir('repo'),'fixture-launcher'));
  sb.tmux('new-session','-d','-s','unrelated','sleep 3600');
  assert.equal(c.settleLaunch('unrelated'),true);
  assert.equal(ctx.tmux.listSessions().find(s=>s.name==='unrelated').meta.agent,'codex');
  console.log('confirmed: failed launch later adopted unrelated session as Codex');
});
test('review: non-executable PATH entry masks a valid later binary', t => {
 const sb=sandbox(t), first=sb.makeDir('first'), second=sb.makeDir('second');
 for(const dir of [first,second]) writeFileSync(join(dir,'fixture-cli'),'#!/bin/sh\nprintf correct');
 chmodSync(join(first,'fixture-cli'),0o644); chmodSync(join(second,'fixture-cli'),0o755);
 const env={...sb.env,PATH:`${first}:${second}`};
 assert.equal(spawnSync('/bin/sh',['-c','fixture-cli'],{env,encoding:'utf8'}).stdout,'correct');
 assert.equal(resolveBinary('fixture-cli',env),join(first,'fixture-cli'));
 assert.equal(spawnSync(resolveBinary('fixture-cli',env),[],{env}).error.code,'EACCES');
 console.log('confirmed: shell succeeds; Berth resolved executable fails EACCES');
});
