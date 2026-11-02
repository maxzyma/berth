/**
 * V1–V7 without a VS Code window: the controller and view model run against a
 * fake editor host and a real, isolated tmux server (implementation §5.3).
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { shellQuote, type Context } from '@berthdev/berth';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, type Host, type TerminalRole } from '../src/controller.js';
import { sessionChoices, buildTree, defaultFolder, explorerTarget, shortPath, launcherPicksAgent, layoutChanges, nextAttention, orderAgents, placeOf, relativeToWorkspace, renderLauncher, type Transition } from '../src/model.js';

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
  ownerWorkspace() { return "test-workspace"; }
  claimStartup() { return true; }
  terminals: { session: string; argv: string[]; role: TerminalRole; cwd?: string }[] = [];
  notified: Transition[] = [];
  shown: string[] = [];
  /** pid of a real tmux client standing in for the main terminal, when a test provides one. */
  mainPid?: number;
  main?: string;
  openTerminal(session: string, argv: string[], role: TerminalRole, cwd?: string) {
    this.terminals.push({ session, argv, role, cwd });
    if (role === 'main') { this.main = session; if (!session) this.mainPid ??= process.pid; }
  }
  async mainTerminalPid() {
    return this.main !== undefined ? this.mainPid : undefined;
  }
  showMain(session: string) {
    this.main = session;
    this.shown.push(session);
  }
  renameSession(from: string, to: string) {
    if (this.main === from) this.main = to;
    this.terminals = this.terminals.map((terminal) => terminal.session === from ? { ...terminal, session: to } : terminal);
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
  suggested: string[] = [];
  suggestHooks(agent: string) {
    this.suggested.push(agent);
  }
}

function attachPty(socket: string, session: string) {
  const command = ['tmux', '-L', socket, 'attach-session', '-t', `=${session}`];
  const args = process.platform === 'darwin' ? ['-q', '/dev/null', ...command]
    : ['-q', '-c', command.map(shellQuote).join(' '), '/dev/null'];
  return spawn('script', args, { env: { ...process.env, TERM: 'xterm-256color' }, stdio: 'ignore' });
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
  // Line one: name, agent, badge; line two: what the agent said; the hover card has the rest.
  const a1 = tree.groups[0].rows[0];
  assert.deepEqual([a1.label, a1.agent, a1.icon, a1.badge, a1.subtitle, a1.subtitleKind], ['a1', 'claude', 'waiting', '!', 'needs approval', 'note']);
  assert.equal(tree.groups[0].rows[1].subtitle, '', 'nothing to read while idle without a topic');
  assert.deepEqual(a1.hover.map((l) => [l.kind ?? '', l.icon, l.text]).slice(0, 3), [
    ['title', '', 'a1'],
    ['quote', 'comment', 'needs approval'],
    ['rule', '', ''],
  ]);
  assert.deepEqual(a1.hover[0].chip, { icon: 'bell-dot', text: 'Waiting for you', tone: 'waiting' }, 'state is a chip on the title');
  assert.equal(tree.groups[0].rows[1].hover[0].chip, undefined, 'idle shows no chip');
  assert.equal(shortPath('/h/ws/projects/x', ['/h/ws'], '/h'), 'ws/projects/x');
  assert.equal(shortPath('/h/other', ['/h/ws'], '/h'), '~/other');
  assert.ok(a1.hover.filter((l) => l.kind !== 'title' && l.kind !== 'rule').every((l) => l.icon), 'every detail line has its icon');
  assert.equal(a1.attention, 'waiting');
  assert.equal(tree.groups[0].attention, 'waiting', 'a group carries its most urgent session');
  assert.equal(tree.groups[1].attention, '');
  assert.ok(!tree.groups[0].rows[1].hover.some((l) => /automatic recovery is unavailable/.test(l.text)), 'live details do not delegate recovery diagnosis');
  assert.equal(tree.groups[0].rows[1].badge, '', 'idle and read: no badge');
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
  const client = attachPty(sb.socket, 'a');
  t.after(() => client.kill());
  const pid = await waitFor(() => Number(sb.tmux('list-clients', '-t', '=a', '-F', '#{client_pid}').trim()) || undefined, 'client attached', 20_000);
  host.mainPid = pid;
  await controller.show('b');
  assert.equal(host.terminals.length, 1, 'no second terminal: the main one switched');
  assert.deepEqual(host.shown, ['b']);
  await waitFor(() => sb.tmux('list-clients', '-F', '#{client_pid} #{session_name}').trim() === `${pid} b`, 'client switched to b');

  sb.cli('stamp', '--session', 'b', 'conversation=conv-b');
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
  await controller.openToSide('b');
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
  await controller.detach('v3');
  assert.equal(host.terminals.length, 1, 'detach does not dispose a terminal from cached ownership');
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
  sb.cli('stamp', '--session', 'gone', 'conversation=conv-gone', 'ownerWorkspace=test-workspace');
  sb.cli('snapshot');
  killServer(sb);
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
  const hidden = layoutChanges(() => undefined, true);
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
  const client = attachPty(sb.socket, 'l');
  t.after(() => client.kill());
  host.mainPid = await waitFor(() => Number(sb.tmux('list-clients', '-t', '=l', '-F', '#{client_pid}').trim()) || undefined, 'client attached', 20_000);
  host.main = '';
  assert.equal(await controller.mainSession(), 'l');
});

