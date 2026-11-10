import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { shellQuote } from '../src/shell.js';
import { join } from 'node:path';
import { CLI, sandbox, waitFor } from './helpers.js';

type HookFile = { hooks: Record<string, { hooks: { command: string }[] }[]>; other?: string };

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as HookFile;
const berthEntries = (data: HookFile) =>
  Object.values(data.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.filter((h) => h.command.includes('BERTH_HOOK=1'))));

test('C11 (C12.12) hooks install / uninstall are idempotent and keep unrelated hooks', async (t) => {
  const sb = sandbox(t);
  const settings = join(sb.env.HOME, '.claude', 'settings.json');
  mkdirSync(join(sb.env.HOME, '.claude'), { recursive: true });
  const unrelated = { hooks: [{ type: 'command', command: 'echo mine' }] };
  writeFileSync(settings, JSON.stringify({ other: 'kept', hooks: { Stop: [unrelated] } }));

  assert.equal(sb.cli('hooks', 'install', 'claude').status, 0);
  assert.equal(sb.cli('hooks', 'install', 'claude').status, 0);
  const installed = read(settings);
  assert.equal(installed.other, 'kept');
  assert.deepEqual(Object.keys(installed.hooks).sort(), ['Notification', 'PermissionRequest', 'PostToolBatch', 'SessionStart', 'Stop', 'StopFailure', 'UserPromptSubmit']);
  assert.equal(berthEntries(installed).length, 7, 'one Berth entry per event after two installs');
  assert.ok(installed.hooks.Stop.some((g) => g.hooks.some((h) => h.command === 'echo mine')));

  assert.equal(sb.cli('hooks', 'uninstall', 'claude').status, 0);
  const removed = read(settings);
  assert.equal(berthEntries(removed).length, 0);
  assert.deepEqual(removed.hooks, { Stop: [unrelated] });
  assert.equal(removed.other, 'kept');

  assert.equal(sb.cli('hooks', 'install', 'codex').status, 0);
  const codex = read(join(sb.env.HOME, '.codex', 'hooks.json'));
  assert.deepEqual(Object.keys(codex.hooks).sort(), ['Interrupt', 'PermissionRequest', 'PostToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  assert.equal(berthEntries(codex).length, 6);
  assert.equal(sb.cli('hooks', 'install', 'shell').status, 2, 'agents without hook support say so');
});

test('C5 (C12.6) hook events from inside a pane stamp conversation and state', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('h'));
  const socketPath = sb.tmux('display-message', '-p', '-t', '=h:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=h:', '#{pane_id}').trim();
  const hook = (event: string, payload: object) =>
    spawnSync(process.execPath, [CLI, 'hook', 'claude', event], {
      env: { ...sb.env, TMUX: `${socketPath},1,0`, TMUX_PANE: pane },
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
  const meta = () => sb.tmux('display-message', '-p', '-t', '=h:', '#{@berth_conversation} #{@berth_state}').trim();

  assert.equal(hook('SessionStart', { session_id: 'abc' }).status, 0);
  assert.equal(meta(), 'abc');
  hook('UserPromptSubmit', { prompt: '\n  Fix the login bug\nand add a test' });
  assert.equal(meta(), 'abc working');
  assert.equal(sb.tmux('display-message', '-p', '-t', '=h:', '#{@berth_topic}').trim(), 'Fix the login bug', 'first line of the prompt');
  hook('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>x</task-id>' });
  assert.equal(sb.tmux('display-message', '-p', '-t', '=h:', '#{@berth_topic}').trim(), 'Fix the login bug', 'injected messages are not the topic');
  hook('UserPromptSubmit', { prompt: '[Image #23] fix the hover card' });
  assert.equal(sb.tmux('display-message', '-p', '-t', '=h:', '#{@berth_topic}').trim(), 'fix the hover card', 'attachment placeholders dropped');
  hook('Notification', { message: 'Claude is waiting for your input' });
  assert.equal(meta(), 'abc working', 'idle reminder is not a waiting state');
  hook('Notification', { message: 'Claude needs your permission to use Bash' });
  assert.equal(meta(), 'abc waiting');
  hook('Stop', {});
  assert.equal(meta(), 'abc done');
  hook('SessionStart', { session_id: 'forked' });
  assert.equal(meta(), 'abc done', 'an unverified producer cannot replace an existing ID');
  assert.match(sb.tmux('display-message', '-p', '-t', '=h:', '#{@berth_bindingIssue}'), /Cannot verify/);

  const outside = spawnSync(process.execPath, [CLI, 'hook', 'claude', 'Stop'], { env: sb.env, input: 'not json', encoding: 'utf8' });
  assert.equal(outside.status, 0, 'a hook outside tmux never fails the agent');
});


test('A real hook descendant of the registered agent can bind and follow a native fork', async (t) => {
  const sb = sandbox(t);
  const cwd = sb.makeDir('verified');
  const script = join(sb.root, 'claude');
  const ack = join(sb.root, 'hook-ack');
  const env = { HOME: sb.env.HOME, XDG_CONFIG_HOME: sb.env.XDG_CONFIG_HOME, XDG_STATE_HOME: sb.env.XDG_STATE_HOME, BERTH_TMUX_SOCKET: sb.socket };
  writeFileSync(script, `const {spawnSync}=require('node:child_process');
const {writeFileSync}=require('node:fs');
require('node:readline').createInterface({input:process.stdin}).on('line', id=>{
const result=spawnSync(process.execPath,[${JSON.stringify(CLI)},'hook','claude','SessionStart'],{env:{...process.env,...${JSON.stringify(env)}},input:JSON.stringify({session_id:id}),encoding:'utf8'});
writeFileSync(${JSON.stringify(ack)},id+':'+result.status);
});
`);
  sb.cli('new', 'claude', '--cwd', cwd);
  sb.tmux('respawn-pane', '-k', '-t', '=verified:', `${shellQuote(process.execPath)} ${shellQuote(script)}`);
  for (const id of ['first', 'forked']) {
    sb.tmux('send-keys', '-t', '=verified:', '-l', id);
    sb.tmux('send-keys', '-t', '=verified:', 'Enter');
    await waitFor(() => existsSync(ack) && readFileSync(ack, 'utf8') === `${id}:0`, 'hook acknowledgement');
    assert.equal(sb.ctx().tmux.listSessions()[0].meta.conversation, id);
  }
});


test('CR40 installed Qoder hooks clear stale approval and error state in tmux', (t) => {
  const sb = sandbox(t);
  assert.equal(sb.cli('hooks', 'install', 'qoder').status, 0);
  const settings = read(join(sb.env.HOME, '.qoder', 'settings.json'));
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'SessionStart', 'Stop', 'StopFailure', 'UserPromptSubmit']);
  assert.equal(sb.cli('new', 'qoder', '--cwd', sb.makeDir('qoder-state')).status, 0);
  const socket = sb.tmux('display-message', '-p', '-t', '=qoder-state:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=qoder-state:', '#{pane_id}').trim();
  const hook = (event: string, payload: object = {}) => {
    const result = spawnSync(settings.hooks[event][0].hooks[0].command, {
      shell: true, env: { ...sb.env, TMUX: `${socket},1,0`, TMUX_PANE: pane },
      input: JSON.stringify({ session_id: 'qoder_fixture', ...payload }), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  };
  hook('SessionStart');
  for (const [event, payload, expected] of [
    ['PostToolUse', {}, 'working'],
    ['PostToolUseFailure', { is_interrupt: false }, 'working'],
    ['PostToolUseFailure', { is_interrupt: true }, ''],
    ['StopFailure', { error_type: 'authentication_failed' }, ''],
  ] as const) {
    hook('PermissionRequest', { message: 'Allow fixture?' });
    hook(event, payload);
    const meta = sb.ctx().tmux.listSessions()[0].meta;
    assert.equal(meta.state ?? '', expected);
    assert.equal(meta.note ?? '', '');
    assert.equal(meta.conversation, 'qoder_fixture');
  }
  hook('UserPromptSubmit', { prompt: 'Next turn' });
  hook('Stop');
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.state, 'done');
});


