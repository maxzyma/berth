import { clientAttached, clientAttachedWhenReady } from '../src/present/attach.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { killServer, sandbox, waitFor } from './helpers.js';
import { presentState, sequencesFor } from '../src/present/state.js';
import { iterm2Paths, reattach } from '../src/iterm2/install.js';
import { clearBell } from '../src/registry/sessions.js';
import { shellQuote } from '../src/shell.js';
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
  assert.match(script, /"--socket-path",/);
  assert.ok(script.includes(sb.socket));
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
  const attach = (name: string, tty: string, termtype: string) => {
    const ctx = sb.ctx();
    const tmux = new Proxy(ctx.tmux, { get(target, key) {
      if (key === 'run') return (args: string[], allowFailure?: boolean) => args[0] === 'list-clients'
        ? { ok: true, stdout: `${tty}~${termtype}\n`, stderr: '' } : target.run(args, allowFailure);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    clientAttached({ ...ctx, tmux }, { session: name, tty, termtype: 'untrusted-event-type' });
  };
  const vscodeTty = tty('vscode-tty');
  attach('m', vscodeTty, 'xterm.js(6.1.0)');
  assert.ok(!readFileSync(vscodeTty, 'utf8').includes('SetUserVar'));
  assert.ok(readFileSync(vscodeTty, 'utf8').includes('9;4;4;0'), 'VS Code client is shown the state');
  assert.equal(sb.tmux('display-message', '-p', '-t', '=m:', '#{@berth_origin}').trim(), 'vscode');

  const itermTty = tty('iterm-tty');
  attach('m', itermTty, 'iTerm2 3.7.0');
  const written = readFileSync(itermTty, 'utf8');
  assert.ok(written.includes(`1337;SetUserVar=berthSession=${Buffer.from('m').toString('base64')}`), 'pane marked');
  assert.ok(written.includes('21337;indicator=#ebaa28;status=approve rm'), 'iTerm2 tab status');
  assert.equal(sb.tmux('display-message', '-p', '-t', '=m:', '#{@berth_origin}').trim(), 'iterm2', 'origin follows the attach');

  sb.tmux('new-session', '-d', '-s', 'plain', 'sleep 3600');
  const plainTty = tty('plain-tty');
  attach('plain', plainTty, 'iTerm2 3.7.0');
  assert.equal(readFileSync(plainTty, 'utf8'), '', 'unmanaged sessions are not marked');
});

test('I3 reattach rebuilds a missing session and prints the attach command', async (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('r'), '--origin', 'iterm2');
  sb.cli('stamp', '--session', 'r', 'conversation=r1');
  sb.cli('snapshot');
  const live = sb.cli('iterm2', 'reattach', 'r');
  assert.match(live.stdout.trim(), new RegExp(`tmux -S .*${sb.socket} attach-session -t '?=r'?$`));
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
  assert.match(sb.tmux('show-hooks', '-g', 'client-attached'), /\[97\].*attached --client=/);
  assert.match(sb.tmux('show-hooks', '-g', 'client-session-changed'), /\[97\].*attached --client=/);

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
  const ring = (name: string, agent: string, automatic = true) => {
    const gate = join(sb.root, `${name}.ring`);
    const script = `while [ ! -f ${shellQuote(gate)} ]; do sleep 0.02; done; printf '\\a'; sleep 3600`;
    sb.tmux('new-session', '-d', '-s', name, '-c', sb.makeDir(name), automatic ? `sh -c ${shellQuote(script)}` : 'sleep 3600');
    assert.equal(sb.cli('adopt', name, '--agent', agent).status, 0);
    if (automatic) writeFileSync(gate, 'ready');
  };
  const meta = (name: string) => sb.tmux('display-message', '-p', '-t', `=${name}:`, '#{@berth_state}|#{@berth_note}').trim();

  ring('quiet', 'kimi');
  await waitFor(() => meta('quiet') === 'waiting|bell', 'bell marks kimi waiting', 10_000);

  assert.equal(sb.cli('hooks', 'install', 'claude').status, 0);
  // Issue the hooked bell synchronously after binding; a timed bell can win the setup race.
  ring('hooked', 'claude', false);
  assert.equal(sb.cli('stamp', '--session', 'hooked', 'conversation=hooked-id').status, 0, 'explicit binding records the selected profile');
  assert.equal(sb.cli('bell', '--session', 'hooked').status, 0);
  assert.equal(meta('hooked'), '|', 'an agent with hooks keeps its hook-driven state');

  clearBell(sb.ctx(), 'quiet');
  assert.equal(meta('quiet'), '|', 'seeing the session clears a bell-raised waiting');
});