test('V3 a session from a launcher that knows nothing of Berth is adopted with the chosen agent and its real directory', async (t) => {
  const { sb, host, controller } = setup(t);
  const chosen = sb.makeDir('ws');
  const project = sb.makeDir('ws/projects/real');
  await controller.newSession('codex', chosen, 'any-launcher {relative}', [chosen]);
  // The launcher: creates its own session, changes into the project, runs a shell.
  sb.tmux('new-session', '-d', '-s', 'from-launcher', '-c', chosen, `exec sh -c 'cd "${project}" && exec sleep 3600'`);
  await waitFor(() => sb.tmux('display-message', '-p', '-t', '=from-launcher:', '#{pane_current_path}').trim().endsWith('/projects/real'), 'launcher changed dir');
  assert.equal(await controller.settleLaunch('from-launcher', process.pid), true);
  const meta = sb.tmux('display-message', '-p', '-t', '=from-launcher:', '#{@berth_agent}|#{@berth_origin}|#{@berth_cwd}').trim();
  assert.match(meta, /^codex\|vscode\|.*\/ws\/projects\/real$/);
  assert.equal(await controller.settleLaunch('from-launcher', process.pid), false, 'settled once');
  assert.equal(host.terminals.at(-1)?.role, 'main');
});

test('V3 a launcher that stamps its own metadata keeps it', async (t) => {
  const { sb, controller } = setup(t);
  const dir = sb.makeDir('own');
  await controller.newSession('codex', dir, 'stamping-launcher', [dir]);
  sb.tmux('new-session', '-d', '-s', 'stamped', '-c', dir, 'sleep 3600');
  sb.cli('stamp', '--session', 'stamped', 'agent=kimi', `cwd=${dir}`, 'origin=none');
  await controller.settleLaunch('stamped', process.pid);
  assert.equal(sb.tmux('display-message', '-p', '-t', '=stamped:', '#{@berth_agent}|#{@berth_origin}').trim(), 'kimi|vscode');
});

test('V3 launcher values keep their spaces; showing an unmanaged session stamps nothing', async (t) => {
  assert.equal(
    renderLauncher('run  --dir {cwd} {relative}', { agent: 'a', cwd: '/x/two  spaces', relative: '', name: 'n' }),
    "run --dir '/x/two  spaces'",
  );
  const { sb, controller } = setup(t);
  sb.tmux('new-session', '-d', '-s', 'plain', 'sleep 3600');
  controller.refresh();
  await controller.show('plain');
  assert.equal(sb.tmux('display-message', '-p', '-t', '=plain:', '#{@berth_origin}|#{set-titles}').trim().split('|')[0], '');
});

