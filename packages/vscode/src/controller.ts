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
  presentState,
  stamp,
  type Context,
  type SessionRow,
} from '@berthdev/berth';
import { basename } from 'node:path';
import { buildTree, nextAttention, relativeToWorkspace, renderLauncher, transitions, type Transition, type TreeView } from './model.js';

export type TerminalRole = 'main' | 'side';

export interface Host {
  /**
   * Open a terminal running `argv` (an attach command). `main` is the one
   * session terminal that follows the selection; `side` terminals are extra
   * views opened on request. Terminals are unnamed, so tab titles follow tmux.
   */
  openTerminal(session: string, argv: string[], role: TerminalRole, cwd?: string): void;
  /** Process id of the main session terminal, when one is open. */
  mainTerminalPid(): Promise<number | undefined>;
  /** Bring the main terminal forward; it now shows `session`. */
  showMain(session: string): void;
  /** Sessions shown by a terminal in this window. */
  sessionsHere(): Set<string>;
  closeTerminals(session: string): void;
  notify(transition: Transition): void;
  /** Called after a session is brought forward, e.g. to follow it in the explorer. */
  sessionShown?(row: SessionRow): void;
  /** This window's workspace folders. */
  workspaceFolders?(): string[];
  /** An agent in use has no Berth hooks: offer to install them (spec §6). */
  suggestHooks?(agent: string): void;
}

/** How long after starting a custom launcher its session is expected. */
const LAUNCH_WINDOW_MS = 120_000;
const LOCK_WAIT_MS = 3_000;

