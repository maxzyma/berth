/**
 * V1–V7 without a VS Code window: the controller and view model run against a
 * fake editor host and a real, isolated tmux server (implementation §5.3).
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@berthdev/berth';
import { spawn } from 'node:child_process';
import { Controller, type Host, type TerminalRole } from '../src/controller.js';
import { buildTree, explorerTarget, layoutChanges, nextAttention, relativeToWorkspace, renderLauncher, type Transition } from '../src/model.js';

interface Sandbox {
  socket: string;
  ctx: () => Context;
  cli: (...args: string[]) => { status: number; stdout: string; stderr: string };
  tmux: (...args: string[]) => string;
  makeDir: (name: string) => string;
}
type Helpers = {
  sandbox: (t: TestContext) => Sandbox;
  killServer: (sb: Sandbox) => void;
  waitFor: <T>(check: () => T | undefined | false, what: string, timeoutMs?: number) => Promise<T>;
};
const helpersPath = '../../../core/dist/test/helpers.js';
const { sandbox, killServer, waitFor } = (await import(helpersPath)) as Helpers;

class FakeHost implements Host {
  terminals: { session: string; argv: string[]; role: TerminalRole; cwd?: string }[] = [];
  notified: Transition[] = [];
  shown: string[] = [];
  /** pid of a real tmux client standing in for the main terminal, when a test provides one. */
  mainPid?: number;
  main?: string;
  openTerminal(session: string, argv: string[], role: TerminalRole, cwd?: string) {
    this.terminals.push({ session, argv, role, cwd });
    if (role === 'main') this.main = session;
  }
  async mainTerminalPid() {
    return this.main !== undefined ? this.mainPid : undefined;
  }
  showMain(session: string) {
    this.main = session;
    this.shown.push(session);
  }
  sessionsHere() {
    return new Set([...(this.main ? [this.main] : []), ...this.terminals.filter((t) => t.role === 'side').map((t) => t.session)]);
  }
  closeTerminals(session: string) {
    this.terminals = this.terminals.filter((t) => t.session !== session);
    if (this.main === session) this.main = undefined;
  }
  notify(t: Transition) {
    this.notified.push(t);
  }
}

function setup(t: TestContext) {
  const sb = sandbox(t);
  const host = new FakeHost();
  return { sb, host, controller: new Controller(sb.ctx(), host) };
}

test('V1 the session view groups by cwd, shows state and counts waiting sessions', (t) => {
  const { sb, controller } = setup(t);
  const a = sb.makeDir('alpha');
  sb.cli('new', 'claude', '--cwd', a, '--name', 'a1');
  sb.cli('new', 'codex', '--cwd', a, '--name', 'a2');
  sb.cli('new', 'kimi', '--cwd', sb.makeDir('beta'), '--name', 'b1');
  sb.tmux('new-session', '-d', '-s', 'plain', 'sleep 3600');
  sb.cli('stamp', '--session', 'a1', 'state=waiting', 'note=needs approval', 'conversation=x');
  const { tree } = controller.refresh();
  assert.deepEqual(tree.groups.map((g) => [g.label, g.rows.map((r) => r.name)]), [
    ['alpha', ['a1', 'a2']],
    ['beta', ['b1']],
  ]);
  const a1 = tree.groups[0].rows[0];
  assert.match(a1.description, /^claude · waiting: needs approval · detached/);
  assert.equal(a1.icon, 'waiting');
  assert.match(a1.tooltip, /needs approval/);
  assert.match(a1.description, /waiting: needs approval/, 'latest notification on the row');
  assert.match(tree.groups[0].rows[1].description, /unbound/);
  assert.deepEqual(tree.unmanaged.map((r) => r.name), ['plain']);
  assert.equal(tree.waiting, 1);
});