test('V3 a pending launch never adopts a session that existed before it', async (t) => {
  const { sb, controller } = setup(t);
  const dir = sb.makeDir('old');
  sb.tmux('new-session', '-d', '-s', 'older', '-c', dir, 'sleep 3600');
  await new Promise((r) => setTimeout(r, 2100));
  await controller.newSession('claude', dir, 'launcher', [dir]);
  // tmux records creation in whole seconds; the launch started > 2 s after it.
  assert.equal(await controller.settleLaunch('older', process.pid), false);
  assert.equal(sb.tmux('display-message', '-p', '-t', '=older:', '#{@berth_agent}').trim(), '');
});

test('V12 a shell never goes through the launcher; a launcher without {agent} picks the agent itself', async (t) => {
  assert.equal(launcherPicksAgent('/x/open {relative}'), true);
  assert.equal(launcherPicksAgent('/x/open --cli {agent} {relative}'), false);
  assert.equal(launcherPicksAgent(''), false);
  assert.equal(defaultFolder('/shown', ['/a', '/b']), '/shown');
  assert.equal(defaultFolder(undefined, ['/a']), '/a');
  assert.equal(defaultFolder(undefined, ['/a', '/b']), undefined, 'ambiguous: ask');

  const { sb, host, controller } = setup(t);
  const dir = sb.makeDir('sh');
  const name = await controller.newSession('shell', dir, '/x/open --cli {agent} {relative}', [dir]);
  assert.equal(name, 'sh', 'Berth starts the shell itself');
  assert.equal(host.terminals.at(-1)?.argv.join(' ').includes('/x/open'), false);

  // The launcher asked the user and started kimi: the pane runs a `kimi` binary.
  const bin = sb.makeDir('bin');
  writeFileSync(join(bin, 'kimi'), '#!/bin/sh\nsleep 3600\n');
  chmodSync(join(bin, 'kimi'), 0o755);
  await controller.newSession(undefined, dir, '/x/open {relative}', [dir]);
  assert.match(host.terminals.at(-1)!.argv.at(-1)!, /^\/x\/open$/);
  // A launcher's shell runs the agent as a child, the way `open` does.
  sb.tmux('new-session', '-d', '-s', 'picked', '-c', dir, `sh -c '${join(bin, 'kimi')} --flag; true'`);
  await waitFor(() => spawnSync('pgrep', ['-f', join(bin, 'kimi')]).status === 0, 'kimi running');
  assert.equal(await controller.settleLaunch('picked', process.pid), true);
  assert.equal(sb.tmux('display-message', '-p', '-t', '=picked:', '#{@berth_agent}').trim(), 'kimi');
});

test('V11 missing hooks remain discoverable without automatic install prompts', (t) => {
  const { sb, host, controller } = setup(t);
  sb.cli('new', 'kimi', '--cwd', sb.makeDir('k1'));
  sb.cli('new', 'kimi', '--cwd', sb.makeDir('k2'));
  sb.cli('new', 'shell', '--cwd', sb.makeDir('s1'));
  const { tree } = controller.refresh();
  controller.refresh();
  assert.deepEqual(host.suggested, [], 'inventory never prompts for hook installation');
  const k1 = tree.groups.flatMap((g) => g.rows).find((r) => r.name === 'k1')!;
  assert.match(k1.contextValue, /hooks-missing/);
  assert.ok(k1.hover.some((l) => l.kind === 'warning' && /hooks are not installed/.test(l.text)));
  sb.cli('hooks', 'install', 'kimi');
  const after = controller.refresh().tree.groups.flatMap((g) => g.rows).find((r) => r.name === 'k1')!;
  assert.doesNotMatch(after.contextValue, /hooks-missing/);
});

test('V1 the subtitle is the notification while it matters, else the topic', () => {
  const base = { name: 't', managed: true, agent: 'claude', cwd: '/w', conversation: 'c', origin: 'vscode', note: '', topic: 'Fix the login bug', attachedClients: 0, live: true, hooks: 'installed' as const };
  const row = (state: string, note = '') => buildTree([{ ...base, state, note }], { here: new Set(), unread: new Set(), branch: () => 'main' }).groups[0].rows[0];
  assert.deepEqual([row('working').subtitle, row('working').subtitleKind], ['Fix the login bug', 'topic']);
  assert.deepEqual([row('waiting', 'Allow Bash?').subtitle, row('waiting', 'Allow Bash?').subtitleKind], ['Allow Bash?', 'note']);
  assert.equal(row('working').details, 'detached', 'shared branch belongs to the folder heading');
});

