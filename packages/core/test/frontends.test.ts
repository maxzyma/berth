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

test('I1 iterm2 install writes only the AutoLaunch script; uninstall removes it', async (t) => {
  const sb = sandbox(t);
  const paths = iterm2Paths(sb.env);
  mkdirSync(join(paths.legacyProfiles, '..'), { recursive: true });
  writeFileSync(paths.legacyProfiles, '{"Profiles":[]}');
  const r = sb.cli('iterm2', 'install');
  assert.equal(r.status, 0, r.stderr);
  const script = readFileSync(paths.script, 'utf8');
  assert.ok(statSync(paths.script).mode & 0o100, 'script is executable');
  assert.ok(script.includes(process.execPath), 'absolute node path');
  assert.match(script, /"--socket","berth-test-/);
  assert.match(script, /user\.berthSession/);
  assert.ok(!existsSync(paths.legacyProfiles), 'profiles from earlier versions are removed');
  const compiled = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', paths.script], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.equal(sb.cli('iterm2', 'uninstall').status, 0);
  assert.ok(!existsSync(paths.script));
});

test('I2 an iTerm2 client attaching marks its pane and moves origin; other clients are not marked', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('m'), '--origin', 'vscode');
  sb.cli('stamp', '--session', 'm', 'state=waiting', 'note=approve rm');
  const tty = (name: string) => {
    const file = join(sb.root, name);
    writeFileSync(file, '');
    return file;
  };
  const vscodeTty = tty('vscode-tty');
  sb.cli('attached', '--session', 'm', '--tty', vscodeTty, '--termtype', 'xterm.js(6.1.0)');
  assert.ok(!readFileSync(vscodeTty, 'utf8').includes('SetUserVar'));
  assert.ok(readFileSync(vscodeTty, 'utf8').includes('9;4;4;0'), 'VS Code client is shown the state');
  assert.equal(sb.tmux('display-message', '-p', '-t', '=m:', '#{@berth_origin}').trim(), 'vscode');

  const itermTty = tty('iterm-tty');
  sb.cli('attached', '--session', 'm', '--tty', itermTty, '--termtype', 'iTerm2 3.7.0');
  const written = readFileSync(itermTty, 'utf8');
  assert.ok(written.includes(`1337;SetUserVar=berthSession=${Buffer.from('m').toString('base64')}`), 'pane marked');
  assert.ok(written.includes('21337;indicator=#ebaa28;status=approve rm'), 'iTerm2 tab status');
  assert.equal(sb.tmux('display-message', '-p', '-t', '=m:', '#{@berth_origin}').trim(), 'iterm2', 'origin follows the attach');

  sb.tmux('new-session', '-d', '-s', 'plain', 'sleep 3600');
  const plainTty = tty('plain-tty');
  sb.cli('attached', '--session', 'plain', '--tty', plainTty, '--termtype', 'iTerm2 3.7.0');
  assert.equal(readFileSync(plainTty, 'utf8'), '', 'unmanaged sessions are not marked');
});

test('I3 reattach rebuilds a missing session and prints the attach command', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('r'), '--origin', 'iterm2');
  sb.cli('stamp', '--session', 'r', 'conversation=r1');
  sb.cli('snapshot');
  const live = sb.cli('iterm2', 'reattach', 'r');
  assert.match(live.stdout.trim(), new RegExp(`tmux -L ${sb.socket} attach-session -t '?=r'?$`));
  killServer(sb);
  const healed = sb.cli('iterm2', 'reattach', 'r');
  assert.equal(healed.status, 0, healed.stderr);
  assert.ok(sb.ctx().tmux.hasSession('r'), 'session rebuilt');
  const argv = await waitFor(() => sb.argv('r')?.includes('resume') && sb.argv('r'), 'resumed');
  assert.deepEqual(argv.slice(0, 3), ['claude', 'resume', 'r1']);
  assert.equal(sb.cli('iterm2', 'reattach', 'nowhere').status, 4);
});

test('I3 a configured attach command replaces tmux attach', async (t) => {
  const sb = sandbox(t);
  const conf = join(sb.env.XDG_CONFIG_HOME, 'berth', 'config.toml');
  writeFileSync(conf, `${readFileSync(conf, 'utf8')}\n[iterm2]\nattach = "my-launcher --attach {session}"\n`);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('c'));
  assert.equal(sb.cli('iterm2', 'reattach', 'c').stdout.trim(), 'my-launcher --attach c');
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
  assert.match(sb.tmux('show-hooks', '-g', 'client-attached'), /\[97\].*attached --session/);
  assert.match(sb.tmux('show-hooks', '-g', 'client-session-changed'), /\[97\].*attached --session/);

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

test('I4 state sequences: OSC 9;4 and title for most terminals, OSC 21337 status for iTerm2', () => {
  const plain = sequencesFor('working', 'web', false);
  assert.ok(plain.includes('\x1b]9;4;3;0\x07'));
  assert.ok(plain.includes('\x1b]2;● web\x07'));
  assert.ok(!plain.includes('21337'));
  const waiting = sequencesFor('waiting', 'web', true, 'needs; approval');
  assert.equal(waiting, '\x1b]21337;indicator=#ebaa28;status=needs  approval;status-color=#ebaa28\x07');
  assert.equal(sequencesFor('done', 'web', true), '\x1b]21337;indicator=#50b464;status=done;status-color=#50b464\x07');
  assert.equal(sequencesFor('', 'web', true), '\x1b]21337;indicator=;status=\x07');
  for (const seq of [waiting, sequencesFor('working', 'web', true)]) {
    assert.ok(!/1337;SetBadgeFormat|6;1;bg|\]9;4;|\]9;[^4]/.test(seq), 'no badge, colour, progress or notification for iTerm2');
  }
});

test('I4 presentState writes to each attached client and ignores ones that are gone', (t) => {
  const sb = sandbox(t);
  const ttys = join(sb.root, 'ttys');
  mkdirSync(ttys);
  const vscode = join(ttys, 'vscode');
  const iterm = join(ttys, 'iterm');
  writeFileSync(vscode, '');
  writeFileSync(iterm, '');
  const tmux = new Tmux({ bin: 'tmux', socket: sb.socket });
  const written = presentState(tmux, 'web', 'done', {
    clients: [
      { tty: vscode, termtype: 'xterm.js(6.1.0)' },
      { tty: iterm, termtype: 'iTerm2 3.7.0' },
      { tty: join(ttys, 'missing', 'tty'), termtype: '' },
    ],
  });
  assert.equal(written, 2);
  assert.ok(readFileSync(vscode, 'utf8').includes('9;4;0;0'));
  assert.ok(readFileSync(iterm, 'utf8').includes('21337;indicator=#50b464'));
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