/** Parent pid of `pid`, or undefined at the top. */
function parentOf(pid: number): number | undefined {
  const r = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' });
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
  /** Agent chosen for a custom launcher whose session is not known yet, and when it started. */
  /** `agent` is '' when the launcher picks the agent itself. */
  private pendingLaunch?: { agent: string; startedAt: number };
  readonly unread = new Set<string>();
  /** Agents already offered hooks in this window. */
  private readonly offeredHooks = new Set<string>();
  private branches = new Map<string, string>();

  constructor(
    private readonly ctx: Context,
    private readonly host: Host,
  ) {}

  refresh(): { tree: TreeView; transitions: Transition[] } {
    adoptDiscovered(this.ctx);
    const next = list(this.ctx);
    const changed = transitions(this.rows, next);
    this.rows = next;
    for (const t of changed) {
      this.unread.add(t.name);
      this.host.notify(t);
    }
    for (const row of next) {
      if (!row.managed || row.hooks !== 'missing' || this.offeredHooks.has(row.agent)) continue;
      this.offeredHooks.add(row.agent);
      this.host.suggestHooks?.(row.agent);
    }
    return { tree: this.tree(), transitions: changed };
  }

  tree(): TreeView {
    return buildTree(this.rows, {
      here: this.host.sessionsHere(),
      unread: this.unread,
      branch: (cwd) => this.branch(cwd),
      workspaceFolders: this.host.workspaceFolders?.() ?? [],
    });
  }

  row(name: string): SessionRow | undefined {
    return this.rows.find((r) => r.name === name) ?? list(this.ctx).find((r) => r.name === name);
  }

  private branch(cwd: string): string {
    if (!this.branches.has(cwd)) {
      const r = spawnSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8', timeout: 2000 });
      this.branches.set(cwd, r.status === 0 ? r.stdout.trim() : '');
    }
    return this.branches.get(cwd) ?? '';
  }

  /**
   * Startup (spec §6): rebuild missing vscode sessions, then show the first
   * one not attached anywhere in the main terminal. Others stay listed.
   */
  async startup(): Promise<string | undefined> {
    ensure(this.ctx, { origin: 'vscode', lockTimeoutMs: LOCK_WAIT_MS });
    if (this.host.sessionsHere().size > 0) return undefined;
    const first = list(this.ctx)
      .filter((r) => r.live && r.managed && r.origin === 'vscode' && r.attachedClients === 0)
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!first) return undefined;
    await this.show(first.name);
    return first.name;
  }

  /**
   * The session the main terminal's tmux client is on, e.g. after a custom
   * launcher attached it or the user switched sessions inside tmux.
   */
  async mainSession(): Promise<string | undefined> {
    const pid = await this.host.mainTerminalPid();
    if (!pid) return undefined;
    const result = this.ctx.tmux.run(['list-clients', '-F', '#{client_pid}\t#{session_name}'], true);
    for (const line of result.ok ? result.stdout.split('\n') : []) {
      const [clientPid, session] = line.split('\t');
      if (session && descendsFrom(Number(clientPid), pid)) return session;
    }
    return undefined;
  }

  /**
   * Called when the main terminal's session is known. A session a custom
   * launcher created without Berth metadata is adopted with the chosen agent
   * (or, when the launcher picked it, the agent running in the pane) and its
   * detected directory; one the launcher stamped is left as it is.
   */
  settleLaunch(session: string): boolean {
    if (!this.pendingLaunch) return false;
    const { agent, startedAt } = this.pendingLaunch;
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

  /** tmux client of a terminal process, found by its pid. */
  private clientTty(pid: number): string | undefined {
    const result = this.ctx.tmux.run(['list-clients', '-F', '#{client_pid}\t#{client_tty}'], true);
    if (!result.ok) return undefined;
    for (const line of result.stdout.split('\n')) {
      const [clientPid, tty] = line.split('\t');
      if (tty && descendsFrom(Number(clientPid), pid)) return tty;
    }
    return undefined;
  }

  /**
   * Selecting a row: the main terminal switches to the session (tmux
   * switch-client), or opens attached to it when there is none. A stopped
   * session is rebuilt first.
   */
  async show(name: string): Promise<void> {
    this.unread.delete(name);
    if (!this.ctx.tmux.hasSession(name)) ensure(this.ctx, { session: name, lockTimeoutMs: LOCK_WAIT_MS });
    // Only Berth's sessions are stamped; others are shown as they are.
    if (this.row(name)?.managed) {
      stamp(this.ctx, name, { origin: 'vscode' });
      clearBell(this.ctx, name);
      this.ctx.tmux.setTitle(name);
    }
    const pid = await this.host.mainTerminalPid();
    const tty = pid ? this.clientTty(pid) : undefined;
    if (tty) {
      this.ctx.tmux.run(['switch-client', '-c', tty, '-t', `=${name}`]);
      this.host.showMain(name);
    } else {
      this.host.openTerminal(name, this.ctx.tmux.attachArgv(name), 'main');
    }
    const row = this.row(name);
    if (row) this.host.sessionShown?.(row);
    const state = row?.state ?? '';
    // Re-show state once the client is on the session.
    setTimeout(() => presentState(this.ctx.tmux, name, state, { note: row?.note }), 500);
  }

  /** Show the next session waiting for the user, or unread; returns it. */
  async showNextAttention(current?: string): Promise<string | undefined> {
    this.rows = list(this.ctx);
    const next = nextAttention(this.rows, this.unread, current);
    if (next) await this.show(next);
    return next;
  }

  /** An extra terminal beside the main one, for watching two sessions at once. */
  openToSide(name: string): void {
    if (!this.ctx.tmux.hasSession(name)) ensure(this.ctx, { session: name, lockTimeoutMs: LOCK_WAIT_MS });
    this.host.openTerminal(name, this.ctx.tmux.attachArgv(name), 'side');
  }

  detach(name: string): void {
    this.host.closeTerminals(name);
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
  async newSession(agent: string | undefined, cwd: string, customLauncher = '', workspaceFolders: string[] = []): Promise<string | undefined> {
    if (customLauncher && agent !== 'shell') {
      const command = renderLauncher(customLauncher, { agent: agent ?? '', cwd, relative: relativeToWorkspace(cwd, workspaceFolders), name: basename(cwd) });
      this.pendingLaunch = { agent: agent ?? '', startedAt: Date.now() };
      this.host.openTerminal('', [process.env.SHELL || '/bin/sh', '-lc', command], 'main', cwd);
      return undefined;
    }
    const name = create(this.ctx, { agent: agent ?? 'shell', cwd, origin: 'vscode' });
    await this.show(name);
    return name;
  }

  rename(from: string, to: string): void {
    this.ctx.tmux.renameSession(from, to);
  }

  kill(name: string): void {
    this.host.closeTerminals(name);
    this.ctx.tmux.killSession(name);
  }

  /** Stop restoring a stopped session. */
  forget(name: string): void {
    forget(this.ctx, name);
  }

  adopt(name: string, agent: string): void {
    adopt(this.ctx, name, agent, 'vscode');
  }
}
