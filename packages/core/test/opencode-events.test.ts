import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { opencodePlugin } from '../src/agents/hook-files.js';
import { getAdapter } from '../src/agents/registry.js';
import { sandbox } from './helpers.js';

const events = Object.values(getAdapter('opencode')!.events).flat();
const identity = (id: string, parentID?: string) => ({ type: 'session.updated', properties: { sessionID: id, info: { id, parentID } } });
const status = (type: string) => ({ type: 'session.status', properties: { sessionID: 'root', status: { type } } });
const event = (type: string, sessionID = 'root') => ({ type, properties: { sessionID } });

test('CR42 OpenCode forwards ordered root lifecycle and preserves error outcomes through idle', (t) => {
  const sb = sandbox(t), output = join(sb.root, 'events.jsonl');
  const cli = join(sb.root, 'capture.cjs'), plugin = join(sb.root, 'plugin.mjs');
  // Delay identity persistence to expose concurrent forwarding that lets later events overtake it.
  writeFileSync(cli, `const fs=require('node:fs');const input=JSON.parse(fs.readFileSync(0,'utf8'));
const save=()=>fs.appendFileSync(${JSON.stringify(output)},JSON.stringify({event:process.argv[4],...input})+'\\n');
if(process.argv[4]==='session.updated')setTimeout(save,150);else save();`);
  writeFileSync(plugin, opencodePlugin(process.execPath, cli, events));
  const stream = [
    event('session.error', 'unknown'), identity('child', 'root'), event('session.idle', 'child'),
    identity('root'), status('busy'),
    { type: 'permission.asked', properties: { sessionID: 'root', permission: 'bash' } },
    { type: 'permission.replied', properties: { sessionID: 'root', reply: 'once' } }, event('session.error'), status('idle'), event('session.idle'),
    event('session.idle'), status('retry'), status('idle'), event('session.idle'),
    { type: 'permission.replied', properties: { sessionID: 'root', reply: 'reject' } }, event('session.idle'),
    { type: 'permission.replied', properties: { sessionID: 'root', reply: 'unknown' } },
  ];
  const driver = `const {BerthPlugin}=await import(${JSON.stringify(pathToFileURL(plugin).href)});
const plugin=await BerthPlugin();await Promise.all(${JSON.stringify(stream)}.map(event=>plugin.event({event})));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
    env: { ...sb.env, TMUX_PANE: '%fixture' }, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(run.status, 0, run.stderr);
  const rows = readFileSync(output, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(rows.map((row) => row.event), [
    'session.updated', 'session.status', 'permission.asked', 'permission.replied',
    'session.error', 'session.error', 'session.error', 'session.status', 'session.idle', 'session.error', 'session.error',
  ]);
  assert.ok(rows.every((row) => row.session_id === 'root'));
  assert.equal(rows[2].message, 'Approval requested: bash');
});

test('CR42 missing OpenCode hook runtime never rejects the native callback', (t) => {
  const sb = sandbox(t), plugin = join(sb.root, 'plugin.mjs');
  writeFileSync(plugin, opencodePlugin(join(sb.root, 'missing-runtime'), join(sb.root, 'missing-cli'), events));
  const driver = `const {BerthPlugin}=await import(${JSON.stringify(pathToFileURL(plugin).href)});
const plugin=await BerthPlugin();await plugin.event({event:${JSON.stringify(identity('root'))}});`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
    env: { ...sb.env, TMUX_PANE: '%fixture' }, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(run.status, 0, run.stderr);
});

test('OpenCode applies a title returned by its hook through the bound SDK client, and nothing else', (t) => {
  const sb = sandbox(t), cli = join(sb.root, 'reply.cjs'), plugin = join(sb.root, 'plugin.mjs');
  // Only the busy status replies with a title, as Berth does for a pending rename.
  writeFileSync(cli, `if(process.argv[4]==='session.status')process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'session.status',sessionTitle:'任务乙'}}));`);
  writeFileSync(plugin, opencodePlugin(process.execPath, cli, events));
  const driver = `const {BerthPlugin}=await import(${JSON.stringify(pathToFileURL(plugin).href)});
const calls=[];const client={session:{update:async(request)=>{calls.push(request);return {};}}};
const plugin=await BerthPlugin({client});
for(const event of ${JSON.stringify([identity('root'), status('busy'), event('session.idle')])})await plugin.event({event});
process.stdout.write(JSON.stringify(calls));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
    env: { ...sb.env, TMUX_PANE: '%fixture' }, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), [{ path: { id: 'root' }, body: { title: '任务乙' } }]);
});