test('CR79 stale attachment events do not mark a departed client or change origin', (t) => {
  const sb = sandbox(t);
  sb.cli('new', 'shell', '--name', 'old', '--cwd', sb.root, '--origin', 'vscode');
  const tty = join(sb.root, 'departed-tty');
  writeFileSync(tty, 'unchanged');
  sb.cli('attached', '--session', 'old', '--tty', tty, '--termtype', 'iTerm2 3.7.0');
  assert.equal(readFileSync(tty, 'utf8'), 'unchanged');
  assert.equal(sb.tmux('display-message', '-p', '-t', '=old:', '#{@berth_origin}').trim(), 'vscode');
});

test('CR79 a delayed event cannot reclaim origin after a real client switches sessions', async (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  for (const name of ['old', 'current']) sb.cli('new', 'shell', '--name', name, '--cwd', sb.root, '--origin', 'vscode');
  const client = spawn('tmux', ['-L', sb.socket, '-C', 'attach-session', '-t', '=old'], {
    env: sb.env, stdio: ['pipe', 'ignore', 'ignore'],
  });
  t.after(() => client.kill());
  const connected = () => sb.tmux('list-clients', '-t', '=old', '-F', '#{client_name}').trim();
  const name = await waitFor(connected, 'control client attachment');
  const tty = sb.tmux('list-clients', '-t', '=old', '-F', '#{client_tty}').trim();
  sb.tmux('switch-client', '-c', name, '-t', '=current');
  await waitFor(() => !connected(), 'client switch');
  clientAttached(ctx, { session: 'old', tty, termtype: 'iTerm2 3.7.0' });
  assert.equal(sb.tmux('display-message', '-p', '-t', '=old:', '#{@berth_origin}').trim(), 'vscode');
});

