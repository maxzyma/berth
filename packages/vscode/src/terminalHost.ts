/** The VS Code side of session terminals: opening, tracking and notifying (spec §6). */
import * as vscode from 'vscode';
import { connections, handoffTerminalClients, HostRegistration, workspaceIdentity, waitForAttachment, type Context, type SessionRow } from '@berthdev/berth';
import { handoffSources, persistentTerminalOptions, restoredTerminalSession, terminalProcessOwned, TERMINAL_OWNER_ENV } from './terminalOwnership.js';
import { deliverNotification, notificationChannel, notifySystem } from './notifications.js';
import { renameSession, resolveTerminalPids } from './inventory.js';
import type { Host, TerminalRole } from './controller.js';
import type { Transition } from './model.js';

export function currentWorkspaceIdentity() {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return workspaceIdentity(folders.map((folder) => folder.uri.toString()), vscode.workspace.workspaceFile?.toString(),
    folders.map((folder) => `${folder.name} (${folder.uri.fsPath})`).join(', '));
}

export class TerminalHost implements Host {
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