test('V1 a finished turn shows until the user has seen it; a new state replaces the old notification', (t) => {
  const row = { name: 'f', managed: true, agent: 'claude', cwd: '/w', conversation: 'c', origin: 'vscode', state: 'done', note: 'All set', topic: '', attachedClients: 0, live: true, hooks: 'installed' as const };
  const view = (unread: boolean) => buildTree([row], { here: new Set(), unread: new Set(unread ? ['f'] : []), branch: () => '' }).groups[0].rows[0];
  assert.deepEqual([view(true).icon, view(true).badge, view(true).attention, view(true).subtitle], ['done', '•', 'unread', 'All set']);
  assert.deepEqual([view(false).icon, view(false).badge, view(false).attention, view(false).subtitle], ['idle', '', '', '']);
  assert.match(view(true).contextValue, / unread$/, 'offers Mark as Read');
});

test('V10 go to the next session needing you: waiting first, then unread, wrapping', async (t) => {
  const row = (name: string, state = '') => ({ name, managed: true, agent: 'claude', cwd: '/w', conversation: '', origin: 'vscode', state, note: '', topic: '', attachedClients: 0, live: true, hooks: 'none' as const });
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



test('V13 folders are placed relative to the workspace; New Session lists agents in the configured order', () => {
  assert.equal(placeOf('/ws', ['/ws/']), 'workspace');
  assert.equal(placeOf('/ws/projects/x', ['/ws']), 'inside');
  assert.equal(placeOf('/wsx', ['/ws']), 'outside', 'a shared prefix is not containment');
  const row = (name: string, cwd: string) => ({ name, managed: true, agent: 'claude', cwd, conversation: 'c', origin: 'vscode', state: '', note: '', topic: '', attachedClients: 0, live: true, hooks: 'installed' as const });
  const tree = buildTree([row('o', '/elsewhere'), row('i', '/ws/sub'), row('w', '/ws')], { here: new Set(), unread: new Set(), branch: () => '', workspaceFolders: ['/ws'] });
  assert.deepEqual(tree.groups.map((g) => [g.cwd, g.place]), [['/ws', 'workspace'], ['/ws/sub', 'inside'], ['/elsewhere', 'outside']]);

  const agents = ['claude', 'codex', 'gemini', 'shell'].map((id) => ({ id }));
  assert.deepEqual(orderAgents(agents, ['shell', 'codex', 'nope']).map((a) => a.id), ['shell', 'codex', 'claude', 'gemini']);
  assert.deepEqual(orderAgents(agents, []).map((a) => a.id), ['claude', 'codex', 'gemini', 'shell']);
});

test('V1 shell details do not claim a missing agent conversation', () => {
  const base = { name: 'terminal', managed: true, agent: 'shell', cwd: '/workspace', conversation: '', origin: 'vscode', state: '', note: '', topic: '', attachedClients: 1, live: true, hooks: 'none' as const };
  const details = (agent: string, live = true) => buildTree([{ ...base, agent, live }], { here: new Set(), unread: new Set(), branch: () => '' }).groups[0].rows[0].hover;
  assert.equal(details('shell').some(line => line.text.includes('Conversation not bound')), false);
  assert.equal(details('codex').some(line => line.text.includes('Conversation not bound')), false);
  assert.equal(details('codex', false).some(line => line.text.includes('Conversation not bound')), true);
});


test('V2 natural session order survives snapshot/live interleaving and unmanaged rows', () => {
  const names = ['job-13', 'job-2', 'job', 'job-10', 'job-3'];
  const rows = names.map((name, index) => ({ name, managed: true, agent: 'shell', cwd: '/project', conversation: '', origin: 'vscode', state: '', note: '', topic: '', attachedClients: 0, live: index % 2 === 0, hooks: 'none' as const }));
  const input = { here: new Set<string>(), unread: new Set<string>(), branch: () => '' };
  const expected = ['job', 'job-2', 'job-3', 'job-10', 'job-13'];
  for (const source of [rows, [...rows].reverse()]) {
    assert.deepEqual(buildTree(source, input).groups[0].rows.map(row => row.name), expected);
    assert.deepEqual(buildTree(source.map(row => ({ ...row, managed: false })), input).unmanaged.map(row => row.name), expected);
  }
  assert.deepEqual(rows.map(row => row.name), names, 'does not reorder source data');
});

test('V10 attention navigation uses natural numbers within each priority', () => {
  const rows = ['job-13', 'job-2', 'job-3', 'job-10'].map(name => ({ name, managed: true, agent: 'shell', cwd: '/project', conversation: '', origin: 'vscode', state: name === 'job-2' || name === 'job-13' ? 'waiting' : '', note: '', topic: '', attachedClients: 0, live: true, hooks: 'none' as const }));
  const unread = new Set(['job-3', 'job-10']);
  assert.equal(nextAttention(rows, unread), 'job-2');
  assert.equal(nextAttention(rows, unread, 'job-2'), 'job-13');
  assert.equal(nextAttention(rows, unread, 'job-13'), 'job-3');
  assert.equal(nextAttention(rows, unread, 'job-3'), 'job-10');
  assert.equal(nextAttention(rows, unread, 'job-10'), 'job-2');
});


test('Failed main and side opens preserve unread and origin', async (t) => {
  const { sb, controller, host } = setup(t);
  sb.cli('new', 'claude', '--cwd', sb.makeDir('project'), '--name', 'target', '--origin', 'iterm2');
  controller.unread.add('target');
  host.openTerminal = () => { throw new Error('host refused'); };
  await assert.rejects(controller.show('target'), /host refused/);
  assert.equal(controller.unread.has('target'), true);
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.origin, 'iterm2');
  await assert.rejects(controller.openToSide('target'), /host refused/);
  assert.equal(controller.unread.has('target'), true);
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.origin, 'iterm2');
});

