import { createSessionFollower } from './sessionFollow.js';
import { EnvironmentSetup } from './environmentSetup.js';
import { executionHostSupported } from '@berthdev/berth';
import { showUnsupportedHost } from './unsupportedHost.js';
import { handoffSources, persistentTerminalOptions, restoredTerminalSession, terminalProcessOwned, TERMINAL_OWNER_ENV } from './terminalOwnership.js';
/** Berth for VS Code: glue between the editor API and the controller (spec §6). */
import { resolveHostIcons } from './hostIcons.js';
import { deliverNotification, notificationChannel, notifySystem } from './notifications.js';
import * as vscode from 'vscode';
import { hookInstallNotice, hookStatus, limitSynchronousLockWait, renameCommand, versionInspector, ADAPTERS, shellSplit, captureProfile, profileAtRoot, profileEnvironment, type AgentProfile, connections, handoffTerminalClients, HostRegistration, workspaceIdentity, createContext, waitForAttachment, type Context, type SessionRow } from '@berthdev/berth';
import { createSession, renameSession, resolveTerminalPids, sampleDoctor, sampleInventory, sampleSessions } from './inventory.js';
import { createLayoutQueue } from './layoutRuntime.js';
import { createLayoutIntroduction } from './layoutIntro.js';
import { usePreparedLayout, finishPreparedLayout } from './profileSetup.js';
import { randomUUID } from 'node:crypto';
import { recoveryCheckItems } from './recoveryCheck.js';
import { LayoutStore } from './layoutStore.js';
import { Controller, type Host, type TerminalRole } from './controller.js';
import { sessionChoices, defaultFolder, explorerTarget, launcherPicksAgent, moveGroup, orderAgents, placeOf, sessionNameProblem, shiftGroup, type Place, type Transition } from './model.js';
import type { MenuContext } from './view/protocol.js';
import { SessionsView, VIEW_ID } from './view/sessionsView.js';
import { installBundledHooks, prepareHookRuntime } from './hookRuntime.js';
import { TmuxHooks } from './tmuxHooks.js';
import { SETUP_DECLINED, SetupReminder } from './setupReminder.js';

const REFRESH_MS = 2000;
const GROUP_ORDER = 'berth.groupOrder';
const LAYOUT_BACKUP = 'berth.layoutBackup';
const LAYOUT_VALUES = 'berth.layoutAppliedValues';
const BERTH_CONTAINER = 'workbench.view.extension.berth';
const APPLIED_LAYOUT = 'berth.appliedLayoutVersion';

function currentWorkspaceIdentity() {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return workspaceIdentity(folders.map((folder) => folder.uri.toString()), vscode.workspace.workspaceFile?.toString(),
    folders.map((folder) => `${folder.name} (${folder.uri.fsPath})`).join(', '));
}

class TerminalHost implements Host {
  constructor(private readonly ctx: Context, private registration: HostRegistration, private readonly terminalOwner: string) {}
  ownerWorkspace(): string | undefined {
    this.syncWorkspace();
    return this.registration.workspace?.key;
  }
  dispose(): void { this.registration.dispose(); }
  private syncWorkspace(): void {
    const identity = currentWorkspaceIdentity();
    if (identity?.key === this.registration.workspace?.key) return;
    this.registration.dispose();
    this.registration = new HostRegistration(this.ctx.config.stateDir, vscode.env.appName, identity);
    this.registration.update([...this.pids]);
  }
  claimStartup(): boolean { return this.registration.claimStartup(); }
  /** Most recently selected terminal; older terminals retain their attachments. */
  private main?: { terminal: vscode.Terminal; session: string };
  /** Extra terminals opened beside it. */
  private readonly side = new Map<vscode.Terminal, string>();
  private pids = new Set<number>();
  private pidsReady = false;
  private terminalIds = new Map<vscode.Terminal, number>();
  private sessionsByPid = new Map<number, string>();
  private revivedOwners = new Map<vscode.Terminal, { pid: number; owned: boolean; checked: number }>();

