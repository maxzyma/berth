import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { processArguments } from '../src/process-arguments.js';
import { agentAmong, processes, discover, ARGUMENTS_UNAVAILABLE } from '../src/registry/discover.js';
import { captureProfile } from '../src/agents/profile.js';
import { ensure, setRecoveryOptions } from '../src/restore/ensure.js';
import { keptArgs, recoveryOptionsRequired } from '../src/agents/commands.js';
import { getAdapter } from '../src/agents/registry.js';
import { shellQuote, shellSplit } from '../src/shell.js';
import { sandbox, waitFor } from './helpers.js';

test('CR23 process arguments preserve whitespace, quotes, empty values and option-like text', async (t) => {
  const values = ['space value', '', "single'quote", '"double"', 'line\nbreak', '--dangerously-skip-permissions'];
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', ...values], { stdio: 'ignore' });
  t.after(() => child.kill());
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const actual = processArguments(child.pid!);
  assert.ok(actual);
  assert.deepEqual(actual.slice(-values.length), values);
  assert.equal(processArguments(-1), undefined);
  assert.equal(processArguments(Number.MAX_SAFE_INTEGER), undefined);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await exited;
  assert.equal(processArguments(child.pid!), undefined, 'departed processes cannot supply a replay command');
});

test('CR23 discovery and replay preserve an external settings path with spaces and quotes', async (t) => {
  const sb = sandbox(t);
  const bin = sb.makeDir('agent binaries');
  const agent = join(bin, 'claude');
  writeFileSync(agent, '#!/bin/sh\nsleep 3600\n');
  chmodSync(agent, 0o755);
  const config = join(sb.makeDir("Agent Profiles' test\nline\x1fseparator"), 'settings.json');
  const words = [agent, '--settings', config, '--model', 'small'];
  sb.tmux('new-session', '-d', '-s', 'external', words.map(shellQuote).join(' '));
  const pid = Number(sb.tmux('display-message', '-p', '-t', '=external:', '#{pane_pid}').trim());
  await waitFor(() => agentAmong(pid, processes())?.agent === 'claude', 'external producer');
  discover(sb.ctx());
  const live = sb.ctx().tmux.listSessions().find((s) => s.name === 'external')!;
  assert.equal(live.meta.bindingIssue, undefined);
  assert.deepEqual(shellSplit(live.meta.argv!), ['claude', '--settings', config, '--model', 'small']);
  assert.deepEqual(keptArgs(getAdapter('claude')!, live.meta.argv!), ['--settings', config, '--model', 'small']);
  sb.ctx().tmux.setMeta('external', { argv: 'claude --settings /tmp/wrong path', argvVerified: '' });
  discover(sb.ctx());
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.argv, live.meta.argv, 'live legacy arguments are upgraded from the same producer');
});


test('CR23 legacy replay options require explicit review before any launch', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  ctx.store.write([{ name: 'legacy', agent: 'claude', cwd: sb.root, argv: 'claude --settings /tmp/Agent Profiles/config.json', conversation: 'exact', origin: 'none', profile: captureProfile('claude', sb.env) }], {});
  assert.equal(ensure(ctx)[0].outcome, 'skipped-unverified-arguments');
  assert.equal(recoveryOptionsRequired('claude', "claude --settings 'broken"), true);
  assert.equal(ctx.tmux.hasSession('legacy'), false);
  const before = ctx.store.newest()!.dir;
  assert.throws(() => setRecoveryOptions(ctx, 'legacy', ['--settings']), /Missing value/);
  assert.throws(() => setRecoveryOptions(ctx, 'legacy', ['--unknown', 'value']), /unsupported option/);
  assert.equal(ctx.store.newest()!.dir, before, 'invalid options do not publish a change');
  const record = ctx.store.newest()!.sessions[0];
  ctx.store.write([{ ...record, bindingIssue: ARGUMENTS_UNAVAILABLE }], {});
  const options = ['--settings', '/tmp/Agent Profiles/config.json'];
  setRecoveryOptions(ctx, 'legacy', options);
  const saved = ctx.store.newest()!.sessions[0];
  assert.equal(saved.argvVerified, true);
  assert.equal(saved.bindingIssue, undefined);
  assert.deepEqual(keptArgs(getAdapter('claude')!, saved.argv), options);
  assert.equal(saved.conversation, 'exact');
  assert.equal(sb.cli('recovery-options', 'legacy', '--').status, 0, 'CLI explicitly accepts agent defaults');
  assert.equal(ctx.store.newest()!.sessions[0].argv, 'claude', 'empty options explicitly use defaults');
});


test('CR23 an empty argv0 fails closed without consuming environment entries', { skip: process.platform !== 'darwin' }, async (t) => {
  const child = spawn('/usr/bin/perl', ['-e', 'exec {"/bin/sleep"} "", "60";'], {
    stdio: 'ignore', env: { ...process.env, BERTH_ARGV_SENTINEL: 'must-not-be-an-argument' },
  });
  t.after(() => child.kill());
  await waitFor(() => spawnSync('ps', ['-p', String(child.pid), '-o', 'ucomm='], { encoding: 'utf8' }).stdout.trim().endsWith('sleep'), 'empty argv0 child');
  assert.equal(child.exitCode, null);
  assert.equal(processArguments(child.pid!), undefined);
});
