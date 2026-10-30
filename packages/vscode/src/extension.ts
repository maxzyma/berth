/** Berth for VS Code: glue between the editor API and the controller (spec §6). */
import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import * as vscode from 'vscode';
import { ADAPTERS, createContext, type SessionRow } from '@berthdev/berth';
import { Controller, type Host, type TerminalRole } from './controller.js';
import { defaultFolder, escapeMarkdown, explorerTarget, type Attention, type TreeView, launcherPicksAgent, layoutBackup, layoutChanges, orderAgents, placeOf, type Place, type GroupView, type RowView, type Transition } from './model.js';

const REFRESH_MS = 2000;
const LAYOUT_BACKUP = 'berth.layoutBackup';
const WELCOMED = 'berth.welcomed';
const BERTH_CONTAINER = 'workbench.view.extension.berth';
/** Bump when Apply Agent Layout changes what it does, so users who applied an older one are offered the new one. */
const LAYOUT_VERSION = 7;
const APPLIED_LAYOUT = 'berth.appliedLayoutVersion';

type Node = { kind: 'group'; group: GroupView } | { kind: 'unmanaged'; rows: RowView[] } | { kind: 'row'; row: RowView };

/** Agents with their own icon in media/agents; a shell uses the terminal icon. */
const AGENT_ICONS = new Set(['claude', 'codex', 'gemini', 'opencode', 'copilot', 'cursor', 'kimi', 'qoder']);

/**
 * Colour goes only to what needs the user, as in cmux: waiting is amber,
 * unread blue; stopped rows are grey and everything else keeps the default.
 */
const ATTENTION_COLORS: Record<Exclude<Attention, ''>, string> = {
  waiting: 'list.warningForeground',
  unread: 'charts.blue',
};
const ATTENTION_BADGE: Record<Exclude<Attention, ''>, string> = { waiting: '!', unread: '•' };

const ROW_SCHEME = 'berth-session';
const GROUP_SCHEME = 'berth-group';
const rowUri = (name: string) => vscode.Uri.from({ scheme: ROW_SCHEME, path: `/${encodeURIComponent(name)}` });
const groupUri = (cwd: string) => vscode.Uri.from({ scheme: GROUP_SCHEME, path: `/${encodeURIComponent(cwd)}` });

interface Mark { badge: string; color: string }

function rowMark(row: RowView): Mark {
  const color = row.attention ? ATTENTION_COLORS[row.attention] : row.icon === 'stopped' ? 'disabledForeground' : '';
  return { badge: row.badge, color };
}

/** A collapsed group shows its most urgent session; an expanded one shows nothing. */
function groupMark(group: GroupView, collapsed: boolean): Mark {
  if (!collapsed || !group.attention) return { badge: '', color: '' };
  return { badge: ATTENTION_BADGE[group.attention], color: ATTENTION_COLORS[group.attention] };
}