test('V2 selecting a row switches the one session terminal to it; with none, one opens', async (t) => {
  const { sb, host, controller } = setup(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('a'), '--origin', 'iterm2');
  sb.cli('new', 'claude', '--cwd', sb.makeDir('b'));
  controller.refresh();
  await controller.show('a');
  assert.deepEqual(host.terminals.map((x) => [x.session, x.role]), [['a', 'main']]);
  assert.deepEqual(host.terminals[0].argv.slice(-3), ['attach-session', '-t', '=a']);
  assert.equal(sb.tmux('display-message', '-p', '-t', '=a:', '#{@berth_origin}').trim(), 'vscode', 'showing here moves origin');

  // A real tmux client stands in for the main terminal.
  const client = spawn('script', ['-q', '/dev/null', 'tmux', '-L', sb.socket, 'attach-session', '-t', '=a'], { env: process.env, stdio: 'ignore' });
  t.after(() => client.kill());
  const pid = await waitFor(() => Number(sb.tmux('list-clients', '-t', '=a', '-F', '#{client_pid}').trim()) || undefined, 'client attached');
  host.mainPid = pid;
  await controller.show('b');
  assert.equal(host.terminals.length, 1, 'no second terminal: the main one switched');
  assert.deepEqual(host.shown, ['b']);
  await waitFor(() => sb.tmux('list-clients', '-F', '#{client_pid} #{session_name}').trim() === `${pid} b`, 'client switched to b');

  sb.cli('snapshot');
  killServer(sb);
  host.main = undefined;
  await controller.show('b');
  assert.ok(sb.ctx().tmux.hasSession('b'), 'stopped session rebuilt on select');
});

test('V2 open to the side adds a terminal next to the main one', async (t) => {
  const { sb, host, controller } = setup(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('a'));
  sb.cli('new', 'claude', '--cwd', sb.makeDir('b'));
  await controller.show('a');
  controller.openToSide('b');
  assert.deepEqual(host.terminals.map((x) => [x.session, x.role]), [['a', 'main'], ['b', 'side']]);
  assert.deepEqual([...host.sessionsHere()].sort(), ['a', 'b']);
});

test('V2 the explorer follows a session only inside the workspace', () => {
  assert.equal(explorerTarget('/w/proj/sub/', ['/w/proj']), '/w/proj/sub');
  assert.equal(explorerTarget('/w/proj', ['/w/proj/']), '/w/proj');
  assert.equal(explorerTarget('/w/project-other', ['/w/proj']), undefined);
  assert.equal(explorerTarget('/elsewhere', ['/w/proj']), undefined);
});

test('V3 new / detach / rename / kill / adopt act on the test server', async (t) => {
  const { sb, host, controller } = setup(t);
  const dir = sb.makeDir('v3');
  const name = await controller.newSession('claude', dir);
  assert.equal(name, 'v3');
  assert.equal(sb.tmux('display-message', '-p', '-t', '=v3:', '#{@berth_origin}').trim(), 'vscode');
  assert.equal(host.terminals.length, 1);
  controller.detach('v3');
  assert.equal(host.terminals.length, 0);
  assert.ok(sb.ctx().tmux.hasSession('v3'), 'detach keeps the session');
  controller.rename('v3', 'v3b');
  assert.ok(sb.ctx().tmux.hasSession('v3b'));
  sb.tmux('new-session', '-d', '-s', 'loose', 'sleep 3600');
  controller.adopt('loose', 'gemini');
  assert.equal(sb.tmux('display-message', '-p', '-t', '=loose:', '#{@berth_agent}').trim(), 'gemini');
  controller.kill('v3b');
  assert.ok(!sb.ctx().tmux.hasSession('v3b'));
  const sub = sb.makeDir('ws/projects/p one');
  const ws = sub.replace(/\/projects\/p one$/, '');
  await controller.newSession('codex', sub, '/x/open --cli {agent} {relative} # {name} {cwd}', [ws]);
  const launched = host.terminals.at(-1)!;
  assert.equal(launched.role, 'main', 'the launcher runs in the session terminal');
  assert.equal(launched.cwd, sub);
  assert.equal(launched.argv.at(-1), `/x/open --cli codex 'projects/p one' # 'p one' '${sub}'`);
});

