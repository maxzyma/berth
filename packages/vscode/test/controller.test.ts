/**
 * V1–V7 without a VS Code window: the controller and view model run against a
 * fake editor host and a real, isolated tmux server (implementation §5.3).
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@berthdev/berth';
import { Controller, type Host } from '../src/controller.js';
import { buildTree, layoutChanges, type Transition } from '../src/model.js';

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
  terminals: { session: string; argv: string[] }[] = [];
  launched: { command: string; cwd: string }[] = [];
  notified: Transition[] = [];
  focused: string[] = [];
  openTerminal(session: string, argv: string[]) {
    this.terminals.push({ session, argv });
  }
  runInTerminal(command: string, cwd: string) {
    this.launched.push({ command, cwd });
  }
  sessionsHere() {
    return new Set(this.terminals.map((t) => t.session));
  }
  focusTerminal(session: string) {
    const shown = this.terminals.some((t) => t.session === session);
    if (shown) this.focused.push(session);
    return shown;
  }
  closeTerminals(session: string) {
    this.terminals = this.terminals.filter((t) => t.session !== session);
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
  assert.match(a1.description, /^claude · waiting · detached/);
  assert.equal(a1.icon, 'waiting');
  assert.match(a1.tooltip, /needs approval/);
  assert.match(tree.groups[0].rows[1].description, /unbound/);
  assert.deepEqual(tree.unmanaged.map((r) => r.name), ['plain']);
  assert.equal(tree.waiting, 1);
});

test('V2 selecting a row focuses its terminal, attaching or rebuilding first when needed', (t) => {
  const { sb, host, controller } = setup(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('v2'), '--origin', 'iterm2');
  controller.refresh();
  controller.focus('v2');
  assert.equal(host.terminals.length, 1);
  assert.deepEqual(host.terminals[0].argv.slice(-3), ['attach-session', '-t', '=v2']);
  assert.equal(sb.tmux('display-message', '-p', '-t', '=v2:', '#{@berth_origin}').trim(), 'vscode', 'attaching here moves origin');
  controller.focus('v2');
  assert.equal(host.terminals.length, 1, 'second select focuses, does not reattach');
  assert.deepEqual(host.focused, ['v2']);

  sb.cli('snapshot');
  killServer(sb);
  host.closeTerminals('v2');
  controller.focus('v2');
  assert.ok(sb.ctx().tmux.hasSession('v2'), 'stopped session rebuilt on select');
});

test('V3 new / detach / rename / kill / adopt act on the test server', (t) => {
  const { sb, host, controller } = setup(t);
  const dir = sb.makeDir('v3');
  const name = controller.newSession('claude', dir);
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
  controller.newSession('codex', dir, 'my-launcher --agent {agent}');
  assert.deepEqual(host.launched, [{ command: 'my-launcher --agent codex', cwd: dir }]);
});

test('V4 startup opens a terminal for each vscode session not shown, and only those', async (t) => {
  const { sb, host, controller } = setup(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('mine'), '--origin', 'vscode');
  sb.cli('new', 'claude', '--cwd', sb.makeDir('term'), '--origin', 'iterm2');
  sb.cli('new', 'claude', '--cwd', sb.makeDir('gone'), '--origin', 'vscode');
  sb.cli('snapshot');
  sb.tmux('kill-session', '-t', '=gone');
  const opened = controller.startup();
  assert.deepEqual(opened.sort(), ['gone', 'mine']);
  assert.deepEqual(host.terminals.map((x) => x.session).sort(), ['gone', 'mine']);
  assert.deepEqual(controller.startup(), [], 'already shown sessions are not reopened');
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
  controller.focus('v6');
  assert.equal(controller.tree().groups[0].rows[0].unread, false);
});

test('V7 the layout preset writes only its listed settings, tab hiding off by default', () => {
  const keys = layoutChanges(() => undefined, false).map((c) => c.key);
  assert.deepEqual(keys, [
    'terminal.integrated.tabs.location',
    'workbench.sideBar.location',
    'workbench.secondarySideBar.defaultVisibility',
    'terminal.integrated.tabs.description',
  ]);
  const hidden = layoutChanges(() => undefined, true);
  assert.deepEqual(hidden.at(-1), { key: 'terminal.integrated.tabs.enabled', value: false });
  assert.equal(buildTree([], { here: new Set(), unread: new Set(), branch: () => '' }).waiting, 0);
});
