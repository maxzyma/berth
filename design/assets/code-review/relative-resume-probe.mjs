import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const load=p=>import(pathToFileURL(join(process.cwd(),p)));
const {sandbox}=await load('packages/core/dist/test/helpers.js');
const {ensure}=await load('packages/core/dist/src/restore/ensure.js');
const {captureProfile}=await load('packages/core/dist/src/agents/profile.js');
test('relative resume preflight uses the wrong cwd', t=>{
 const sb=sandbox(t,{codex:{resume:'./resume-fixture {conversation}'}}),ctx=sb.ctx(),cwd=sb.makeDir('repo');
 writeFileSync(join(cwd,'resume-fixture'),'#!/bin/sh\nprintf matched\n',{mode:0o755});
 ctx.store.write([{name:'relative',cwd,agent:'codex',conversation:'fixture-id',argv:'codex',argvVerified:true,origin:'none',profile:captureProfile('codex',ctx.env)}],{});
 assert.equal(spawnSync('./resume-fixture',['fixture-id'],{cwd,env:ctx.env,encoding:'utf8'}).stdout,'matched');
 assert.equal(ensure(ctx)[0].outcome,'skipped-missing-binary');
});