test('Rename updates snapshot, host references and unread; collision preserves both', async (t) => {
  const { sb, controller, host } = setup(t);
  sb.cli('new', 'shell', '--cwd', sb.makeDir('project'), '--name', 'before');
  await controller.show('before');
  await controller.openToSide('before');
  controller.unread.add('before');
  controller.rename('before', 'after');
  assert.deepEqual([...host.sessionsHere()], ['after']);
  assert.deepEqual([...controller.unread], ['after']);
  assert.deepEqual(sb.ctx().store.newest()?.sessions.map((s) => s.name), ['after']);
  sb.cli('new', 'shell', '--cwd', sb.makeDir('other'), '--name', 'occupied');
  assert.throws(() => controller.rename('after', 'occupied'), /already exists/);
  assert.equal(sb.ctx().tmux.hasSession('after'), true);
  assert.equal(sb.ctx().tmux.hasSession('occupied'), true);
});

test('Startup uses the same natural order as the session list', async (t) => {
  const { sb, controller } = setup(t);
  for (const name of ['job-13', 'job-2']) {
    sb.cli('new', 'shell', '--cwd', sb.makeDir(name), '--name', name, '--origin', 'vscode');
    sb.cli('stamp', '--session', name, 'ownerWorkspace=test-workspace');
  }
  assert.equal(await controller.startup(), 'job-2');
});


test('Pending attachment leaves state unchanged until the host acknowledges', async (t) => {
  const { sb, controller, host } = setup(t);
  sb.cli('new', 'shell', '--cwd', sb.makeDir('pending'), '--name', 'pending', '--origin', 'iterm2');
  controller.unread.add('pending');
  let acknowledge!: () => void;
  host.openTerminal = () => new Promise<void>((resolve) => { acknowledge = resolve; });
  const opened = controller.show('pending');
  await waitFor(() => acknowledge, 'open request');
  assert.equal(controller.unread.has('pending'), true);
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.origin, 'iterm2');
  acknowledge();
  await opened;
  assert.equal(controller.unread.has('pending'), false);
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.origin, 'vscode');
});