test('V4 startup rebuilds vscode sessions and shows one in the main terminal', async (t) => {
  const { sb, host, controller } = setup(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('mine'), '--origin', 'vscode');
  sb.cli('new', 'claude', '--cwd', sb.makeDir('term'), '--origin', 'iterm2');
  sb.cli('new', 'claude', '--cwd', sb.makeDir('gone'), '--origin', 'vscode');
  sb.cli('snapshot');
  sb.tmux('kill-session', '-t', '=gone');
  assert.equal(await controller.startup(), 'gone');
  assert.ok(sb.ctx().tmux.hasSession('gone'), 'missing vscode session rebuilt');
  assert.deepEqual(host.terminals.map((x) => [x.session, x.role]), [['gone', 'main']]);
  assert.equal(await controller.startup(), undefined, 'a window that already shows a session is left alone');
});

test('V5 layout adds ${progress} to the tab description so state shows on native tabs', () => {
  const custom = layoutChanges((k) => (k === 'terminal.integrated.tabs.description' ? '${local}${separator}${cwdFolder}' : undefined), false);
  assert.equal(custom.find((c) => c.key === 'terminal.integrated.tabs.description')?.value, '${progress}${separator}${local}${separator}${cwdFolder}');
  const already = layoutChanges(() => '${progress}', false);
  assert.equal(already.find((c) => c.key === 'terminal.integrated.tabs.description')?.value, '${progress}');
});

test('V6 waiting and done produce one notification each and mark the row unread', async (t) => {
  const { sb, host, controller } = setup(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('v6'));
  controller.refresh();
  sb.cli('stamp', '--session', 'v6', 'state=working');
  controller.refresh();
  sb.cli('stamp', '--session', 'v6', 'state=waiting', 'note=Claude needs your permission');
  controller.refresh();
  controller.refresh();
  sb.cli('stamp', '--session', 'v6', 'state=done');
  const { tree } = controller.refresh();
  assert.deepEqual(host.notified.map((n) => n.state), ['waiting', 'done']);
  assert.equal(host.notified[0].note, 'Claude needs your permission');
  assert.equal(tree.groups[0].rows[0].unread, true);
  await controller.show('v6');
  assert.equal(controller.tree().groups[0].rows[0].unread, false);
});

test('V5 tab titles use the title tmux sends, keeping a template that already does', () => {
  const title = (current: unknown) => layoutChanges((k) => (k === 'terminal.integrated.tabs.title' ? current : undefined), false).find((c) => c.key === 'terminal.integrated.tabs.title')?.value;
  assert.equal(title(undefined), '${sequence}');
  assert.equal(title('${sequence}${separator}${cwdFolder}'), '${sequence}${separator}${cwdFolder}');
});

test('V7 the layout keeps the user\'s other auto-lock choices and adds terminal editors', () => {
  const lock = layoutChanges((k) => (k === 'workbench.editor.autoLockGroups' ? { 'workbench.editor.chatSession': true } : undefined), false)
    .find((c) => c.key === 'workbench.editor.autoLockGroups');
  assert.deepEqual(lock?.value, { 'workbench.editor.chatSession': true, terminalEditor: true });
});

test('V7 the layout preset writes only its listed settings, tab hiding off by default', () => {
  const keys = layoutChanges(() => undefined, false).map((c) => c.key);
  assert.deepEqual(keys, [
    'workbench.editor.autoLockGroups',
    'workbench.sideBar.location',
    'workbench.secondarySideBar.defaultVisibility',
    'terminal.integrated.tabs.title',
    'terminal.integrated.tabs.description',
  ]);
  const hidden = layoutChanges(() => undefined, true); // default in the extension
  assert.deepEqual(hidden.at(-1), { key: 'terminal.integrated.tabs.enabled', value: false });
  assert.equal(buildTree([], { here: new Set(), unread: new Set(), branch: () => '' }).waiting, 0);
});

test('V3 a launcher at the workspace root gets an empty {relative}', () => {
  assert.equal(relativeToWorkspace('/w/root', ['/w/root']), '');
  assert.equal(relativeToWorkspace('/w/root/a/b', ['/w/root', '/w/root/a']), 'b');
  assert.equal(relativeToWorkspace('/elsewhere', ['/w/root']), '');
  assert.equal(renderLauncher('open --cli {agent} {relative}', { agent: 'claude', cwd: '/w', relative: '', name: 'w' }), 'open --cli claude');
});

