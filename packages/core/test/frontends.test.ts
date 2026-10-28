import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { killServer, sandbox, waitFor } from './helpers.js';
import { presentState, sequencesFor } from '../src/present/state.js';
import { iterm2Paths } from '../src/iterm2/install.js';
import { clearBell } from '../src/registry/sessions.js';
import { Tmux } from '../src/tmux/client.js';

test('I1 iterm2 install writes the AutoLaunch script and one profile per iterm2 session', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('mine'), '--origin', 'iterm2');
  sb.cli('new', 'claude', '--cwd', sb.makeDir('editor'), '--origin', 'vscode');
  const r = sb.cli('iterm2', 'install');
  assert.equal(r.status, 0, r.stderr);
  const paths = iterm2Paths(sb.env);
  const script = readFileSync(paths.script, 'utf8');
  assert.ok(statSync(paths.script).mode & 0o100, 'script is executable');
  assert.ok(script.includes(process.execPath), 'absolute node path');
  assert.match(script, /"--socket","berth-test-/);
  const compiled = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', paths.script], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const profiles = JSON.parse(readFileSync(paths.profiles, 'utf8')).Profiles as { Name: string; Command: string; Guid: string }[];
  assert.deepEqual(profiles.map((p) => p.Name), ['Berth: mine']);
  assert.match(profiles[0].Command, /^\/bin\/sh -c /);
  assert.ok(/\/tmux/.test(profiles[0].Command), 'absolute tmux path');

  // Profiles follow the sessions on every snapshot once installed.
  sb.cli('new', 'codex', '--cwd', sb.makeDir('later'), '--origin', 'iterm2');
  sb.cli('snapshot');
  const after = JSON.parse(readFileSync(paths.profiles, 'utf8')).Profiles as { Name: string }[];
  assert.deepEqual(after.map((p) => p.Name).sort(), ['Berth: later', 'Berth: mine']);

  assert.equal(sb.cli('iterm2', 'uninstall').status, 0);
  assert.ok(!existsSync(paths.script) && !existsSync(paths.profiles));
});

test('I2 a profile command is attach-or-heal', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('heal'), '--origin', 'iterm2');
  sb.cli('iterm2', 'install');
  const [profile] = JSON.parse(readFileSync(iterm2Paths(sb.env).profiles, 'utf8')).Profiles as { Command: string }[];
  const inner = profile.Command;
  const attach = inner.indexOf('attach-session');
  const ensure = inner.indexOf('ensure --origin iterm2');
  const reattach = inner.lastIndexOf('attach-session');
  assert.ok(attach >= 0 && ensure > attach && reattach > ensure, inner);
  assert.ok(inner.includes('=heal'));
});

test('I3 (automated part) after a reboot, opening a profile rebuilds its session and attaches', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('reboot'), '--origin', 'iterm2');
  sb.cli('stamp', '--session', 'reboot', 'conversation=r1');
  sb.cli('iterm2', 'install');
  sb.cli('snapshot');
  const [profile] = JSON.parse(readFileSync(iterm2Paths(sb.env).profiles, 'utf8')).Profiles as { Command: string }[];
  killServer(sb);
  // What an iTerm2 tab does with the profile: run its command, verbatim, on a terminal.
  const tab = spawn('script', ['-q', '/dev/null', '/bin/sh', '-c', profile.Command], { env: sb.env, stdio: 'ignore' });
  t.after(() => tab.kill());
  await waitFor(() => sb.ctx().tmux.hasSession('reboot'), 'session rebuilt', 10_000);
  await waitFor(() => sb.tmux('list-clients', '-t', '=reboot', '-F', '#{client_name}').trim(), 'tab attached', 10_000);
  assert.equal(sb.tmux('display-message', '-p', '-t', '=reboot:', '#{@berth_conversation}').trim(), 'r1');
});