test('Rename rolls back tmux and preserves host references on snapshot write failure', async (t) => {
  const { sb, host } = setup(t);
  sb.cli('new', 'shell', '--cwd', sb.makeDir('rollback'), '--name', 'before');
  const ctx = sb.ctx();
  ctx.store.write = () => { throw new Error('disk unavailable'); };
  const controller = new Controller(ctx, host);
  host.main = 'before';
  controller.unread.add('before');
  assert.throws(() => controller.rename('before', 'after'), /disk unavailable/);
  assert.equal(ctx.tmux.hasSession('before'), true);
  assert.equal(ctx.tmux.hasSession('after'), false);
  assert.deepEqual([...host.sessionsHere()], ['before']);
  assert.deepEqual([...controller.unread], ['before']);
});




test('Search choices preserve exact identity and natural order at 5, 20 and 100 sessions', () => {
  for (const size of [5, 20, 100]) {
    const rows = Array.from({ length: size }, (_, i) => ({ name: `job-${size - i}`, agent: 'codex', managed: true, cwd: `/workspace/project-${i}`, conversation: `id-${i}`, conversationTitle: 'Shared title', origin: 'none', state: '', note: '', topic: '', live: i % 2 === 0, attachedClients: 0, hooks: 'installed' as const }));
    const choices = sessionChoices(rows);
    assert.equal(choices.length, size);
    assert.equal(choices[0].session, 'job-1');
    assert.equal(choices.at(-1)?.session, `job-${size}`);
    for (const choice of choices) {
      const source = rows.find((row) => row.name === choice.session)!;
      assert.ok(choice.detail.includes(source.cwd));
      assert.ok(choice.detail.includes('Shared title'));
      assert.ok(choice.description.includes(source.live ? 'Running' : 'Stopped'));
    }
  }
});

test('Startup does not adopt legacy or another workspace ownership', async (t) => {
  const { sb, controller } = setup(t);
  for (const name of ['legacy', 'foreign']) sb.cli('new', 'shell', '--cwd', sb.makeDir(name), '--origin', 'vscode');
  sb.cli('stamp', '--session', 'foreign', 'ownerWorkspace=other-workspace');
  assert.equal(await controller.startup(), undefined);
});


test('External rename is reflected in the recovery snapshot on refresh', (t) => {
  const { sb, controller } = setup(t);
  sb.cli('new', 'shell', '--cwd', sb.makeDir('external'), '--name', 'before');
  controller.refresh();
  sb.tmux('rename-session', '-t', '=before', 'after');
  controller.refresh();
  assert.deepEqual(sb.ctx().store.newest()?.sessions.map((session) => session.name), ['after']);
});

