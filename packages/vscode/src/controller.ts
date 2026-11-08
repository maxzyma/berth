/** Session actions for Berth for VS Code; talks to the editor only through `Host`. */
import { spawnSync } from 'node:child_process';
import {
  adopt,
  adoptDiscovered,
  detectAgent,
  forget,
  clearBell,
  create,
  ensure,
  list,
  presentCurrentState,
  stamp,
  rename,
  StateBusyError,
  end,
  detachTerminalClients,
  inventory,
  retryRecovery,
  relocateRecovery,
  setRecoveryProfile,
  setRecoveryOptions,
  type AgentProfile,
  type Context,
  type SessionRow,
} from '@berthdev/berth';
import { basename } from 'node:path';
import { compareSessionNames, buildTree, nextAttention, relativeToWorkspace, renderLauncher, transitions, type Transition, type TreeView } from './model.js';

export type TerminalRole = 'main' | 'side';

export interface SessionLaunch {
  session: string;
  argv: string[];
  cwd: string;
  agent: string;
  startedAt: number;
  custom: boolean;
}


export interface Host {
  /**
   * Open a terminal running `argv` (an attach command). `main` is the one
   * most recently selected session terminal; `side` terminals are extra
   * views opened on request. Terminals are unnamed, so tab titles follow tmux.
   */
  openTerminal(session: string, argv: string[], role: TerminalRole, cwd?: string, options?: { newlyCreated: boolean }): void | Promise<void>;
  /** Process id of the main session terminal, when one is open. */
  mainTerminalPid(): Promise<number | undefined>;
  /** Focus a live Editor attachment and hand off unowned local clients. */
  focusExisting(session: string): Promise<boolean>;
  /** Sessions shown by a terminal in this window. */
  sessionsHere(): Set<string>;
  terminalPids?(): ReadonlySet<number>;
  terminalPidsReady?(): boolean;
  activeTerminalPid?(): number | undefined;
  renameSession?(from: string, to: string): void;
  notify(transition: Transition): void;
  /** Called after a session is brought forward, e.g. to follow it in the explorer. */
  sessionShown?(row: SessionRow): void;
  /** This window's workspace folders. */
  workspaceFolders?(): string[];
  ownerWorkspace?(): string | undefined;
  claimStartup?(): boolean;
  /** An agent in use has no Berth hooks: offer to install them (spec §6). */
}

/** How long after starting a custom launcher its session is expected. */
const LAUNCH_WINDOW_MS = 120_000;
const LOCK_WAIT_MS = 3_000;
/** Startup restore retries a busy state for about half a minute before reporting it. */
const STARTUP_ATTEMPTS = 5;

/** Parent pid of `pid`, or undefined at the top. */
function parentOf(pid: number): number | undefined {
  const r = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 16384 });
  const parent = Number(r.stdout.trim());
  return r.status === 0 && parent > 1 ? parent : undefined;
}

/** Whether `pid` is `ancestor` or runs under it (a launcher may not exec tmux). */
function descendsFrom(pid: number, ancestor: number): boolean {
  for (let p: number | undefined = pid, depth = 0; p && depth < 12; p = parentOf(p), depth++) {
    if (p === ancestor) return true;
  }
  return false;
}

export class Controller {
  private rows: SessionRow[] = [];
  private mainAction: Promise<unknown> = Promise.resolve();
  private orderMain<T>(action: () => Promise<T> | T): Promise<T> {
    const result = this.mainAction.then(action, action);
    this.mainAction = result.catch(() => undefined);
    return result;
  }
  /** Agent chosen for a custom launcher whose session is not known yet, and when it started. */
  /** `agent` is '' when the launcher picks the agent itself. */
  private pendingLaunch?: { agent: string; startedAt: number; terminalPid: number };
  readonly unread = new Set<string>();
  /** Agents already offered hooks in this window. */
  private branches = new Map<string, string>();

  constructor(
    private readonly ctx: Context,
    private readonly host: Host,
    private readonly createSession: (options: Parameters<typeof create>[1]) => Promise<string> = async options => create(ctx, options),
    private readonly renameSession: (from: string, to: string) => Promise<void> = async (from, to) => rename(ctx, from, to),
  ) {}

