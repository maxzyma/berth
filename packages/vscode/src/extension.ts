/** Berth for VS Code: glue between the editor API and the controller (spec §6). */
import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import * as vscode from 'vscode';
import { ADAPTERS, createContext } from '@berthdev/berth';
import { Controller, type Host } from './controller.js';
import { layoutChanges, type GroupView, type RowView, type Transition } from './model.js';

const REFRESH_MS = 2000;
const LAYOUT_BACKUP = 'berth.layoutBackup';
const WELCOMED = 'berth.welcomed';
const BERTH_CONTAINER = 'workbench.view.extension.berth';

type Node = { kind: 'group'; group: GroupView } | { kind: 'unmanaged'; rows: RowView[] } | { kind: 'row'; row: RowView };

const ICONS: Record<RowView['icon'], vscode.ThemeIcon> = {
  working: new vscode.ThemeIcon('loading~spin'),
  waiting: new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.yellow')),
  done: new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green')),
  stopped: new vscode.ThemeIcon('debug-stop'),
  idle: new vscode.ThemeIcon('circle-outline'),
  unmanaged: new vscode.ThemeIcon('terminal'),
};

const MAC_BUNDLES: Record<string, string> = {
  'Visual Studio Code': 'com.microsoft.VSCode',
  'Visual Studio Code - Insiders': 'com.microsoft.VSCodeInsiders',
  Cursor: 'com.todesktop.230313mzl4w4u92',
};

/**
 * System notification. On macOS, terminal-notifier is used when present so a
 * click brings the editor forward (where the in-editor notification offers
 * "Open"); without it the notification is shown but clicking does nothing useful.
 */
function osNotify(title: string, body: string): void {
  const os = platform();
  if (os === 'darwin') {
    const bundle = MAC_BUNDLES[vscode.env.appName];
    const notifier = spawnSync('which', ['terminal-notifier'], { encoding: 'utf8' }).stdout.trim();
    if (notifier) {
      spawn(notifier, ['-title', title, '-message', body, ...(bundle ? ['-activate', bundle] : [])], { stdio: 'ignore', detached: true }).unref();
      return;
    }
    const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
    spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
  } else if (os === 'linux') {
    spawn('notify-send', [title, body], { stdio: 'ignore', detached: true }).unref();
  }
}

class TerminalHost implements Host {
  private readonly bySession = new Map<string, Set<vscode.Terminal>>();
  focusSession?: (name: string) => void;

  openTerminal(session: string, argv: string[]): void {
    const [shellPath, ...shellArgs] = argv;
    // No `name`: VS Code then follows the title the session sets (`${sequence}`).
    const terminal = vscode.window.createTerminal({ shellPath, shellArgs, isTransient: true });
    const set = this.bySession.get(session) ?? new Set();
    set.add(terminal);
    this.bySession.set(session, set);
    terminal.show();
  }

  runInTerminal(command: string, cwd: string): void {
    const terminal = vscode.window.createTerminal({ cwd });
    terminal.show();
    terminal.sendText(command);
  }

  forget(terminal: vscode.Terminal): void {
    for (const set of this.bySession.values()) set.delete(terminal);
  }

  sessionsHere(): Set<string> {
    return new Set([...this.bySession.entries()].filter(([, set]) => set.size > 0).map(([name]) => name));
  }

  focusTerminal(session: string): boolean {
    const [terminal] = this.bySession.get(session) ?? [];
    if (!terminal) return false;
    terminal.show();
    return true;
  }

  closeTerminals(session: string): void {
    for (const terminal of this.bySession.get(session) ?? []) terminal.dispose();
    this.bySession.delete(session);
  }

  notify(t: Transition): void {
    const text = t.state === 'waiting' ? `${t.name} is waiting for you` : `${t.name} finished`;
    const detail = t.note ? `: ${t.note}` : '';
    void vscode.window.showInformationMessage(`${text}${detail}`, 'Open').then((choice) => {
      if (choice === 'Open') this.focusSession?.(t.name);
    });
    if (vscode.workspace.getConfiguration('berth').get<boolean>('osNotifications', true) && !vscode.window.state.focused) {
      osNotify('Berth', `${text}${detail}`);
    }
  }
}

class SessionTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  roots: Node[] = [];

  update(groups: GroupView[], unmanaged: RowView[]): void {
    this.roots = [
      ...groups.map((group): Node => ({ kind: 'group', group })),
      ...(unmanaged.length ? [{ kind: 'unmanaged', rows: unmanaged } as Node] : []),
    ];
    this.changed.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.roots;
    if (node.kind === 'group') return node.group.rows.map((row): Node => ({ kind: 'row', row }));
    if (node.kind === 'unmanaged') return node.rows.map((row): Node => ({ kind: 'row', row }));
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(node.group.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = node.group.cwd;
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }
    if (node.kind === 'unmanaged') return new vscode.TreeItem('Other tmux sessions', vscode.TreeItemCollapsibleState.Collapsed);
    const item = new vscode.TreeItem(node.row.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.row.description;
    item.tooltip = node.row.tooltip;
    item.contextValue = node.row.contextValue;
    item.iconPath = ICONS[node.row.icon];
    item.command = { command: 'berth.focus', title: 'Open Session', arguments: [node.row.name] };
    return item;
  }
}