test('CR7 main selections commit in request order even when the first attachment is delayed', async (t) => {
  const { sb, controller, host } = setup(t);
  const cwd = sb.makeDir('ordered');
  sb.cli('new', 'shell', '--cwd', cwd, '--name', 'first');
  sb.cli('new', 'shell', '--cwd', cwd, '--name', 'second');
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = host.openTerminal.bind(host);
  const calls: string[] = [];
  host.openTerminal = async (name, argv, role, path) => {
    calls.push(name);
    if (name === 'first') { started(); await gate; }
    original(name, argv, role, path);
  };
  const first = controller.show('first');
  await entered;
  const second = controller.show('second');
  assert.deepEqual(calls, ['first']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(host.main, 'second');
});

test('CR7 a rejected main attachment does not cancel the next selection', async (t) => {
  const { sb, controller, host } = setup(t);
  const cwd = sb.makeDir('ordered');
  for (const name of ['first', 'second']) sb.cli('new', 'shell', '--cwd', cwd, '--name', name);
  const original = host.openTerminal.bind(host);
  host.openTerminal = async (name, argv, role, path) => {
    if (name === 'first') throw new Error('injected attachment failure');
    original(name, argv, role, path);
  };
  const first = assert.rejects(controller.show('first'), /injected attachment failure/);
  const second = controller.show('second');
  await Promise.all([first, second]);
  assert.equal(host.main, 'second');
});

test('CR7 detach waits for a pending main open without disposing cached terminals', async (t) => {
  const { sb, controller, host } = setup(t);
  sb.cli('new', 'shell', '--cwd', sb.makeDir('ordered'), '--name', 'first');
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = host.openTerminal.bind(host);
  host.openTerminal = async (...args) => { started(); await gate; original(...args); };
  const open = controller.show('first');
  await entered;
  const detach = controller.detach('first');
  release();
  await Promise.all([open, detach]);
  assert.equal(host.main, 'first', 'fake terminal remains until its actual process exits');
});


test('CR14 stale host references cannot dispose a client switched to another session', async (t) => {
  const { sb, host, controller } = setup(t);
  for (const name of ['a', 'b']) sb.cli('new', 'shell', '--cwd', sb.makeDir(name), '--name', name);
  await controller.show('a');
  const client = attachPty(sb.socket, 'a');
  t.after(() => client.kill());
  const pid = await waitFor(() => Number(sb.tmux('list-clients', '-t', '=a', '-F', '#{client_pid}').trim()) || undefined, 'attached');
  host.mainPid = pid;
  const tty = sb.tmux('list-clients', '-t', '=a', '-F', '#{client_tty}').trim();
  sb.tmux('switch-client', '-c', tty, '-t', '=b');
  host.closeTerminals = () => { assert.fail('cached session labels must not dispose terminals'); };
  await controller.detach('a');
  assert.equal(sb.tmux('list-clients', '-F', '#{client_pid} #{session_name}').trim(), `${pid} b`);
  await controller.kill('a');
  assert.equal(sb.tmux('list-clients', '-F', '#{client_pid} #{session_name}').trim(), `${pid} b`);
  assert.equal(sb.ctx().tmux.hasSession('b'), true);
});

test('CR52 main and side attachment present fresh state after bell acknowledgement and delayed completion', async (t) => {
  const { readFileSync } = await import('node:fs');
  for (const side of [false, true]) for (const bell of [false, true]) {
    const sb = sandbox(t), ctx = sb.ctx(), host = new FakeHost();
    const controller = new Controller(ctx, host), name = 'activity';
    sb.cli('new', 'shell', '--cwd', sb.makeDir('repo'), '--name', name);
    ctx.tmux.setMeta(name, { state: bell ? 'waiting' : 'working', note: bell ? 'bell' : '' });
    controller.refresh();
    const output = join(sb.makeDir('output'), 'terminal'); writeFileSync(output, '');
    const run = ctx.tmux.run.bind(ctx.tmux);
    ctx.tmux.run = (args, ...rest) => args[0] === 'list-clients' && args.includes('-t')
      ? { ok: true, stdout: `${output}~xterm-256color\n`, stderr: '' } : run(args, ...rest);
    const open = host.openTerminal.bind(host);
    host.openTerminal = (...args) => {
      if (!bell) ctx.tmux.setMeta(name, { state: 'done' });
      open(...args);
    };
    if (side) await controller.openToSide(name); else await controller.show(name);
    const bytes = readFileSync(output, 'utf8');
    assert.ok(bytes.includes('\x1b]9;4;0;0'));
    assert.equal(bytes.includes('\x1b]9;4;4;0'), false);
    assert.equal(bytes.includes('\x1b]9;4;3;0'), false);
    assert.equal(ctx.tmux.listSessions()[0].meta.state ?? '', bell ? '' : 'done');
  }
});

test('CR53 failed launch and wrong terminal observations cannot adopt an unrelated session', async (t) => {
  const { sb, host, controller } = setup(t);
  const open = host.openTerminal.bind(host);
  host.openTerminal = () => { throw new Error('launcher failed'); };
  await assert.rejects(controller.newSession('codex', sb.makeDir('repo'), 'fixture'), /launcher failed/);
  sb.tmux('new-session', '-d', '-s', 'unrelated', 'sleep 3600');
  assert.equal(await controller.settleLaunch('unrelated', process.pid), false);
  host.openTerminal = open;
  await controller.newSession('codex', sb.makeDir('repo2'), 'fixture');
  assert.equal(await controller.settleLaunch('unrelated', process.pid + 1), false);
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.agent, undefined);
  await controller.detach('unrelated');
  assert.equal(await controller.settleLaunch('unrelated', process.pid), false);
});