  refresh(): { tree: TreeView; transitions: Transition[] } {
    return this.acceptInventory(inventory(this.ctx));
  }

  acceptInventory(next: SessionRow[], branches?: ReadonlyMap<string, string>): { tree: TreeView; transitions: Transition[] } {
    if (branches) this.branches = new Map(branches);
    const changed = transitions(this.rows, next);
    this.rows = next;
    for (const t of changed) {
      this.unread.add(t.name);
      this.host.notify(t);
    }
    return { tree: this.tree(), transitions: changed };
  }

  /** Membership is authoritative; sampled activity waits for full inspection. */
  acceptKnownSessions(next: SessionRow[]): TreeView {
    const previous = new Map(this.rows.map(row => [row.name, row]));
    this.rows = next.map(row => {
      const prior = previous.get(row.name);
      if (!row.live || !prior?.live || row.agent !== prior.agent || row.conversation !== prior.conversation) return row;
      return { ...row, state: prior.state, note: prior.note, topic: prior.topic, activityTiming: prior.activityTiming };
    });
    // Full asynchronous inventory supplies branches; never probe Git on this path.
    for (const row of next) if (!this.branches.has(row.cwd)) this.branches.set(row.cwd, '');
    return this.tree();
  }

  tree(): TreeView {
    return buildTree(this.rows, {
      here: this.host.sessionsHere(),
      terminalPids: this.host.terminalPids?.(),
      terminalPidsReady: this.host.terminalPidsReady?.(),
      activeTerminalPid: this.host.activeTerminalPid?.(),
      unread: this.unread,
      branch: (cwd) => this.branch(cwd),
      workspaceFolders: this.host.workspaceFolders?.() ?? [],
      home: process.env.HOME ?? '',
    });
  }

  row(name: string): SessionRow | undefined {
    return this.rows.find((r) => r.name === name) ?? list(this.ctx).find((r) => r.name === name);
  }

  private branch(cwd: string): string {
    if (!this.branches.has(cwd)) {
      const r = spawnSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL' });
      this.branches.set(cwd, r.status === 0 ? r.stdout.trim() : '');
    }
    return this.branches.get(cwd) ?? '';
  }

  /**
   * Startup (spec §6): rebuild missing vscode sessions, then show the first
   * one not attached anywhere in the main terminal. Others stay listed.
   */
  async startup(): Promise<string | undefined> {
    if (this.host.terminalPidsReady?.() === false) return undefined;
    const ownerWorkspace = this.host.ownerWorkspace?.();
    if (!ownerWorkspace || !this.host.claimStartup?.()) return undefined;
    // Background work: a busy state (terminals reattaching after a reload) waits and retries.
    for (let attempt = 1; ; attempt++) {
      try {
        ensure(this.ctx, { origin: 'vscode', ownerWorkspace, lockTimeoutMs: LOCK_WAIT_MS });
        break;
      } catch (error) {
        if (!(error instanceof StateBusyError) || attempt >= STARTUP_ATTEMPTS) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
      }
    }
    if (this.host.sessionsHere().size > 0) return undefined;
    const first = list(this.ctx)
      .filter((r) => r.live && r.managed && !r.bindingIssue && r.origin === 'vscode' && r.ownerWorkspace === ownerWorkspace && r.attachedClients === 0)
      .sort((a, b) => compareSessionNames(a.name, b.name))[0];
    if (!first) return undefined;
    await this.show(first.name);
    return first.name;
  }

  /**
   * The session the main terminal's tmux client is on, e.g. after a custom
   * launcher attached it or the user switched sessions inside tmux.
   */
  async mainSession(): Promise<string | undefined> {
    return (await this.mainAttachment())?.session;
  }

  async mainAttachment(): Promise<{ session: string; terminalPid: number } | undefined> {
    const pid = await this.host.mainTerminalPid();
    if (!pid) return undefined;
    const result = this.ctx.tmux.run(['list-clients', '-F', '#{client_pid}\t#{session_name}'], true);
    for (const line of result.ok ? result.stdout.split('\n') : []) {
      const [clientPid, session] = line.split('\t');
      if (session && descendsFrom(Number(clientPid), pid)) return { session, terminalPid: pid };
    }
    return undefined;
  }

