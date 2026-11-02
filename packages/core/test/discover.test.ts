/** C16: sessions running an agent are managed without any launcher stamping them (spec §4.3). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keptArgs } from '../src/agents/commands.js';
import { getAdapter } from '../src/agents/registry.js';
import { agentAmong } from '../src/registry/discover.js';
import { CLI, killServer, sandbox, waitFor } from './helpers.js';

test('C16 agents are recognised by program name, also behind an interpreter or a launcher shell', () => {
  const procs = [
    { pid: 10, ppid: 1, args: '-zsh' },
    { pid: 11, ppid: 10, args: 'bash /home/u/bin/my-launcher --cli claude' },
    { pid: 12, ppid: 11, args: 'claude --name w --model opus' },
    { pid: 20, ppid: 1, args: 'node /usr/local/lib/node_modules/@x/codex/bin/codex -m o3' },
    { pid: 30, ppid: 1, args: 'vim notes.md' },
  ];
  assert.deepEqual(agentAmong(10, procs), { agent: 'claude', argv: 'claude --name w --model opus', pid: 12 });
  assert.deepEqual(agentAmong(20, procs), { agent: 'codex', argv: 'codex -m o3', pid: 20 });
  assert.equal(agentAmong(30, procs), undefined);
});

test('C16 a session a launcher started without Berth is managed, restorable, and can be left alone', async (t) => {
  const sb = sandbox(t);
  const bin = sb.makeDir('bin');
  writeFileSync(join(bin, 'kimi'), '#!/bin/sh\nsleep 3600\n');
  chmodSync(join(bin, 'kimi'), 0o755);
  const project = sb.makeDir('ws/projects/p');
  // Like a launcher: the session starts at the root, the agent runs in a project.
  sb.tmux('new-session', '-d', '-s', 'foreign', '-c', sb.makeDir('ws'), `sh -c '(cd "${project}" && ${join(bin, 'kimi')} --yolo); sleep 3600'`);
  sb.tmux('new-session', '-d', '-s', 'plain', 'sleep 3600');
  // The pane's leader stays in the root: only the agent's own directory is right.
  await waitFor(() => spawnSync('pgrep', ['-f', join(bin, 'kimi')]).status === 0, 'agent running');

  const off = { ...sb.env, BERTH_AUTO_ADOPT: '0' };
  spawnSync(process.execPath, [CLI, 'ls'], { env: off });
  assert.equal(sb.tmux('display-message', '-p', '-t', '=foreign:', '#{@berth_agent}').trim(), '', 'switched off: untouched');

  sb.cli('ls');
  const meta = sb.tmux('display-message', '-p', '-t', '=foreign:', '#{@berth_agent}|#{@berth_cwd}|#{@berth_argv}|#{@berth_origin}').trim();
  assert.match(meta, /^kimi\|.*\/ws\/projects\/p\|kimi --yolo\|none$/);
  assert.equal(sb.tmux('display-message', '-p', '-t', '=plain:', '#{@berth_agent}').trim(), '', 'no agent: not managed');
  killServer(sb);
  assert.match(sb.cli('ensure').stdout, /foreign\t/, 'in the snapshot, so it comes back');
});

test('C16 a managed shell becomes an agent session without losing its host', async (t) => {
  const sb = sandbox(t);
  const bin = sb.makeDir('bin');
  const agent = join(bin, 'codex');
  writeFileSync(agent, '#!/bin/sh\nsleep 3600\n');
  chmodSync(agent, 0o755);
  const project = realpathSync(sb.makeDir('project'));
  sb.tmux('new-session', '-d', '-s', 'terminal', '-c', project, '/bin/sh');
  sb.ctx().tmux.setMeta('terminal', { agent: 'shell', origin: 'vscode', cwd: project, argv: '/bin/sh' });
  sb.cli('ls');
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.agent, 'shell', 'a plain shell stays a shell');

  sb.tmux('send-keys', '-t', '=terminal:', `${agent} --model test`, 'Enter');
  await waitFor(() => spawnSync('pgrep', ['-f', agent]).status === 0, 'stand-in agent running');
  spawnSync(process.execPath, [CLI, 'ls'], { env: { ...sb.env, BERTH_AUTO_ADOPT: '0' } });
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.agent, 'shell', 'disabled discovery preserves the shell');
  sb.cli('ls');
  const live = sb.ctx().tmux.listSessions();
  assert.equal(live.length, 1, 'the existing session is updated, not duplicated');
  const { producerLifetime, ...metadata } = live[0].meta;
  assert.ok(producerLifetime, 'discovery records the process lifetime');
  assert.deepEqual(metadata, { agent: 'codex', origin: 'vscode', cwd: project, argv: 'codex --model test', argvVerified: '1', producerPane: sb.tmux('display-message', '-p', '-t', '=terminal:', '#{pane_id}').trim() });
  assert.equal(sb.ctx().store.newest()?.sessions[0].agent, 'codex', 'restore records the detected agent');

  sb.ctx().tmux.setMeta('terminal', { agent: 'claude', argv: 'claude --model kept' });
  sb.cli('ls');
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.agent, 'claude', 'an explicit agent binding is not replaced');
});


test('CR24 resume never promotes positional input after -- into permission flags', () => {
  const adapter = getAdapter('claude')!;
  assert.deepEqual(keptArgs(adapter, 'claude --model small -- "--dangerously-skip-permissions" --settings other.json'), ['--model', 'small']);
  assert.deepEqual(keptArgs(getAdapter('codex')!, 'codex -- "--sandbox" "danger-full-access"'), []);
});

test('CR25 opening an agent-named file in an editor does not discover an agent', () => {
  for (const command of ['vim /tmp/claude', 'cat /tmp/codex', 'less /tmp/kimi']) {
    assert.equal(agentAmong(10, [{ pid: 10, ppid: 1, args: command }]), undefined);
  }
  assert.equal(agentAmong(10, [{ pid: 10, ppid: 1, args: '/bin/sh /tmp/claude --model small' }])?.agent, 'claude');
});


test('legacy bindings remain protected until a producer-verified same-ID event', async (t) => {
  const { discover, sessionProducers, BINDING_UNVERIFIED, PRODUCER_CHANGED } = await import('../src/registry/discover.js');
  const { shellQuote } = await import('../src/shell.js');
  const sb = sandbox(t), ctx = sb.ctx();
  const script = join(sb.root, 'claude'), trigger = join(sb.root, 'trigger'), processed = join(sb.root, 'processed');
  writeFileSync(script, `const fs = require('fs'); const cp = require('child_process');
setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(trigger)})) return;
  const id = fs.readFileSync(${JSON.stringify(trigger)}, 'utf8');
  fs.unlinkSync(${JSON.stringify(trigger)});
  cp.execFileSync(process.execPath, [${JSON.stringify(CLI)}, 'hook', 'claude', 'Stop'],
    { input: JSON.stringify({ session_id: id }), env: process.env });
  fs.writeFileSync(${JSON.stringify(processed)}, id);
}, 30);`);
  ctx.tmux.newSession('legacy', sb.root, `${shellQuote(process.execPath)} ${shellQuote(script)}`);
  await waitFor(() => sessionProducers(ctx, 'legacy')[0], 'agent process');
  ctx.tmux.setMeta('legacy', { agent: 'claude', conversation: 'original', bindingIssue: PRODUCER_CHANGED });
  discover(ctx);
  assert.equal(ctx.tmux.listSessions()[0].meta.bindingIssue, BINDING_UNVERIFIED);
  assert.equal(ctx.tmux.listSessions()[0].meta.conversation, 'original');
  writeFileSync(trigger, 'different');
  // A mismatched lifecycle event must leave both the ID and protection intact.
  const { existsSync, readFileSync } = await import('node:fs');
  await waitFor(() => existsSync(processed) && readFileSync(processed, 'utf8') === 'different', 'different-ID event completed');
  assert.equal(ctx.tmux.listSessions()[0].meta.conversation, 'original');
  assert.equal(ctx.tmux.listSessions()[0].meta.bindingIssue, BINDING_UNVERIFIED);
  writeFileSync(trigger, 'original');
  await waitFor(() => existsSync(processed) && readFileSync(processed, 'utf8') === 'original', 'same-ID hook completed');
  assert.equal(ctx.tmux.listSessions()[0].meta.bindingIssue, undefined);
  assert.equal(ctx.tmux.listSessions()[0].meta.conversation, 'original');
  assert.ok(ctx.tmux.listSessions()[0].meta.producerLifetime);
  assert.ok(ctx.tmux.listSessions()[0].meta.profile, 'verified event fills the missing profile');
  assert.ok(ctx.store.newest()?.sessions[0].profile, 'migration is durable');
  assert.equal(ctx.store.newest()?.sessions[0].bindingIssue, undefined);
});