  activeTerminalPid(): number | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!tab || !(tab.input instanceof vscode.TabInputTerminal)) return undefined;
    const terminal = vscode.window.activeTerminal;
    return terminal && terminal.exitStatus === undefined ? this.terminalIds.get(terminal) : undefined;
  }

  terminalPids(): ReadonlySet<number> { return this.pids; }
  terminalPidsReady(): boolean { return this.pidsReady; }

  async updateTerminalPids(): Promise<void> {
    this.syncWorkspace();
    const terminals = [...vscode.window.terminals];
    const { pids, ready } = await resolveTerminalPids(terminals.map(terminal => terminal.processId));
    this.pidsReady = ready && terminals.length === vscode.window.terminals.length && terminals.every(terminal => vscode.window.terminals.includes(terminal));
    this.pids = new Set(pids.filter((pid, i): pid is number => pid !== undefined && !terminals[i].exitStatus && vscode.window.terminals.includes(terminals[i])));
    this.terminalIds = new Map(terminals.flatMap((terminal, i) => this.pids.has(pids[i]!) ? [[terminal, pids[i]!] as const] : []));
    const clients = [...connections(this.ctx.tmux).entries()];
    const shownBy = (pid: number | undefined) => pid ? clients.find(([, values]) => values.some((client) => client.ancestors.includes(pid)))?.[0] : undefined;
    this.sessionsByPid = new Map([...this.pids].flatMap(pid => { const name = shownBy(pid); return name ? [[pid, name] as const] : []; }));
    const revivedOwners = new Map<vscode.Terminal, { pid: number; owned: boolean; checked: number }>();
    for (const terminal of terminals) {
      if (terminal.exitStatus !== undefined) continue;
      const options = terminal.creationOptions;
      const env = 'env' in options ? options.env : undefined;
      const pid = this.terminalIds.get(terminal);
      const evidence = await this.revivalEvidence(terminal, pid, env);
      if (evidence) revivedOwners.set(terminal, evidence);
      if (terminal.exitStatus !== undefined || !vscode.window.terminals.includes(terminal)) continue;
      const session = restoredTerminalSession(env, this.terminalOwner, pid, this.sessionsByPid, evidence?.owned);
      if (!session || terminal === this.main?.terminal) continue;
      if (!this.main && terminal === vscode.window.activeTerminal) this.main = { terminal, session };
      else this.side.set(terminal, session);
    }
    this.revivedOwners = revivedOwners;
    if (this.main) {
      const session = shownBy(pids[terminals.indexOf(this.main.terminal)]);
      this.main = { ...this.main, session: session ?? '' };
    }
    for (const terminal of this.side.keys()) {
      const session = shownBy(pids[terminals.indexOf(terminal)]);
      if (session) this.side.set(terminal, session);
      else this.side.delete(terminal);
    }
    this.registration.update([...this.pids]);
  }

  private async revivalEvidence(terminal: vscode.Terminal, pid: number | undefined,
    env: Readonly<Record<string, string | null | undefined>> | undefined) {
    if (env?.[TERMINAL_OWNER_ENV] !== undefined || pid === undefined || !this.sessionsByPid.has(pid)) return undefined;
    const cached = this.revivedOwners.get(terminal);
    if (cached?.pid === pid && (cached.owned || Date.now() - cached.checked < 5000)) return cached;
    return { pid, owned: await terminalProcessOwned(pid, this.terminalOwner), checked: Date.now() };
  }

  focusSession?: (name: string) => void;
  groupOrder?: () => readonly string[];
  onShown?: (row: SessionRow) => void;

  workspaceFolders(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  async openTerminal(session: string, argv: string[], role: TerminalRole, cwd?: string, options?: { newlyCreated: boolean }): Promise<void> {
    const sources = role === 'main' && session && !options?.newlyCreated ? await this.unownedClients(session) : [];
    const [shellPath, ...shellArgs] = argv;
    // No `name`: VS Code then follows the title the session sets (`${sequence}`).
    const terminal = vscode.window.createTerminal({
      shellPath,
      shellArgs,
      cwd,
      ...persistentTerminalOptions(this.terminalOwner),
      location: { viewColumn: role === 'main' ? vscode.ViewColumn.One : vscode.ViewColumn.Beside, preserveFocus: false },
    });
    try {
      if (session) {
        const pid = await new Promise<number | undefined>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Terminal startup timed out. Try opening it again.')), 5000);
          void terminal.processId.then((value) => { clearTimeout(timer); resolve(value); }, (error) => {
            clearTimeout(timer);
            reject(error);
          });
        });
        if (!pid) throw new Error(`Terminal did not start for ${session}. Try opening it again.`);
        await waitForAttachment(this.ctx.tmux, session, pid, { exited: () => terminal.exitStatus !== undefined });
      }
    } catch (error) {
      terminal.dispose();
      throw error;
    }
    if (role === 'main') {
      if (this.main) this.side.set(this.main.terminal, this.main.session);
      this.main = { terminal, session };
    } else {
      this.side.set(terminal, session);
    }
    if (session) {
      const attachedPid = await terminal.processId;
      if (attachedPid) {
        this.terminalIds = new Map([...this.terminalIds, [terminal, attachedPid]]);
        this.pids = new Set([...this.pids, attachedPid]);
        this.sessionsByPid = new Map([...this.sessionsByPid, [attachedPid, session]]);
        this.registration.update([...this.pids]);
      }
    }
    terminal.show();
    if (sources.length) {
      const pid = await terminal.processId;
      if (!pid) throw new Error('Editor terminal identity is unavailable; original connections were preserved.');
      handoffTerminalClients(this.ctx.tmux, session, pid, sources);
    }
    // The session terminal's group is locked so files open beside it.
    if (role === 'main') void vscode.commands.executeCommand('workbench.action.lockEditorGroup');
  }

  async mainTerminalPid(): Promise<number | undefined> {
    if (!this.main || this.main.terminal.exitStatus) return undefined;
    return (await resolveTerminalPids([this.main.terminal.processId])).pids[0];
  }

  async focusExisting(session: string): Promise<boolean> {
    await this.updateTerminalPids();
    // Reuse owned Editor views; unowned local clients are handed off after confirmation.
    const owned = new Set([...(this.main ? [this.main.terminal] : []), ...this.side.keys()]);
    const candidates = vscode.window.terminals.filter(terminal => {
      const pid = this.terminalIds.get(terminal);
      return owned.has(terminal) && !terminal.exitStatus && pid !== undefined && this.sessionsByPid.get(pid) === session;
    });
    const terminal = candidates.find(candidate => candidate === vscode.window.activeTerminal) ?? candidates[0];
    if (!terminal) return false;
    if (this.main && this.main.terminal !== terminal) this.side.set(this.main.terminal, this.main.session);
    this.side.delete(terminal);
    this.main = { terminal, session };
    terminal.show(false);
    const sources = await this.unownedClients(session, true);
    const pid = this.terminalIds.get(terminal);
    if (sources.length && pid) handoffTerminalClients(this.ctx.tmux, session, pid, sources);
    return true;
  }

  private async unownedClients(session: string, reusingOwned = false) {
    await this.updateTerminalPids();
    const owned = new Set([...(this.main ? [this.main.terminal] : []), ...this.side.keys()]);
    const unownedPids = new Set([...this.terminalIds].filter(([terminal]) => !owned.has(terminal)).map(([, pid]) => pid));
    return handoffSources(connections(this.ctx.tmux, [], true).get(session) ?? [],
      unownedPids, this.pidsReady, reusingOwned);
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
    const pid = this.terminalIds.get(terminal);
    this.terminalIds = new Map([...this.terminalIds].filter(([item]) => item !== terminal));
    this.pids = new Set([...this.pids].filter(value => value !== pid));
    this.sessionsByPid = new Map([...this.sessionsByPid].filter(([value]) => value !== pid));
    this.revivedOwners.delete(terminal);
  }

  sessionsHere(): Set<string> {
    // Native revival may omit creation metadata; live PID ancestry still proves presence.
    return new Set([...this.sessionsByPid.values(), ...(this.main ? [this.main.session] : []), ...this.side.values()].filter(Boolean));
  }

  renameSession(from: string, to: string): void {
    if (this.main?.session === from) this.main = { ...this.main, session: to };
    for (const [terminal, name] of this.side) {
      if (name === from) this.side.set(terminal, to);
    }
  }

  sessionShown(row: SessionRow): void {
    this.onShown?.(row);
  }

  notify(t: Transition): void {
    const text = t.state === 'waiting' ? `${t.name} is waiting for you` : `${t.name} finished`;
    const detail = t.note ? `: ${t.note}` : '';
    const activePid = this.activeTerminalPid();
    const current = activePid !== undefined && this.sessionsByPid.get(activePid) === t.name;
    const channel = notificationChannel(t.state, vscode.window.state.focused, current,
      vscode.workspace.getConfiguration('berth').get<boolean>('osNotifications', true), !!vscode.env.remoteName);
    const editorNotice = () => { void vscode.window.showInformationMessage(`${text}${detail}`, 'Open').then((choice) => {
      if (choice === 'Open') this.focusSession?.(t.name);
    }); };
    void deliverNotification(channel, editorNotice,
      () => notifySystem('Berth', `${text}${detail}`, vscode.env.appName))
      .catch(error => console.error('Berth: system notification failed; editor action remains available', error));
  }
}