  /**
   * Called when the main terminal's session is known. A session a custom
   * launcher created without Berth metadata is adopted with the chosen agent
   * (or, when the launcher picked it, the agent running in the pane) and its
   * detected directory; one the launcher stamped is left as it is.
   */
  async settleLaunch(session: string, observedTerminalPid: number): Promise<boolean> {
    const intent = this.pendingLaunch;
    if (!intent || observedTerminalPid !== intent.terminalPid) return false;
    const terminalPid = await this.host.mainTerminalPid();
    if (this.pendingLaunch !== intent || terminalPid !== intent.terminalPid) return false;
    const { agent, startedAt } = intent;
    // A launcher that failed leaves nothing to settle; don't adopt later picks.
    if (Date.now() - startedAt > LAUNCH_WINDOW_MS) {
      this.pendingLaunch = undefined;
      return false;
    }
    // Only a session created by this launch is adopted, never one shown later.
    const created = Number(this.ctx.tmux.run(['display-message', '-p', '-t', `=${session}:`, '#{session_created}'], true).stdout.trim()) * 1000;
    if (!created || created < startedAt - 2000) return false;
    this.pendingLaunch = undefined;
    const live = this.ctx.tmux.listSessions().find((s) => s.name === session);
    if (!live) return false;
    const chosen = agent || this.agentRunningIn(session);
    if (!live.meta.agent && chosen) adopt(this.ctx, session, chosen, 'vscode');
    else if (live.meta.agent) stamp(this.ctx, session, { origin: 'vscode' });
    this.ctx.tmux.setTitle(session);
    return true;
  }

  /** Selection preserves every other session's terminal attachment. */
  show(name: string): Promise<void> {
    return this.orderMain(() => this.showNow(name));
  }

  private async showNow(name: string): Promise<void> {
    this.pendingLaunch = undefined;
    this.ensureAvailable(name);
    if (!await this.host.focusExisting(name)) {
      if (this.host.terminalPidsReady?.() === false &&
        this.ctx.tmux.listSessions().some(row => row.name === name && row.attachedClients > 0)) {
        throw new Error('Terminal identification is still in progress. Try opening the session again.');
      }
      await this.host.openTerminal(name, this.ctx.tmux.attachArgv(name), 'main');
    }
    this.attached(name);
    const row = this.row(name);
    if (row) this.host.sessionShown?.(row);
    presentCurrentState(this.ctx, name);
  }

  /** Show the next session waiting for the user, or unread; returns it. */
  async showNextAttention(current?: string): Promise<string | undefined> {
    this.rows = list(this.ctx);
    const next = nextAttention(this.rows, this.unread, current);
    if (next) await this.show(next);
    return next;
  }

  /** An extra terminal beside the main one, for watching two sessions at once. */
  async openToSide(name: string): Promise<void> {
    this.ensureAvailable(name);
    await this.host.openTerminal(name, this.ctx.tmux.attachArgv(name), 'side');
    this.attached(name);
    presentCurrentState(this.ctx, name);
  }

  private ensureAvailable(name: string): void {
    if (this.ctx.tmux.hasSession(name)) return;
    const result = ensure(this.ctx, { session: name, lockTimeoutMs: LOCK_WAIT_MS })[0];
    if (!this.ctx.tmux.hasSession(name)) throw new Error(`${name}: ${result?.detail ?? result?.outcome ?? 'Session no longer exists. Refresh the list.'}`);
  }

  private attached(name: string): void {
    if (list(this.ctx).find((row) => row.name === name && row.live)?.managed) {
      stamp(this.ctx, name, { origin: 'vscode', ownerWorkspace: this.host.ownerWorkspace?.() ?? '' });
      clearBell(this.ctx, name);
      this.ctx.tmux.setTitle(name);
    }
    this.unread.delete(name);
  }

  setRecoveryOptions(name: string, options: readonly string[]): void {
    setRecoveryOptions(this.ctx, name, options);
  }

  setRecoveryProfile(name: string, root: string): void {
    setRecoveryProfile(this.ctx, name, root);
  }

  relocateRecovery(name: string, cwd: string): void {
    relocateRecovery(this.ctx, name, cwd);
  }