test('V3 after a launcher attaches, the main terminal learns its session from the tmux client', async (t) => {
  const { sb, host, controller } = setup(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('l'));
  const client = spawn('script', ['-q', '/dev/null', 'tmux', '-L', sb.socket, 'attach-session', '-t', '=l'], { env: process.env, stdio: 'ignore' });
  t.after(() => client.kill());
  host.mainPid = await waitFor(() => Number(sb.tmux('list-clients', '-t', '=l', '-F', '#{client_pid}').trim()) || undefined, 'client attached');
  host.main = '';
  assert.equal(await controller.mainSession(), 'l');
});

test('V3 a session from a launcher that knows nothing of Berth is adopted with the chosen agent and its real directory', async (t) => {
  const { sb, host, controller } = setup(t);
  const chosen = sb.makeDir('ws');
  const project = sb.makeDir('ws/projects/real');
  await controller.newSession('codex', chosen, 'any-launcher {relative}', [chosen]);
  // The launcher: creates its own session, changes into the project, runs a shell.
  sb.tmux('new-session', '-d', '-s', 'from-launcher', '-c', chosen, `sh -c 'cd "${project}" && exec sleep 3600'`);
  await waitFor(() => sb.tmux('display-message', '-p', '-t', '=from-launcher:', '#{pane_current_path}').trim().endsWith('/projects/real'), 'launcher changed dir');
  assert.equal(controller.settleLaunch('from-launcher'), true);
  const meta = sb.tmux('display-message', '-p', '-t', '=from-launcher:', '#{@berth_agent}|#{@berth_origin}|#{@berth_cwd}').trim();
  assert.match(meta, /^codex\|vscode\|.*\/ws\/projects\/real$/);
  assert.equal(controller.settleLaunch('from-launcher'), false, 'settled once');
  assert.equal(host.terminals.at(-1)?.role, 'main');
});

test('V3 a launcher that stamps its own metadata keeps it', async (t) => {
  const { sb, controller } = setup(t);
  const dir = sb.makeDir('own');
  await controller.newSession('codex', dir, 'stamping-launcher', [dir]);
  sb.tmux('new-session', '-d', '-s', 'stamped', '-c', dir, 'sleep 3600');
  sb.cli('stamp', '--session', 'stamped', 'agent=kimi', `cwd=${dir}`, 'origin=none');
  controller.settleLaunch('stamped');
  assert.equal(sb.tmux('display-message', '-p', '-t', '=stamped:', '#{@berth_agent}|#{@berth_origin}').trim(), 'kimi|vscode');
});

test('V10 go to the next session needing you: waiting first, then unread, wrapping', async (t) => {
  const row = (name: string, state = '') => ({ name, managed: true, agent: 'claude', cwd: '/w', conversation: '', origin: 'vscode', state, note: '', attachedClients: 0, live: true });
  const rows = [row('a'), row('b', 'waiting'), row('c'), row('d', 'waiting')];
  assert.equal(nextAttention(rows, new Set(['c']), undefined), 'b');
  assert.equal(nextAttention(rows, new Set(['c']), 'b'), 'd');
  assert.equal(nextAttention(rows, new Set(['c']), 'd'), 'c');
  assert.equal(nextAttention(rows, new Set(['c']), 'c'), 'b');
  assert.equal(nextAttention([row('a')], new Set(), undefined), undefined);

  const { sb, host, controller } = setup(t);
  sb.cli('new', 'kimi', '--cwd', sb.makeDir('x'));
  sb.cli('stamp', '--session', 'x', 'state=waiting', 'note=bell');
  assert.equal(await controller.showNextAttention(), 'x');
  assert.deepEqual(host.terminals.map((x) => x.session), ['x']);
  assert.equal(sb.tmux('display-message', '-p', '-t', '=x:', '#{@berth_state}').trim(), '', 'showing it answers the bell');
});