test('I2 hook client identity selects its own session instead of the current client', (t) => {
  const sb = sandbox(t);
  {
    for (const name of ['one', 'two']) sb.cli('new', 'shell', '--name', name, '--cwd', sb.makeDir(name));
    const first = join(sb.root, 'first-tty');
    const second = join(sb.root, 'second-tty');
    writeFileSync(first, '');
    writeFileSync(second, '');
    const ctx = sb.ctx();
    let lookups = 0;
    const tmux = new Proxy(ctx.tmux, { get(target, key) {
      if (key === 'run') return (args: string[], allowFailure?: boolean) => {
        if (args[0] !== 'list-clients') return target.run(args, allowFailure);
        const output = args.includes('-t')
          ? `${args[args.indexOf('-t') + 1] === '=one' ? first : second}~iTerm2 3.7.0\n`
          : `client-two~two~${second}~iTerm2 3.7.0\nclient-one~one~${first}~${++lookups === 1 ? '' : 'iTerm2 3.7.0'}\n`;
        return { ok: true, stdout: output, stderr: '' };
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    clientAttachedWhenReady({ ...ctx, tmux }, 'client-one');
    assert.ok(lookups >= 3, 'late terminal identification is rechecked under the lock');
    assert.match(readFileSync(first, 'utf8'), /SetUserVar=berthSession=b25l/);
    assert.equal(readFileSync(second, 'utf8'), '');
    const before = readFileSync(first, 'utf8');
    clientAttached({ ...ctx, tmux }, { name: 'vanished-client' });
    assert.equal(readFileSync(first, 'utf8'), before);
    assert.equal(readFileSync(second, 'utf8'), '');
  }
});


test('I3 automatic reattachment defers only clients from the startup tty snapshot', (t) => {
  const sb = sandbox(t);
  assert.equal(sb.cli('new', 'shell', '--name', 'guard', '--cwd', sb.makeDir('guard')).status, 0);
  const ctx = sb.ctx();
  const tmux = new Proxy(ctx.tmux, { get(target, key) {
    if (key === 'run') return (args: string[], allowFailure?: boolean) => args[0] === 'list-clients'
      ? { ok: true, stdout: '/dev/ttys-live~iTerm2 3.7.0\n', stderr: '' } : target.run(args, allowFailure);
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const tools = { node: process.execPath, cli: '/cli', tmux: '/tmux' };
  assert.equal(reattach({ ...ctx, tmux }, tools, 'guard', ['/dev/ttys-live']), '');
  assert.match(reattach({ ...ctx, tmux }, tools, 'guard', ['/dev/other']), /attach-session/);
  assert.match(reattach({ ...ctx, tmux }, tools, 'guard'), /attach-session/, 'manual attachment remains available');
  assert.equal(sb.cli('iterm2', 'reattach', 'guard', '--existing-tty', '/dev/not-live').status, 0);
});


test('plain shell creation and recovery execute input instead of repeating the staging process', async (t) => {
  const sb = sandbox(t);
  const cwd = sb.makeDir('interactive-shell');
  assert.equal(sb.cli('new', 'shell', '--name', 'interactive-shell', '--cwd', cwd).status, 0);
  for (const phase of ['created', 'restored']) {
    if (phase === 'restored') {
      assert.equal(sb.cli('snapshot').status, 0);
      killServer(sb);
      const restored = sb.cli('ensure', 'interactive-shell');
      assert.equal(restored.status, 0, restored.stderr);
    }
    const result = join(cwd, phase);
    sb.tmux('send-keys', '-t', '=interactive-shell:', '-l', `printf shell-ready > ${shellQuote(result)}`);
    sb.tmux('send-keys', '-t', '=interactive-shell:', 'Enter');
    await waitFor(() => existsSync(result) && readFileSync(result, 'utf8') === 'shell-ready', `${phase} shell executes input`);
    assert.equal(realpathSync(sb.tmux('display-message', '-p', '-t', '=interactive-shell:', '#{pane_current_path}').trim()), realpathSync(cwd));
  }
});


test('new shell and exit remain responsive with stale tickets and snapshot hooks', async t => {
  const sb = sandbox(t), ctx = sb.ctx();
  sb.tmux('new-session', '-d', '-s', 'keep-server', 'sleep 3600');
  assert.equal(sb.cli('tmux', 'install').status, 0);
  const tickets = join(ctx.config.stateDir, 'ensure-tickets');
  mkdirSync(tickets, { recursive: true });
  const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  for (let i = 0; i < 500; i++) writeFileSync(join(tickets, `dead-${i}.json`),
    JSON.stringify({ id: `dead-${i}`, pid: exited.pid, number: 1, createdAt: Date.now() }));
  const start = performance.now();
  assert.equal(sb.cli('new', 'shell', '--cwd', sb.root, '--name', 'responsive').status, 0);
  const createdMs = Math.round(performance.now() - start);
  const marker = join(sb.root, 'ready');
  sb.tmux('send-keys', '-t', '=responsive:', `printf ready > ${shellQuote(marker)}`, 'Enter');
  await waitFor(() => existsSync(marker), 'usable shell');
  const exitStart = performance.now();
  sb.tmux('send-keys', '-t', '=responsive:', 'exit', 'Enter');
  await waitFor(() => !ctx.tmux.hasSession('responsive'), 'shell exits with hooks installed');
  const exitedMs = Math.round(performance.now() - exitStart);
  await waitFor(() => !ctx.store.newest()?.sessions.some(row => row.name === 'responsive'), 'closure persisted');
  assert.ok(ctx.tmux.hasSession('keep-server'), 'unrelated session survives');
  t.diagnostic(JSON.stringify({ createdMs, exitedMs }));
});