test('tmux install adds one managed block and snapshot hooks; uninstall removes only them', async (t) => {
  const sb = sandbox(t);
  const conf = join(sb.env.HOME, '.tmux.conf');
  writeFileSync(conf, 'set -g mouse on\n');
  sb.tmux('new-session', '-d', '-s', 'boot', 'sleep 3600');
  sb.tmux('set-hook', '-g', 'session-created[0]', 'display-message mine');
  assert.equal(sb.cli('tmux', 'install').status, 0);
  assert.equal(sb.cli('tmux', 'install').status, 0);
  const text = readFileSync(conf, 'utf8');
  assert.equal(text.match(/>>> berth >>>/g)?.length, 1);
  assert.ok(text.startsWith('set -g mouse on\n'));
  const hooks = sb.tmux('show-hooks', '-g', 'session-created');
  assert.match(hooks, /session-created\[0\] display-message mine/);
  assert.match(hooks, /session-created\[97\] run-shell -b/);

  // A rename triggers a snapshot through the installed hook.
  sb.cli('new', 'claude', '--cwd', sb.makeDir('hooked'));
  sb.tmux('rename-session', '-t', '=hooked', 'hooked2');
  await waitFor(() => sb.ctx().store.newest()?.sessions.some((s) => s.name === 'hooked2'), 'hook-driven snapshot', 10_000);

  assert.equal(sb.cli('tmux', 'uninstall').status, 0);
  assert.equal(readFileSync(conf, 'utf8'), 'set -g mouse on\n');
  const left = sb.tmux('show-hooks', '-g', 'session-created');
  assert.match(left, /display-message mine/);
  assert.doesNotMatch(left, /\[97\]/);
});

test('state sequences: progress and title for every terminal, badge and colour for iTerm2', () => {
  const plain = sequencesFor('working', 'web', false);
  assert.ok(plain.includes('\x1b]9;4;3;0\x07'));
  assert.ok(plain.includes('\x1b]2;● web\x07'));
  assert.ok(!plain.includes('1337'));
  const iterm = sequencesFor('waiting', 'web', true);
  assert.ok(!iterm.includes(']9;4;'), 'no progress sequence for iTerm2');
  assert.ok(iterm.includes(`1337;SetBadgeFormat=${Buffer.from('◐ waiting').toString('base64')}`));
  assert.ok(iterm.includes('6;1;bg;red;brightness;235'));
  assert.ok(iterm.includes('\x1b]9;web: waiting for you\x07'), 'iTerm2 notification');
  assert.ok(!plain.includes(']9;web'), 'no notification text for other terminals');
  assert.ok(sequencesFor('', 'web', true).includes('6;1;bg;*;default'));
});

test('presentState writes to each attached client and ignores ones that are gone', (t) => {
  const sb = sandbox(t);
  const ttys = join(sb.root, 'ttys');
  mkdirSync(ttys);
  const vscode = join(ttys, 'vscode');
  const iterm = join(ttys, 'iterm');
  writeFileSync(vscode, '');
  writeFileSync(iterm, '');
  const tmux = new Tmux({ bin: 'tmux', socket: sb.socket });
  const written = presentState(tmux, 'web', 'done', [
    { tty: vscode, termtype: 'xterm.js' },
    { tty: iterm, termtype: 'iTerm2 3.5.0' },
    { tty: join(ttys, 'missing', 'tty'), termtype: '' },
  ]);
  assert.equal(written, 2);
  assert.ok(readFileSync(vscode, 'utf8').includes('9;4;0;0'));
  assert.ok(!readFileSync(vscode, 'utf8').includes('1337'));
  assert.ok(readFileSync(iterm, 'utf8').includes('1337;SetBadgeFormat'));
});

test('C14 a terminal bell marks agents without hooks as waiting; hooked agents and seen sessions are left alone', async (t) => {
  const sb = sandbox(t);
  sb.tmux('new-session', '-d', '-s', 'boot', 'sleep 3600');
  assert.equal(sb.cli('tmux', 'install').status, 0);
  const ring = (name: string, agent: string) => {
    sb.tmux('new-session', '-d', '-s', name, '-c', sb.makeDir(name), "sh -c 'sleep 1; printf \"\\a\"; sleep 3600'");
    assert.equal(sb.cli('adopt', name, '--agent', agent).status, 0);
  };
  const meta = (name: string) => sb.tmux('display-message', '-p', '-t', `=${name}:`, '#{@berth_state}|#{@berth_note}').trim();

  ring('quiet', 'kimi');
  await waitFor(() => meta('quiet') === 'waiting|bell', 'bell marks kimi waiting', 10_000);

  assert.equal(sb.cli('hooks', 'install', 'claude').status, 0);
  ring('hooked', 'claude');
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(meta('hooked'), '|', 'an agent with hooks keeps its hook-driven state');

  clearBell(sb.ctx(), 'quiet');
  assert.equal(meta('quiet'), '|', 'seeing the session clears a bell-raised waiting');
});