/** Colour and badge for rows, which carry berth-session: and berth-group: URIs. */
class RowDecorations implements vscode.FileDecorationProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private marks = new Map<string, Mark>();

  /**
   * Announce only the URIs whose decoration changed: an announcement with no
   * URIs makes every view re-ask every provider for every file, which
   * redraws the explorer and source control on each refresh.
   */
  update(entries: [vscode.Uri, Mark][]): void {
    const next = new Map(entries.map(([uri, mark]) => [uri.toString(), mark]));
    const key = (m?: Mark) => (m ? `${m.badge}|${m.color}` : '');
    const changed = [...new Set([...this.marks.keys(), ...next.keys()])].filter((k) => key(this.marks.get(k)) !== key(next.get(k)));
    this.marks = next;
    if (changed.length) this.changed.fire(changed.map((k) => vscode.Uri.parse(k)));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== ROW_SCHEME && uri.scheme !== GROUP_SCHEME) return undefined;
    const mark = this.marks.get(uri.toString());
    if (!mark || (!mark.badge && !mark.color)) return undefined;
    return new vscode.FileDecoration(mark.badge || undefined, undefined, mark.color ? new vscode.ThemeColor(mark.color) : undefined);
  }
}

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
  suggestHooks?: (agent: string) => void;

  extensionUri?: vscode.Uri;

  agentImage(agent: string): string {
    if (!this.extensionUri || !AGENT_ICONS.has(agent)) return '';
    return `![](${vscode.Uri.joinPath(this.extensionUri, 'media', 'agents', `${agent}.svg`).toString()}|width=14,height=14) `;
  }

  workspaceFolders(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

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
  private shown = '';

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * With one folder its sessions sit at the top level and the folder names the
   * view; a tree level costs width in a narrow side bar (spec §6).
   */
  update(groups: GroupView[], unmanaged: RowView[]): string | undefined {
    // Only the workspace folder may lose its row: its place is then implied.
    const single = groups.length === 1 && groups[0].place === 'workspace' ? groups[0] : undefined;
    this.roots = [
      ...(single ? single.rows.map((row): Node => ({ kind: 'row', row })) : groups.map((group): Node => ({ kind: 'group', group }))),
      ...(unmanaged.length ? [{ kind: 'unmanaged', rows: unmanaged } as Node] : []),
    ];
    // Redraw only when something shown changed; the view refreshes every few seconds.
    const shown = JSON.stringify(this.roots);
    if (shown !== this.shown) {
      this.shown = shown;
      this.changed.fire(undefined);
    }
    return single?.label;
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
      // The folder's name is enough on the row; where it is goes in the tooltip.
      item.resourceUri = groupUri(node.group.cwd);
      item.iconPath = PLACE_ICONS[node.group.place];
      item.tooltip = markdown(`**${escapeMarkdown(node.group.label)}**\n\n$(folder) \`${node.group.cwd.replace(/`/g, "'")}\`\n\n$(${PLACE_CODICON[node.group.place]}) ${PLACE_TEXT[node.group.place]}`);
      item.contextValue = 'group';
      return item;
    }
    if (node.kind === 'unmanaged') return new vscode.TreeItem('Other tmux sessions', vscode.TreeItemCollapsibleState.Collapsed);
    const item = new vscode.TreeItem(node.row.label, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = rowUri(node.row.name);
    item.description = node.row.description;
    item.tooltip = markdown(node.row.tooltip);
    item.contextValue = node.row.contextValue;
    item.iconPath = AGENT_ICONS.has(node.row.agent)
      ? vscode.Uri.joinPath(this.extensionUri, 'media', 'agents', `${node.row.agent}.svg`)
      : new vscode.ThemeIcon(node.row.agent === 'shell' ? 'terminal' : 'circle-outline');
    item.command = { command: 'berth.focus', title: 'Open Session', arguments: [node.row.name] };
    return item;
  }
}

/** Agents the user asked never to be offered hooks for. */
const HOOKS_DECLINED = 'berth.hooksDeclined';

/**
 * Install hooks with the user's `berth` CLI: hook commands record the CLI's
 * path, and the extension's own copy moves with every extension update.
 * VS Code's environment comes from the user's shell; a version manager that
 * only an interactive shell loads (nvm) needs `-i`.
 */
function installHooksWithCli(agent: string): { ok: boolean; detail: string } {
  const args = ['hooks', 'install', agent];
  let r = spawnSync('berth', args, { encoding: 'utf8', timeout: 30_000 });
  if (r.error) {
    const shell = process.env.SHELL || '/bin/sh';
    r = spawnSync(shell, ['-ilc', `berth ${args.join(' ')}`], { encoding: 'utf8', timeout: 30_000 });
  }
  if (r.status === 0) return { ok: true, detail: r.stdout.trim().split('\n').pop() ?? '' };
  const missing = r.status === 127 || /not found/.test(r.stderr ?? '');
  return {
    ok: false,
    detail: missing
      ? `the berth command is not on PATH. Install it (npm install -g @berthdev/berth), then run: berth hooks install ${agent}`
      : (r.stderr || r.error?.message || 'unknown error').trim(),
  };
}

/** A folder's place is shown by icon and colour; the words are in the tooltip (spec §6). */
const PLACE_ICONS: Record<Place, vscode.ThemeIcon> = {
  workspace: new vscode.ThemeIcon('root-folder', new vscode.ThemeColor('charts.blue')),
  inside: new vscode.ThemeIcon('folder'),
  outside: new vscode.ThemeIcon('folder', new vscode.ThemeColor('disabledForeground')),
};
const PLACE_CODICON: Record<Place, string> = { workspace: 'root-folder', inside: 'folder', outside: 'folder-library' };
const PLACE_TEXT: Record<Place, string> = {
  workspace: "This window's workspace folder",
  inside: "Inside this window's workspace",
  outside: "Outside this window's workspace",
};