/** A folder's place in the folder picker, by icon and colour (spec §6). */
const PLACE_ICONS: Record<Place, vscode.ThemeIcon> = {
  workspace: new vscode.ThemeIcon('root-folder', new vscode.ThemeColor('charts.blue')),
  inside: new vscode.ThemeIcon('file-directory'),
  outside: new vscode.ThemeIcon('folder-library', new vscode.ThemeColor('disabledForeground')),
};

/** A session named by a command argument: a name, or the context of a right-clicked card. */
function sessionArg(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  return (arg as MenuContext | undefined)?.session;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (!executionHostSupported()) {
    showUnsupportedHost(context);
    return;
  }
  void vscode.commands.executeCommand('setContext', 'berth.detailsVisible', false);
  // Editor-host operations never freeze the event loop for the background lock wait.
  limitSynchronousLockWait(5_000);
  try {
    prepareHookRuntime(context.asAbsolutePath('dist/cli.mjs'), context.globalStorageUri.fsPath);
  } catch (error) {
    console.error('Berth: could not update the persistent hook runtime', error);
  }
  const socket = vscode.workspace.getConfiguration('berth').get<string>('tmuxSocket', '');
  const ctx = createContext({ ...process.env, ...(socket ? { BERTH_TMUX_SOCKET: socket } : {}) });
  const registration = new HostRegistration(ctx.config.stateDir, vscode.env.appName, currentWorkspaceIdentity());
  registration.update([]);
  const terminalOwner = context.workspaceState.get<string>('berth.terminalOwner') || randomUUID();
  await context.workspaceState.update('berth.terminalOwner', terminalOwner);
  const host = new TerminalHost(ctx, registration, terminalOwner);
  context.subscriptions.push(host);
  const controller = new Controller(ctx, host, options => createSession(context.asAbsolutePath('dist/cli.mjs'), ctx.env, options),
    (from, to) => renameSession(context.asAbsolutePath('dist/cli.mjs'), ctx.env, from, to));
  const introduceLayout = createLayoutIntroduction({
    eligible: () => !!(vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) && !vscode.env.remoteName && context.globalState.get(APPLIED_LAYOUT) === undefined
      && !vscode.workspace.getConfiguration('berth').inspect<string>('layout.managedProfile')?.globalValue,
    seen: () => context.globalState.get<boolean>('berth.layoutIntroductionKept', false),
    remember: () => context.globalState.update('berth.layoutIntroductionKept', true),
    show: () => vscode.window.showInformationMessage(
      'Use Berth’s layout with sessions on the left and Explorer on the right? It uses a separate VS Code profile, including its settings and extensions.',
      'Use Berth Layout', 'Keep Current Layout'),
    create: () => vscode.commands.executeCommand('berth.applyLayout'),
  });
  const view = new SessionsView(context.extensionUri, (message) => {
    if (message.type === 'checkRecovery' && typeof message.session === 'string') void vscode.commands.executeCommand('berth.checkRecovery', { session: message.session });
    if (message.type === 'show') void controller.show(message.session).then(() => refresh()).catch((error: Error) => vscode.window.showErrorMessage(`Berth: ${error.message}`));
    if (message.type === 'ready' || message.type === 'retry') void refresh();
    if (message.type === 'new') void vscode.commands.executeCommand('berth.new');
    if (message.type === 'newIn') void startSession(message.cwd);
    if (message.type === 'detailsVisibility') void vscode.commands.executeCommand('setContext', 'berth.detailsVisible', message.visible);
    if (message.type === 'moveGroup') reorderGroups((shown, saved) => moveGroup(shown, saved, message.cwd, message.target, message.after));
    if (message.type === 'shiftGroup') reorderGroups((shown, saved) => shiftGroup(shown, saved, message.cwd, message.delta));
  }, vscode.Uri.joinPath(context.globalStorageUri, 'host-icons'));
  void resolveHostIcons(context.globalStorageUri.fsPath).then(icons => view.setHostIcons(icons));
  context.subscriptions.push(view, vscode.window.registerWebviewViewProvider(VIEW_ID, view));
  host.focusSession = (name) => void controller.show(name).catch((error: Error) => vscode.window.showErrorMessage(`Berth: ${error.message}`));
  // Follow the shown session in the explorer when its folder is in the workspace.
  const follower = createSessionFollower({
    current: () => vscode.window.activeTerminal,
    collapse: () => vscode.commands.executeCommand('workbench.files.action.collapseExplorerFolders'),
    reveal: target => vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(target)),
    focus: terminal => { if (terminal.exitStatus === undefined) terminal.show(); },
  });
  const follow = (row: SessionRow) => {
    if (!vscode.workspace.getConfiguration('berth').get<boolean>('explorer.followSession', true)) return;
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const target = explorerTarget(row.cwd, folders);
    if (!target) return;
    void follower.follow(target).catch(error => console.error('Berth: could not follow the session folder', error));
  };
  host.onShown = follow;

  const installHooks = async (agent: string, profile = captureProfile(agent, ctx.env)) => {
    const name = ADAPTERS.find((a) => a.id === agent)?.displayName ?? agent;
    const result = await installBundledHooks(context.asAbsolutePath('dist/cli.mjs'), context.globalStorageUri.fsPath, agent, profileEnvironment(agent, profile, ctx.env));
    if (result.ok) void vscode.window.showInformationMessage(hookInstallNotice(agent, result.detail));
    else void vscode.window.showErrorMessage(`Berth: could not install ${name} hooks: ${result.detail}`);
    refresh();
  };

  const checkedHookProfiles = new Set<string>();
  const upgradeHooks = (profile: AgentProfile) => {
    const env = profileEnvironment('codex', profile, ctx.env);
    const key = JSON.stringify(profile);
    if (checkedHookProfiles.has(key)) return;
    checkedHookProfiles.add(key);
    void installBundledHooks(context.asAbsolutePath('dist/cli.mjs'), context.globalStorageUri.fsPath, 'codex', env, 'upgrade').then(result => {
      if (!result.ok) { console.error(`Berth hook upgrade: ${result.detail}`); return; }
      try {
        if (JSON.parse(result.detail).changed) void vscode.window.showInformationMessage(
          'Berth added missing Codex activity hooks. Review the new definitions in Codex /hooks. State and summaries update after events arrive.');
      } catch (error) { console.error('Berth hook upgrade returned an invalid result', error); }
    });
  };
  upgradeHooks(captureProfile('codex', ctx.env));

  let environmentReady = false;
  let startupCompleted = false;
  let refreshTask: Promise<void> | undefined;
  let refreshAgain = false;
  let terminalRevision = 0;
  const renderLocal = () => view.update(controller.tree());
  // Folder group order is saved per workspace (spec §6).
  host.groupOrder = () => context.workspaceState.get<string[]>(GROUP_ORDER, []);
  const reorderGroups = (next: (shown: readonly string[], saved: readonly string[]) => string[]) => {
    const shown = controller.tree().groups.map((group) => group.cwd);
    void context.workspaceState.update(GROUP_ORDER, next(shown, host.groupOrder!())).then(renderLocal);
  };
  let sampleSequence = 0;
  let publishedSequence = 0;
  let knownTask: Promise<void> | undefined;
  let knownAgain = false;
  const refreshKnown = (): Promise<void> => {
    if (!environmentReady) return Promise.resolve();
    if (knownTask) { knownAgain = true; return knownTask; }
    knownTask = (async () => {
      do {
        knownAgain = false;
        const revision = terminalRevision;
        const sequence = ++sampleSequence;
        try {
          const rows = await sampleSessions(context.asAbsolutePath('dist/cli.mjs'), ctx.env, process.execPath, true);
          if (revision !== terminalRevision) { knownAgain = true; continue; }
          if (sequence < publishedSequence) continue;
          publishedSequence = sequence;
          view.update(controller.acceptKnownSessions(rows));
        } catch (error) {
          view.message = `Berth: ${(error as Error).message}`;
        }
      } while (knownAgain);
    })().finally(() => { knownTask = undefined; });
    return knownTask;
  };
  const refresh = (requestAgain = true): Promise<void> => {
    if (!environmentReady) return Promise.resolve();
    if (refreshTask) {
      if (requestAgain) refreshAgain = true;
      return refreshTask;
    }
    refreshTask = (async () => {
      do {
        refreshAgain = false;
        try {
          await host.updateTerminalPids();
          const attachment = await controller.mainAttachment();
          const session = attachment?.session;
          if (session && attachment) {
            host.noteMainSession(session);
            if (await controller.settleLaunch(session, attachment.terminalPid)) {
              const row = controller.row(session);
              if (row) follow(row);
            }
          }
          const revision = terminalRevision;
          const sequence = ++sampleSequence;
          const sample = await sampleInventory(context.asAbsolutePath('dist/cli.mjs'), ctx.env);
          if (revision !== terminalRevision) { refreshAgain = true; continue; }
          for (const row of sample.rows) if (row.agent === 'codex' && row.profile) upgradeHooks(row.profile);
          await host.updateTerminalPids();
          if (revision !== terminalRevision) { refreshAgain = true; continue; }
          if (sequence < publishedSequence) { refreshAgain = true; continue; }
          publishedSequence = sequence;
          const { tree: model } = controller.acceptInventory(sample.rows, sample.branches);
          view.update(model);
          view.message = undefined;
          view.title = model.groups.length === 1 && model.groups[0].place === 'workspace' ? [model.groups[0].label, model.groups[0].branch].filter(Boolean).join(' · ') : undefined;
          view.badge = model.waiting;
        } catch (error) {
          view.message = `Berth: ${(error as Error).message}`;
        }
      } while (refreshAgain);
    })().finally(() => { refreshTask = undefined; });
    return refreshTask;
  };
  const guarded = (fn: (name: string, arg: unknown) => unknown | Promise<unknown>) => async (arg: unknown) => {
    const name = sessionArg(arg);
    if (!name) return;
    try {
      await fn(name, arg);
    } catch (error) {
      void vscode.window.showErrorMessage(`Berth: ${(error as Error).message}`);
    }
    refresh();
  };

  const command = (id: string, fn: (...args: unknown[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  command('berth.moveFolderUp', (arg: unknown) => {
    const cwd = (arg as MenuContext | undefined)?.groupCwd;
    if (cwd) reorderGroups((shown, saved) => shiftGroup(shown, saved, cwd, -1));
  });
  command('berth.moveFolderDown', (arg: unknown) => {
    const cwd = (arg as MenuContext | undefined)?.groupCwd;
    if (cwd) reorderGroups((shown, saved) => shiftGroup(shown, saved, cwd, 1));
  });
  command('berth.resetFolderOrder', () => void context.workspaceState.update(GROUP_ORDER, undefined).then(renderLocal));
  command('berth.refresh', () => refresh());
  command('berth.dismissDetails', () => view.dismissDetails());
  command('berth.focus', guarded((name) => controller.show(name)));
  command('berth.openHere', guarded((name) => controller.show(name)));
  command('berth.openToSide', guarded((name) => controller.openToSide(name)));
  command('berth.checkRecovery', guarded(async (name) => {
    const cli = context.asAbsolutePath('dist/cli.mjs');
    const findings = await sampleDoctor(cli, ctx.env);
    const row = (await sampleSessions(cli, ctx.env)).find(row => row.name === name);
    if (!row) throw new Error('Session no longer exists. Refresh the list.');
    const picked = await vscode.window.showQuickPick(recoveryCheckItems(row, findings), {
      title: `Recovery readiness: ${name}`, matchOnDetail: true,
      placeHolder: 'Review the findings. Select a repair action where available.',
    });
    if (picked?.action === 'hooks' && row.profile) await installHooks(row.agent, row.profile);
    else if (picked?.action === 'inspect' && ctx.tmux.hasSession(name)) await controller.show(name);
    else if (picked?.action && ['profile', 'options', 'folder'].includes(picked.action)) {
      const commands = { profile: 'berth.recoveryProfile', options: 'berth.recoveryOptions', folder: 'berth.recoveryFolder' };
      await vscode.commands.executeCommand(commands[picked.action as keyof typeof commands], { session: name, resumeAfterRepair: false });
    }
  }));
  const sessionDiagnostics = async () => {
    try {
      const findings = await sampleDoctor(context.asAbsolutePath('dist/cli.mjs'), ctx.env);
      if (!findings.length) {
        void vscode.window.showInformationMessage('Berth: no configuration problems detected. Conversation recovery is confirmed separately by each agent.');
        return;
      }
      const chosen = await vscode.window.showQuickPick(findings.map((finding) => ({
        label: finding.session ?? 'Setup', detail: finding.problem, finding,
      })), { title: 'Berth: Diagnose Problems', matchOnDetail: true, placeHolder: 'Select a hook finding to install, or a live session to inspect' });
      if (chosen?.finding.installHooksFor) await installHooks(chosen.finding.installHooksFor, chosen.finding.profile);
      else if (chosen?.finding.session && ctx.tmux.hasSession(chosen.finding.session)) await controller.show(chosen.finding.session);
      await refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(`Berth: ${(error as Error).message}`);
    }
  };
  const tmuxHooks = new TmuxHooks(context, ctx.env);
  const reminder = new SetupReminder({
    declined: () => context.globalState.get<string[]>(SETUP_DECLINED, []),
    decline: keys => context.globalState.update(SETUP_DECLINED, [...new Set([...context.globalState.get<string[]>(SETUP_DECLINED, []), ...keys])]),
    notify: (text, ...actions) => vscode.window.showInformationMessage(text, ...actions),
    pick: async items => (await vscode.window.showQuickPick(items.map(item => ({ label: item.label, detail: item.detail, picked: true, item })),
      { title: 'Berth Setup', canPickMany: true, placeHolder: 'Install the selected hooks' }))?.map(choice => choice.item),
    failed: message => void vscode.window.showErrorMessage(`Berth: ${message}`),
    agentHooks: agent => hookStatus(agent, profileEnvironment(agent, captureProfile(agent, ctx.env), ctx.env)),
    installAgentHooks: agent => installHooks(agent),
    tmuxHooks: () => { const found = tmuxHooks.inspect(); return { ...found, key: TmuxHooks.key(found) }; },
    installTmuxHooks: async () => {
      await tmuxHooks.install();
      void vscode.window.showInformationMessage('Berth tmux hooks now run this extension\'s Berth.');
    },
  });
  const remind = (agents: string[]) => void reminder.offer(agents).catch((error: Error) => console.error('Berth setup reminder failed', error));
  const setup = new EnvironmentSetup(context, ctx.env, ready => {
    const alreadyReady = environmentReady && startupCompleted;
    environmentReady = ready;
    view.message = ready ? undefined : 'Environment setup is required. Open Diagnose Problems from the Berth menu.';
    if (!ready || alreadyReady) return;
    if (!startupCompleted) {
      startupCompleted = true;
      const started = host.updateTerminalPids().then(() => controller.startup()).then(() => refresh()).catch((error: Error) => {
        view.message = `Berth: ${error.message}`;
      });
      const repaired = tmuxHooks.maintain().catch((error: Error) => { void vscode.window.showErrorMessage(error.message); });
      const introduced = introduceLayout().catch((error: Error) => { void vscode.window.showErrorMessage(`Berth: ${error.message}`); });
      // After startup prompts, so only one Berth notification asks at a time.
      void Promise.all([started, repaired, introduced]).then(() => remind(controller.liveAgents()));
    } else {
      void introduceLayout().catch((error: Error) => vscode.window.showErrorMessage(`Berth: ${error.message}`));
    }
    void refresh();
  }, sessionDiagnostics, tmuxHooks);
  command('berth.checkSetup', () => setup.review());
  command('berth.findSession', async () => {
    try {
      const choices = sampleSessions(context.asAbsolutePath('dist/cli.mjs'), ctx.env).then(sessionChoices);
      const chosen = await vscode.window.showQuickPick(choices, {
        title: 'Find a Session', placeHolder: 'Search name, conversation or folder',
        matchOnDescription: true, matchOnDetail: true,
      });
      if (chosen) await controller.show(chosen.session);
      await refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(`Berth: ${(error as Error).message}`);
    }
  });
  command('berth.nextAttention', async () => {
    try {
      const next = await controller.showNextAttention(host.mainSession());
      if (!next) void vscode.window.showInformationMessage('Berth: no session is waiting for you.');
      await refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(`Berth: ${(error as Error).message}`);
    }
  });
  command('berth.detach', guarded((name) => controller.detach(name)));
  command('berth.rename', guarded(async (name) => {
    const to = await vscode.window.showInputBox({ prompt: `Rename ${name}`, value: name, validateInput: sessionNameProblem });
    if (!to || to === name) return;
    await controller.rename(name, to);
    // Command naming (spec §4.2.1): only for agents without a terminal-free path, typed after the user confirms.
    const row = controller.row(to);
    const adapter = row?.live ? ADAPTERS.find(a => a.id === row.agent) : undefined;
    const line = adapter && renameCommand(adapter.id, versionInspector(ctx.env)(adapter, row?.cwd).version, to);
    if (!adapter || !line) return;
    const send = await vscode.window.showInformationMessage(
      `${adapter.displayName} in ${to} keeps its old session name. Type "${line}" into it now? Text already typed there would be combined with it.`,
      'Type Command');
    if (send) controller.sendAgentLine(to, adapter.id, line);
  }));
  command('berth.recoveryFolder', guarded(async (name, arg) => {
    const chosen = await vscode.window.showOpenDialog({ title: `Choose recovery folder for ${name}`, canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Use Folder' });
    if (!chosen?.[0]) return;
    controller.relocateRecovery(name, chosen[0].fsPath);
    if ((arg as { resumeAfterRepair?: boolean } | undefined)?.resumeAfterRepair !== false) await controller.show(name);
  }));
  command('berth.recoveryOptions', guarded(async (name, arg) => {
    const options = await vscode.window.showInputBox({
      title: `Review recovery options for ${name}`,
      prompt: 'Enter supported agent options with shell quoting. Leave empty to use agent defaults.',
      placeHolder: '--model <model> — quote values containing spaces',
      validateInput: (value) => { try { shellSplit(value); return undefined; } catch (error) { return (error as Error).message; } },
    });
    if (options === undefined) return;
    controller.setRecoveryOptions(name, shellSplit(options));
    if ((arg as { resumeAfterRepair?: boolean } | undefined)?.resumeAfterRepair !== false) await controller.show(name);
  }));
  command('berth.recoveryProfile', guarded(async (name, arg) => {
    const chosen = await vscode.window.showOpenDialog({ title: `Choose agent profile for ${name}`, canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Use Agent Profile' });
    if (!chosen?.[0]) return;
    controller.setRecoveryProfile(name, chosen[0].fsPath);
    if ((arg as { resumeAfterRepair?: boolean } | undefined)?.resumeAfterRepair !== false) await controller.show(name);
  }));
  command('berth.retryRecovery', guarded(async (name) => {
    const choice = await vscode.window.showWarningMessage(`Retry recovery for ${name}? This ends the current attempt and resumes its saved conversation ID.`, { modal: true }, 'Retry Recovery');
    if (choice === 'Retry Recovery') await controller.retryRecovery(name);
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
    const row = name ? controller.row(name) : undefined;
    const agent = row?.agent ?? await pickAgent();
    if (!agent) return;
    let profile = row?.profile;
    if (row && !profile) {
      const chosen = await vscode.window.showOpenDialog({ title: `Choose ${agent} profile for hook installation`, canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Install Hooks Here' });
      if (!chosen?.[0]) return;
      try { profile = profileAtRoot(agent, ctx.env, chosen[0].fsPath); }
      catch (error) { void vscode.window.showErrorMessage((error as Error).message); return; }
    }
    await installHooks(agent, profile);
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
  const chooseSession = async (cwd: string | undefined) => {
    if (!cwd) return undefined;
    const custom = launcher();
    const agent = launcherPicksAgent(custom) ? undefined : await pickAgent(true);
    if (agent === undefined && !launcherPicksAgent(custom)) return undefined;
    return { agent, cwd, custom, workspaceFolders: folders() };
  };
  const startSession = async (cwd: string | undefined) => {
    const chosen = await chooseSession(cwd);
    if (!chosen) return;
    try {
      if (!await setup.ensure({ agent: chosen.agent, cwd: chosen.cwd, launcher: chosen.custom })) return;
      await controller.newSession(chosen.agent, chosen.cwd, chosen.custom, chosen.workspaceFolders);
      if (chosen.agent && chosen.agent !== 'shell') remind([chosen.agent]);
      terminalRevision++;
      renderLocal();
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
    await startSession((arg as MenuContext | undefined)?.groupCwd ?? (await pickFolder()));
  });
  const layoutStore = new LayoutStore(vscode.Uri.joinPath(context.globalStorageUri, 'layout.json').fsPath, () => ({
    schema: 1,
    backup: context.globalState.get(LAYOUT_BACKUP) ?? {},
    applied: context.globalState.get(LAYOUT_VALUES) ?? {},
    version: context.globalState.get(APPLIED_LAYOUT),
  }));
  const runLayout = createLayoutQueue();
  command('berth.applyLayout', () => runLayout(() => usePreparedLayout(context)));
  command('berth.revertLayout', () => vscode.commands.executeCommand('workbench.profiles.actions.switchProfile'));
  command('berth.inspectLegacyLayout', async () => {
    // Preserve recovery evidence. Earlier journals cannot identify profile targets safely.
    const state = layoutStore.read();
    const document = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(state, null, 2) });
    await vscode.window.showTextDocument(document, { preview: true });
  });

  context.subscriptions.push(
    view,
    vscode.window.onDidOpenTerminal(() => { terminalRevision++; renderLocal(); void refreshKnown(); void refresh(); }),
    vscode.window.onDidCloseTerminal((t) => { terminalRevision++; host.forget(t); renderLocal(); void refreshKnown(); void refresh(); }),
    { dispose: (() => { const timer = setInterval(() => void refresh(false), REFRESH_MS); return () => clearInterval(timer); })() },
  );
  let finishingLayout: Promise<void> | undefined;
  const finishLayout = () => {
    if (finishingLayout) return;
    finishingLayout = finishPreparedLayout(context).catch((error: Error) => {
      void vscode.window.showErrorMessage(`Berth: ${error.message}`);
    }).finally(() => { finishingLayout = undefined; });
  };
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('berth.layout.managedProfile')) finishLayout();
  }));
  finishLayout();
  void setup.startup();
  // Switching to one of Berth's terminals follows its session in the explorer.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      follower.cancel();
      renderLocal();
      const session = terminal && host.sessionOf(terminal);
      const row = session ? controller.row(session) : undefined;
      if (row) follow(row);
      void refresh();
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => { follower.cancel(); renderLocal(); void refresh(); }),
    vscode.window.tabGroups.onDidChangeTabGroups(() => { follower.cancel(); renderLocal(); void refresh(); }),
  );
  refresh();
}

export function deactivate(): void {}