  async retryRecovery(name: string): Promise<void> {
    const result = retryRecovery(this.ctx, name);
    if (result.outcome !== 'resume-requested' && result.outcome !== 'launched') throw new Error(result.detail ?? result.outcome);
    await this.show(name);
  }

  detach(name: string): Promise<void> {
    return this.orderMain(() => {
      this.pendingLaunch = undefined;
      detachTerminalClients(this.ctx.tmux, name, this.host.terminalPids?.() ?? new Set());
    });
  }

  /**
   * New session in `cwd`. With a custom launcher (spec §5.2) the launcher runs
   * in the session terminal and creates, stamps and attaches the session
   * itself; Berth learns which session it is from the terminal's tmux client.
   */
  /** The agent running in the session's active pane, if any (core discovery). */
  private agentRunningIn(session: string): string | undefined {
    return detectAgent(this.ctx, session)?.agent;
  }

  /**
   * Start a session. A custom launcher starts agents (spec §6); a plain shell
   * is always Berth's own. `agent` is undefined when the launcher picks it.
   */
  async prepareNewSession(agent: string | undefined, cwd: string, customLauncher = '', workspaceFolders: string[] = []): Promise<SessionLaunch> {
    this.pendingLaunch = undefined;
    const startedAt = Date.now();
    if (customLauncher && agent !== 'shell') {
      const command = renderLauncher(customLauncher, { agent: agent ?? '', cwd, relative: relativeToWorkspace(cwd, workspaceFolders), name: basename(cwd) });
      return { session: '', argv: [process.env.SHELL || '/bin/sh', '-lc', command], cwd, agent: agent ?? '', startedAt, custom: true };
    }
    const session = await this.createSession({ agent: agent ?? 'shell', cwd, origin: 'vscode', ownerWorkspace: this.host.ownerWorkspace?.() });
    return { session, argv: this.ctx.tmux.attachArgv(session), cwd, agent: agent ?? 'shell', startedAt, custom: false };
  }

  /** Called only after the host has acknowledged this launch's terminal. */
  completeNewSession(plan: SessionLaunch, terminalPid?: number): void {
    if (plan.custom) {
      if (terminalPid) this.pendingLaunch = { agent: plan.agent, startedAt: plan.startedAt, terminalPid };
      return;
    }
    clearBell(this.ctx, plan.session);
    presentCurrentState(this.ctx, plan.session);
    let row = list(this.ctx).find(row => row.name === plan.session);
    if (row?.managed && (row.origin !== 'vscode' || (row.ownerWorkspace ?? '') !== (this.host.ownerWorkspace?.() ?? ''))) {
      this.attached(plan.session);
      row = list(this.ctx).find(row => row.name === plan.session);
    }
    this.unread.delete(plan.session);
    if (row) {
      this.rows = [...this.rows.filter(existing => existing.name !== row.name), row];
      this.host.sessionShown?.(row);
    }
  }

  async newSession(agent: string | undefined, cwd: string, customLauncher = '', workspaceFolders: string[] = []): Promise<string | undefined> {
    return this.orderMain(async () => {
      const plan = await this.prepareNewSession(agent, cwd, customLauncher, workspaceFolders);
      await this.host.openTerminal(plan.session, plan.argv, 'main', cwd, { newlyCreated: !plan.custom });
      this.completeNewSession(plan, await this.host.mainTerminalPid());
      return plan.session || undefined;
    });
  }

  /** Agents running in live sessions, for setup that matters now. */
  liveAgents(): string[] {
    return [...new Set(this.rows.filter(row => row.live && row.agent && row.agent !== 'shell').map(row => row.agent))];
  }

  async rename(from: string, to: string): Promise<void> {
    await this.renameSession(from, to);
    this.host.renameSession?.(from, to);
    if (this.unread.delete(from)) this.unread.add(to);
    this.rows = this.rows.map((row) => row.name === from ? { ...row, name: to } : row);
  }

  kill(name: string): void {
    end(this.ctx, name);
  }

  /** The user has seen it without opening it. */
  markRead(name: string): void {
    this.unread.delete(name);
  }

  /** Stop restoring a stopped session. */
  forget(name: string): void {
    forget(this.ctx, name);
  }

  adopt(name: string, agent: string): void {
    adopt(this.ctx, name, agent, 'vscode');
  }
}