/** Tooltips are Markdown with codicons; their user text is escaped by the model. */
function markdown(text: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(text, true);
  md.isTrusted = false;
  return md;
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
  host.extensionUri = context.extensionUri;
  const controller = new Controller(ctx, host);
  const tree = new SessionTree(context.extensionUri);
  const decorations = new RowDecorations();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorations));
  const view = vscode.window.createTreeView('berth.sessions', { treeDataProvider: tree });
  host.focusSession = (name) => void controller.show(name);
  // Folders the user collapsed: their rows then show the most urgent session.
  const collapsed = new Set<string>();
  let lastModel: TreeView | undefined;
  const decorate = () => {
    if (!lastModel) return;
    decorations.update([
      ...[...lastModel.groups.flatMap((g) => g.rows), ...lastModel.unmanaged].map((r): [vscode.Uri, Mark] => [rowUri(r.name), rowMark(r)]),
      ...lastModel.groups.map((g): [vscode.Uri, Mark] => [groupUri(g.cwd), groupMark(g, collapsed.has(g.cwd))]),
    ]);
  };
  const onFold = (fold: boolean) => (e: vscode.TreeViewExpansionEvent<Node>) => {
    if (e.element.kind !== 'group') return;
    if (fold) collapsed.add(e.element.group.cwd);
    else collapsed.delete(e.element.group.cwd);
    decorate();
  };
  context.subscriptions.push(view.onDidCollapseElement(onFold(true)), view.onDidExpandElement(onFold(false)));
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

  const installHooks = async (agent: string) => {
    const name = ADAPTERS.find((a) => a.id === agent)?.displayName ?? agent;
    const result = installHooksWithCli(agent);
    if (result.ok) void vscode.window.showInformationMessage(`Berth: ${name} hooks installed (${result.detail}). New ${name} sessions resume their conversation after a restart.`);
    else void vscode.window.showErrorMessage(`Berth: could not install ${name} hooks: ${result.detail}`);
    refresh();
  };
  host.suggestHooks = (agent) => {
    if ((context.globalState.get<string[]>(HOOKS_DECLINED) ?? []).includes(agent)) return;
    const name = ADAPTERS.find((a) => a.id === agent)?.displayName ?? agent;
    void vscode.window
      .showInformationMessage(
        `Berth: ${name} sessions start a new conversation after a restart, because ${name}'s Berth hooks are not installed. Install them? This adds Berth's entries to ${name}'s own hook configuration.`,
        'Install',
        'Not now',
        "Don't ask again",
      )
      .then((choice) => {
        if (choice === 'Install') void installHooks(agent);
        if (choice === "Don't ask again") {
          void context.globalState.update(HOOKS_DECLINED, [...(context.globalState.get<string[]>(HOOKS_DECLINED) ?? []), agent]);
        }
      });
  };

  const refresh = () => {
    controller
      .mainSession()
      .then((session) => {
        if (!session) return;
        host.noteMainSession(session);
        if (controller.settleLaunch(session)) {
          const row = controller.row(session);
          if (row) follow(row);
        }
      })
      .catch(() => undefined); // tmux gone or a snapshot unreadable: the next refresh tries again
    try {
      const { tree: model } = controller.refresh();
      view.description = tree.update(model.groups, model.unmanaged);
      lastModel = model;
      decorate();
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
  const launcher = () => vscode.workspace.getConfiguration('berth').get<string>('customLauncher', '');
  const pickAgent = async (forNewSession = false) => {
    const custom = forNewSession ? launcher() : '';
    const via = custom ? ` · ${custom.trim().split(/\s+/)[0].split('/').pop()}` : '';
    return (await vscode.window.showQuickPick(
      orderAgents(ADAPTERS, vscode.workspace.getConfiguration('berth').get<string[]>('newSession.order', [])).map((a) => ({
        label: a.displayName,
        description: a.id === 'shell' ? a.id : `${a.id}${via}`,
        id: a.id,
      })),
      { placeHolder: custom ? 'Agent — agents start with your launcher, a shell with Berth' : 'Agent' },
    ))?.id;
  };
  command('berth.markRead', guarded((name) => controller.markRead(name)));
  command('berth.forget', guarded(async (name) => {
    const ok = await vscode.window.showWarningMessage(`Forget ${name}? It will not be restored.`, { modal: true }, 'Forget');
    if (ok === 'Forget') controller.forget(name);
  }));
  command('berth.installHooks', async (arg: unknown) => {
    const name = sessionArg(arg);
    const agent = name ? controller.row(name)?.agent : await pickAgent();
    if (agent) await installHooks(agent);
  });
  command('berth.adopt', guarded(async (name) => {
    const agent = await pickAgent();
    if (agent) controller.adopt(name, agent);
  }));
  const folders = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  // A project in the sessions view is a folder with sessions; a new session in a folder starts one.
  const pickFolder = async (): Promise<string | undefined> => {
    const known = [...new Set([...folders(), ...controller.tree().groups.map((g) => g.cwd)])];
    const rank: Record<Place, number> = { workspace: 0, inside: 1, outside: 2 };
    const items: (vscode.QuickPickItem & { path?: string })[] = known
      .map((p) => ({ p, place: placeOf(p, folders()) }))
      .sort((a, b) => rank[a.place] - rank[b.place] || a.p.localeCompare(b.p))
      .map(({ p, place }) => ({ label: p.split('/').pop() || p, description: p, path: p, iconPath: PLACE_ICONS[place] }));
    items.push({ label: '$(folder-opened) Choose Folder…' });
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Folder for the new session' });
    if (!pick) return undefined;
    if (pick.path) return pick.path;
    const chosen = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
    return chosen?.[0]?.fsPath;
  };
  const startSession = async (cwd: string | undefined) => {
    if (!cwd) return;
    // A launcher without {agent} asks for the agent in the terminal itself.
    const agent = launcherPicksAgent(launcher()) ? undefined : await pickAgent(true);
    if (agent === undefined && !launcherPicksAgent(launcher())) return;
    try {
      await controller.newSession(agent, cwd, launcher(), folders());
    } catch (error) {
      void vscode.window.showErrorMessage(`Berth: ${(error as Error).message}`);
    }
    refresh();
  };
  const shownCwd = () => {
    const shown = host.mainSession();
    return shown ? controller.row(shown)?.cwd : undefined;
  };
  command('berth.new', async () => startSession(defaultFolder(shownCwd(), folders()) ?? (await pickFolder())));
  command('berth.newChooseFolder', async () => startSession(await pickFolder()));
  command('berth.newInFolder', async (arg: unknown) => {
    const node = arg as { kind?: string; group?: { cwd: string } } | undefined;
    await startSession(node?.kind === 'group' ? node.group?.cwd : await pickFolder());
  });
  // `{ confirm: false }` skips the dialog; used by integration tests.
  command('berth.applyLayout', async (options?: unknown) => {
    const config = vscode.workspace.getConfiguration();
    const hide = vscode.workspace.getConfiguration('berth').get<boolean>('layout.hideTerminalTabs', false);
    // Object settings read through get() include every default entry; build on
    // the user's own value so only what Berth adds is written.
    const current = (key: string) => (key === 'workbench.editor.autoLockGroups' ? config.inspect(key)?.globalValue : config.get(key));
    const changes = layoutChanges(current, hide);
    const ask = (options as { confirm?: boolean } | undefined)?.confirm !== false;
    const ok = ask
      ? await vscode.window.showInformationMessage(
          `Apply the agent layout? It changes ${changes.length} user settings; Revert Agent Layout restores them.`,
          { modal: true },
          'Apply',
        )
      : 'Apply';
    if (ok !== 'Apply') return;
    await context.globalState.update(APPLIED_LAYOUT, LAYOUT_VERSION);
    const now = Object.fromEntries(changes.map((c) => [c.key, config.inspect(c.key)?.globalValue ?? null]));
    await context.globalState.update(LAYOUT_BACKUP, layoutBackup(context.globalState.get(LAYOUT_BACKUP), now));
    for (const c of changes) await config.update(c.key, c.value, vscode.ConfigurationTarget.Global);
    // Left to right: Berth sessions (secondary side bar), session terminals
    // (first editor group, locked), files (next group), explorer (primary side
    // bar); the panel stays at the bottom.
    await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    // Session terminals live in the editor area; the panel (Problems, Output,
    // plain shells) is closed and comes back with Cmd/Ctrl+J. It always spans the
    // whole editor area, so it cannot sit under the files group alone.
    await vscode.commands.executeCommand('workbench.action.closePanel');
    await vscode.commands.executeCommand(BERTH_CONTAINER);
  });
  command('berth.revertLayout', async () => {
    const backup = context.globalState.get<Record<string, unknown>>(LAYOUT_BACKUP);
    if (!backup) {
      void vscode.window.showInformationMessage('Berth: nothing to revert; the agent layout has not changed your settings.');
      return;
    }
    const config = vscode.workspace.getConfiguration();
    for (const [key, value] of Object.entries(backup)) await config.update(key, value ?? undefined, vscode.ConfigurationTarget.Global);
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