function sessionArg(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  const node = arg as Node | undefined;
  return node?.kind === 'row' ? node.row.name : undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const socket = vscode.workspace.getConfiguration('berth').get<string>('tmuxSocket', '');
  const ctx = createContext({ ...process.env, ...(socket ? { BERTH_TMUX_SOCKET: socket } : {}) });
  const host = new TerminalHost();
  const controller = new Controller(ctx, host);
  const tree = new SessionTree();
  const view = vscode.window.createTreeView('berth.sessions', { treeDataProvider: tree });
  host.focusSession = (name) => controller.focus(name);

  const refresh = () => {
    try {
      const { tree: model } = controller.refresh();
      tree.update(model.groups, model.unmanaged);
      view.badge = model.waiting ? { value: model.waiting, tooltip: `${model.waiting} waiting for you` } : undefined;
    } catch (error) {
      view.message = `Berth: ${(error as Error).message}`;
    }
  };
  const guarded = (fn: (name: string) => unknown | Promise<unknown>) => async (arg: unknown) => {
    const name = sessionArg(arg);
    if (!name) return;
    try {
      await fn(name);
    } catch (error) {
      void vscode.window.showErrorMessage(`Berth: ${(error as Error).message}`);
    }
    refresh();
  };

  const command = (id: string, fn: (...args: unknown[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  command('berth.refresh', refresh);
  command('berth.focus', guarded((name) => controller.focus(name)));
  command('berth.attach', guarded((name) => controller.attach(name)));
  command('berth.detach', guarded((name) => controller.detach(name)));
  command('berth.rename', guarded(async (name) => {
    const to = await vscode.window.showInputBox({ prompt: `Rename ${name}`, value: name });
    if (to && to !== name) controller.rename(name, to);
  }));
  command('berth.kill', guarded(async (name) => {
    const ok = await vscode.window.showWarningMessage(`Kill session ${name}? The agent process ends.`, { modal: true }, 'Kill');
    if (ok === 'Kill') controller.kill(name);
  }));
  const pickAgent = async () =>
    (await vscode.window.showQuickPick(
      ADAPTERS.map((a) => ({ label: a.displayName, description: a.id, id: a.id })),
      { placeHolder: 'Agent' },
    ))?.id;
  command('berth.adopt', guarded(async (name) => {
    const agent = await pickAgent();
    if (agent) controller.adopt(name, agent);
  }));
  command('berth.new', async () => {
    const agent = await pickAgent();
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    if (!agent) return;
    try {
      controller.newSession(agent, folder, vscode.workspace.getConfiguration('berth').get<string>('customLauncher', ''));
    } catch (error) {
      void vscode.window.showErrorMessage(`Berth: ${(error as Error).message}`);
    }
    refresh();
  });
  command('berth.applyLayout', async () => {
    const config = vscode.workspace.getConfiguration();
    const hide = vscode.workspace.getConfiguration('berth').get<boolean>('layout.hideTerminalTabs', false);
    const changes = layoutChanges((key) => config.get(key), hide);
    const ok = await vscode.window.showInformationMessage(
      `Apply the agent layout? It changes ${changes.length} user settings; Revert Agent Layout restores them.`,
      { modal: true },
      'Apply',
    );
    if (ok !== 'Apply') return;
    const backup = Object.fromEntries(changes.map((c) => [c.key, config.inspect(c.key)?.globalValue ?? null]));
    await context.globalState.update(LAYOUT_BACKUP, backup);
    for (const c of changes) await config.update(c.key, c.value, vscode.ConfigurationTarget.Global);
    // Sessions on the left, their terminals in the editor area. Undo an earlier
    // layout that put the Terminal view into the Berth container.
    await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['terminal'], destinationId: 'terminal' });
    await vscode.commands.executeCommand(BERTH_CONTAINER);
  });
  command('berth.revertLayout', async () => {
    const backup = context.globalState.get<Record<string, unknown>>(LAYOUT_BACKUP);
    if (!backup) return;
    const config = vscode.workspace.getConfiguration();
    for (const [key, value] of Object.entries(backup)) await config.update(key, value ?? undefined, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['terminal'], destinationId: 'terminal' });
    await context.globalState.update(LAYOUT_BACKUP, undefined);
  });

  context.subscriptions.push(
    view,
    vscode.window.onDidCloseTerminal((t) => host.forget(t)),
    { dispose: (() => { const timer = setInterval(refresh, REFRESH_MS); return () => clearInterval(timer); })() },
  );
  // First run: show the sessions view and offer the layout once; settings still change only on confirmation.
  if (!context.globalState.get<boolean>(WELCOMED)) {
    void context.globalState.update(WELCOMED, true);
    void vscode.commands.executeCommand('workbench.view.extension.berth');
    void vscode.window
      .showInformationMessage('Berth is ready. Apply the agent layout (sessions on the left, terminals in the editor area, files on the right)?', 'Apply…', 'Not now')
      .then((choice) => {
        if (choice === 'Apply…') void vscode.commands.executeCommand('berth.applyLayout');
      });
  }
  try {
    controller.startup();
  } catch (error) {
    view.message = `Berth: ${(error as Error).message}`;
  }
  refresh();
}

export function deactivate(): void {}