test('CR53 queued launcher failure clears the first intent without stealing its selected agent', async (t) => {
  const { sb, host, controller } = setup(t);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let count = 0;
  host.openTerminal = async (_session, _argv, _role) => {
    count++;
    if (count === 1) { await gate; host.main = ''; host.mainPid = process.pid; }
    else throw new Error('second launch failed');
  };
  const first = controller.newSession('codex', sb.makeDir('one'), 'fixture');
  const second = controller.newSession('kimi', sb.makeDir('two'), 'fixture');
  const rejected = assert.rejects(second, /second launch failed/);
  release(); await first; await rejected;
  sb.tmux('new-session', '-d', '-s', 'after-failure', 'sleep 3600');
  assert.equal(await controller.settleLaunch('after-failure', process.pid), false);
  assert.equal(sb.ctx().tmux.listSessions()[0].meta.agent, undefined);
});

for (const role of ['main', 'side'] as const) {
  for (const managedBefore of [false, true]) {
    test(`attachment ${role} uses live management after cached ${managedBefore ? 'managed' : 'unmanaged'} inventory`, async (t) => {
      const { sb, controller } = setup(t);
      sb.tmux('new-session', '-d', '-s', 'changed', 'sleep 3600');
      if (managedBefore) sb.tmux('set-option', '-t', '=changed:', '@berth_agent', 'shell');
      controller.refresh();
      if (managedBefore) sb.tmux('set-option', '-u', '-t', '=changed:', '@berth_agent');
      else sb.tmux('set-option', '-t', '=changed:', '@berth_agent', 'shell');
      if (role === 'main') await controller.show('changed');
      else await controller.openToSide('changed');
      assert.equal(sb.tmux('display-message', '-p', '-t', '=changed:', '#{@berth_origin}').trim(), managedBefore ? '' : 'vscode');
      assert.equal(sb.tmux('display-message', '-p', '-t', '=changed:', '#{@berth_ownerWorkspace}').trim(), managedBefore ? '' : 'test-workspace');
    });
  }
}

test('main attachment preserves externally supplied session names through the client transport', async (t) => {
  const { sb, host, controller } = setup(t);
  const ctx = sb.ctx();
  ctx.tmux.newSession(' external name~=value ', sb.makeDir('external'), 'sleep 3600');
  const name = ctx.tmux.listSessions()[0].name;
  const [bin, ...args] = sb.ctx().tmux.attachArgv(name);
  const client = spawn(bin, ['-C', ...args], { env: sb.ctx().env, stdio: ['pipe', 'ignore', 'ignore'] });
  t.after(() => client.kill());
  await waitFor(() => sb.tmux('list-clients', '-F', '#{client_pid}').trim() === String(client.pid), 'control client attached');
  host.main = name;
  host.mainPid = client.pid;
  assert.deepEqual(await controller.mainAttachment(), { session: name, terminalPid: client.pid });
});


test('binding risks and current terminal are independent of window membership', () => {
  const base = { managed: true, agent: 'claude', cwd: '/w', conversation: 'original', origin: 'vscode', state: 'working', note: '', topic: '', attachedClients: 1, live: true, hooks: 'installed' as const, bindingIssue: 'No process identity recorded.' };
  const rows = [20, 30].map(pid => ({ ...base, name: `job-${pid}`, connections: [{ pid, ancestors: [pid], terminal: 'tty', application: 'VS Code' }] }));
  const input = { here: new Set<string>(), terminalPids: new Set([20, 30]), activeTerminalPid: 20, unread: new Set<string>(), branch: () => '' };
  const views = buildTree(rows, input).groups[0].rows;
  assert.deepEqual(views.map(row => row.active), [true, false]);
  for (const row of views) {
    assert.equal(row.details, 'This window');
    assert.ok(!row.hover.some(line => line.checkRecoveryFor || line.text.includes('No process identity recorded')));
    assert.equal(row.icon, 'working');
  }
  assert.ok(buildTree([{ ...rows[0], live: false }], input).groups[0].rows[0].details.includes('Verify before resuming'));
  assert.ok(buildTree(rows, { ...input, activeTerminalPid: undefined }).groups[0].rows.every(row => !row.active));
});