test('CR50 Cursor cancellation and failure keep identity without a false completion', (t) => {
  const sb = sandbox(t);
  assert.equal(sb.cli('new', 'cursor', '--cwd', sb.makeDir('cursor-state')).status, 0);
  const target = '=cursor-state:';
  const socket = sb.tmux('display-message', '-p', '-t', target, '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', target, '#{pane_id}').trim();
  const hook = (event: string, payload: object) => {
    const result = spawnSync(process.execPath, [CLI, 'hook', 'cursor', event], {
      env: { ...sb.env, TMUX: `${socket},1,0`, TMUX_PANE: pane },
      input: JSON.stringify(payload), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  };
  const value = (key: string) => sb.tmux('display-message', '-p', '-t', target, `#{@berth_${key}}`).trim();
  hook('sessionStart', { conversation_id: 'exact-cursor-id' });
  for (const status of ['aborted', 'error']) {
    hook('beforeSubmitPrompt', { prompt: 'Next task' });
    assert.equal(value('state'), 'working');
    hook('stop', { status, message: 'old request' });
    assert.equal(value('state'), '');
    assert.equal(value('note'), '');
    assert.equal(value('conversation'), 'exact-cursor-id');
  }
  hook('beforeSubmitPrompt', { prompt: 'Final task' });
  hook('stop', { status: 'completed' });
  assert.equal(value('state'), 'done');
  assert.equal(value('conversation'), 'exact-cursor-id');
});

test('CR60 Gemini model hooks only end an existing permission wait', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  ctx.tmux.newSession('model-hook', sb.root, 'sleep 3600');
  const socketPath = sb.tmux('display-message', '-p', '-t', '=model-hook:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=model-hook:', '#{pane_id}').trim();
  const hook = () => spawnSync(process.execPath, [CLI, 'hook', 'gemini', 'BeforeModel'], {
    env: { ...sb.env, TMUX: `${socketPath},1,0`, TMUX_PANE: pane }, input: '{}', encoding: 'utf8',
  });
  for (const state of ['', 'done', 'working']) {
    ctx.tmux.setMeta('model-hook', { agent: 'gemini', state, note: 'unchanged' });
    assert.equal(hook().status, 0);
    assert.equal(ctx.tmux.listSessions()[0].meta.state || '', state);
    assert.equal(ctx.tmux.listSessions()[0].meta.note, 'unchanged');
  }
  ctx.tmux.setMeta('model-hook', { state: 'waiting', note: 'Allow tool?' });
  assert.equal(hook().status, 0);
  assert.equal(ctx.tmux.listSessions()[0].meta.state, 'working');
  assert.equal(ctx.tmux.listSessions()[0].meta.note, undefined);
});

test('a nested agent run inside the producer cannot rebind it; the producer\'s own native child can', async (t) => {
  const sb = sandbox(t);
  const cwd = sb.makeDir('nested');
  const ack = join(sb.root, 'nested-ack');
  const env = { HOME: sb.env.HOME, XDG_CONFIG_HOME: sb.env.XDG_CONFIG_HOME, XDG_STATE_HOME: sb.env.XDG_STATE_HOME, BERTH_TMUX_SOCKET: sb.socket };
  // An agent process (named like the agent) that reports one SessionStart and exits.
  const emitter = (dir: string) => {
    mkdirSync(join(sb.root, dir), { recursive: true });
    const file = join(sb.root, dir, 'claude');
    writeFileSync(file, `const {spawnSync}=require('node:child_process');
const r=spawnSync(process.execPath,[${JSON.stringify(CLI)},'hook','claude','SessionStart'],{env:{...process.env,...${JSON.stringify(env)}},input:JSON.stringify({session_id:process.argv[2]}),encoding:'utf8'});
process.exit(r.status ?? 1);
`);
    return file;
  };
  const direct = emitter('direct'), viaShell = emitter('nested-run');
  const main = join(sb.root, 'claude');
  writeFileSync(main, `const {spawnSync}=require('node:child_process');
const {writeFileSync}=require('node:fs');
const node=${JSON.stringify(process.execPath)};
require('node:readline').createInterface({input:process.stdin}).on('line', line=>{
const [how,id]=line.split(' ');
const r = how==='shell'
  // A compound command, as agents' shell tools run it, so the shell stays between them.
  ? spawnSync('/bin/sh',['-c','true && '+node+' '+${JSON.stringify(viaShell)}+' '+id+'; exit $?'],{stdio:'ignore'})
  : spawnSync(node,[${JSON.stringify(direct)},id],{stdio:'ignore'});
writeFileSync(${JSON.stringify(ack)},line+':'+r.status);
});
`);
  sb.cli('new', 'claude', '--cwd', cwd);
  sb.tmux('respawn-pane', '-k', '-t', '=nested:', `${shellQuote(process.execPath)} ${shellQuote(main)}`);
  const send = async (line: string) => {
    sb.tmux('send-keys', '-t', '=nested:', '-l', line);
    sb.tmux('send-keys', '-t', '=nested:', 'Enter');
    await waitFor(() => existsSync(ack) && readFileSync(ack, 'utf8') === `${line}:0`, `ack ${line}`);
  };
  const conversation = () => sb.ctx().tmux.listSessions()[0].meta.conversation;
  await send('direct main-id');
  assert.equal(conversation(), 'main-id', 'the producer\'s own child process binds');
  await send('shell nested-id');
  assert.equal(conversation(), 'main-id', 'a nested run behind a shell does not rebind the producer');
});
