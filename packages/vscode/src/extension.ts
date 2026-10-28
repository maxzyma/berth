/** Berth for VS Code: glue between the editor API and the controller (spec §6). */
import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import * as vscode from 'vscode';
import { ADAPTERS, createContext, type SessionRow } from '@berthdev/berth';
import { Controller, type Host, type TerminalRole } from './controller.js';
import { explorerTarget, layoutChanges, type GroupView, type RowView, type Transition } from './model.js';

const REFRESH_MS = 2000;
const LAYOUT_BACKUP = 'berth.layoutBackup';
const WELCOMED = 'berth.welcomed';
const BERTH_CONTAINER = 'workbench.view.extension.berth';
/** Bump when Apply Agent Layout changes what it does, so users who applied an older one are offered the new one. */
const LAYOUT_VERSION = 7;
const APPLIED_LAYOUT = 'berth.appliedLayoutVersion';

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
  /** The one session terminal that follows the selection, and the session it shows. */
  private main?: { terminal: vscode.Terminal; session: string };
  /** Extra terminals opened beside it. */
  private readonly side = new Map<vscode.Terminal, string>();
  focusSession?: (name: string) => void;
  onShown?: (row: SessionRow) => void;

  openTerminal(session: string, argv: string[], role: TerminalRole, cwd?: string): void {
    const [shellPath, ...shellArgs] = argv;
    // No `name`: VS Code then follows the title the session sets (`${sequence}`).
    const terminal = vscode.window.createTerminal({
      shellPath,
      shellArgs,
      cwd,
      isTransient: true,
      location: { viewColumn: role === 'main' ? vscode.ViewColumn.One : vscode.ViewColumn.Beside, preserveFocus: false },
    });
    if (role === 'main') {
      this.main?.terminal.dispose();
      this.main = { terminal, session };
    } else {
      this.side.set(terminal, session);
    }
    terminal.show();
    // The session terminal's group is locked so files open beside it.
    if (role === 'main') void vscode.commands.executeCommand('workbench.action.lockEditorGroup');
  }

  async mainTerminalPid(): Promise<number | undefined> {
    if (!this.main || this.main.terminal.exitStatus) return undefined;
    return this.main.terminal.processId;
  }

  showMain(session: string): void {
    if (!this.main) return;
    this.main.session = session;
    this.main.terminal.show();
  }

  mainSession(): string | undefined {
    return this.main?.session;
  }

  focusMain(): void {
    this.main?.terminal.show(false);
  }

  /** Session shown by a terminal, if it is one of Berth's. */
  sessionOf(terminal: vscode.Terminal): string | undefined {
    if (this.main?.terminal === terminal) return this.main.session;
    return this.side.get(terminal);
  }

  /** The main terminal now shows `session` (learned from its tmux client); no focus change. */
  noteMainSession(session: string): void {
    if (this.main) this.main.session = session;
  }

  forget(terminal: vscode.Terminal): void {
    if (this.main?.terminal === terminal) this.main = undefined;
    this.side.delete(terminal);
  }

  sessionsHere(): Set<string> {
    return new Set([...(this.main ? [this.main.session] : []), ...this.side.values()]);
  }

  closeTerminals(session: string): void {
    if (this.main?.session === session) {
      this.main.terminal.dispose();
      this.main = undefined;
    }
    for (const [terminal, name] of this.side) {
      if (name === session) {
        terminal.dispose();
        this.side.delete(terminal);
      }
    }
  }

  sessionShown(row: SessionRow): void {
    this.onShown?.(row);
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
      item.contextValue = 'group';
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
  host.focusSession = (name) => void controller.show(name);
  // Follow the shown session in the explorer when its folder is in the workspace.
  const follow = (row: SessionRow) => {
    if (!vscode.workspace.getConfiguration('berth').get<boolean>('explorer.followSession', true)) return;
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const target = explorerTarget(row.cwd, folders);
    if (!target) return;
    void (async () => {
      await vscode.commands.executeCommand('workbench.files.action.collapseExplorerFolders');
      await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(target));
      // Revealing focuses the explorer; give focus back to the session terminal
      // (terminal.focus would create a panel shell when none is active).
      host.focusMain();
    })();
  };
  host.onShown = follow;

  const refresh = () => {
    void controller.mainSession().then((session) => {
      if (session) host.noteMainSession(session);
    });
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
  command('berth.focus', guarded((name) => controller.show(name)));
  command('berth.attach', guarded((name) => controller.show(name)));
  command('berth.openToSide', guarded((name) => controller.openToSide(name)));
  command('berth.nextAttention', async () => {
    const next = await controller.showNextAttention(host.mainSession());
    if (!next) void vscode.window.showInformationMessage('Berth: no session is waiting for you.');
    refresh();
  });
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
  const folders = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  // A project in the sessions view is a folder with sessions; a new session in a folder starts one.
  const pickFolder = async (): Promise<string | undefined> => {
    const known = [...new Set([...folders(), ...controller.tree().groups.map((g) => g.cwd)])];
    const items: (vscode.QuickPickItem & { path?: string })[] = known.map((p) => ({ label: p.split('/').pop() || p, description: p, path: p }));
    items.push({ label: '$(folder-opened) Choose Folder…' });
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Folder for the new session' });
    if (!pick) return undefined;
    if (pick.path) return pick.path;
    const chosen = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
    return chosen?.[0]?.fsPath;
  };
  const startSession = async (cwd: string | undefined) => {
    const agent = await pickAgent();
    if (!agent || !cwd) return;
    try {
      await controller.newSession(agent, cwd, vscode.workspace.getConfiguration('berth').get<string>('customLauncher', ''), folders());
    } catch (error) {
      void vscode.window.showErrorMessage(`Berth: ${(error as Error).message}`);
    }
    refresh();
  };
  command('berth.new', async () => startSession(await pickFolder()));
  command('berth.newInFolder', async (arg: unknown) => {
    const node = arg as { kind?: string; group?: { cwd: string } } | undefined;
    await startSession(node?.kind === 'group' ? node.group?.cwd : await pickFolder());
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
    await context.globalState.update(APPLIED_LAYOUT, LAYOUT_VERSION);
    const backup = Object.fromEntries(changes.map((c) => [c.key, config.inspect(c.key)?.globalValue ?? null]));
    await context.globalState.update(LAYOUT_BACKUP, backup);
    for (const c of changes) await config.update(c.key, c.value, vscode.ConfigurationTarget.Global);
    // Left to right: Berth sessions (secondary side bar), session terminals
    // (first editor group, locked), files (next group), explorer (primary side
    // bar); the panel stays at the bottom. Undo earlier layouts that moved the
    // Terminal view or the panel.
    await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['terminal'], destinationId: 'terminal' });
    await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    // Session terminals live in the editor area; the panel (Problems, Output,
    // plain shells) is closed and comes back with Cmd/Ctrl+J. It always spans the
    // whole editor area, so it cannot sit under the files group alone.
    await vscode.commands.executeCommand('workbench.action.closePanel');
    await vscode.commands.executeCommand(BERTH_CONTAINER);
  });
  command('berth.revertLayout', async () => {
    const backup = context.globalState.get<Record<string, unknown>>(LAYOUT_BACKUP);
    if (!backup) return;
    const config = vscode.workspace.getConfiguration();
    for (const [key, value] of Object.entries(backup)) await config.update(key, value ?? undefined, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['terminal'], destinationId: 'terminal' });
    await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    await context.globalState.update(LAYOUT_BACKUP, undefined);
    await context.globalState.update(APPLIED_LAYOUT, undefined);
  });

  context.subscriptions.push(
    view,
    vscode.window.onDidCloseTerminal((t) => host.forget(t)),
    { dispose: (() => { const timer = setInterval(refresh, REFRESH_MS); return () => clearInterval(timer); })() },
  );
  const appliedLayout = context.globalState.get<number>(APPLIED_LAYOUT);
  const hadOldLayout = context.globalState.get(LAYOUT_BACKUP) !== undefined && appliedLayout !== LAYOUT_VERSION;
  if (context.globalState.get<boolean>(WELCOMED) && hadOldLayout) {
    void vscode.window
      .showInformationMessage('Berth has an updated agent layout (sessions, terminal, files, explorer from left to right). Apply it?', 'Apply…', 'Not now')
      .then((choice) => {
        if (choice === 'Apply…') void vscode.commands.executeCommand('berth.applyLayout');
      });
  }
  // First run: show the sessions view and offer the layout once; settings still change only on confirmation.
  if (!context.globalState.get<boolean>(WELCOMED)) {
    void context.globalState.update(WELCOMED, true);
    void vscode.commands.executeCommand('workbench.view.extension.berth');
    void vscode.window
      .showInformationMessage('Berth is ready. Apply the agent layout (sessions, then terminals, then files, then the explorer)?', 'Apply…', 'Not now')
      .then((choice) => {
        if (choice === 'Apply…') void vscode.commands.executeCommand('berth.applyLayout');
      });
  }
  controller.startup().catch((error: Error) => {
    view.message = `Berth: ${error.message}`;
  });
  // Switching to one of Berth's terminals follows its session in the explorer.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      const session = terminal && host.sessionOf(terminal);
      const row = session ? controller.row(session) : undefined;
      if (row) follow(row);
    }),
  );
  refresh();
}

export function deactivate(): void {}
