/** Session actions for Berth for VS Code; talks to the editor only through `Host`. */
import { spawnSync } from 'node:child_process';
import {
  adopt,
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
}

export class Controller {
  private rows: SessionRow[] = [];
  readonly unread = new Set<string>();
  private branches = new Map<string, string>();

  constructor(
    private readonly ctx: Context,
    private readonly host: Host,
  ) {}

  refresh(): { tree: TreeView; transitions: Transition[] } {
    const next = list(this.ctx);
    const changed = transitions(this.rows, next);
    this.rows = next;
    for (const t of changed) {
      this.unread.add(t.name);
      this.host.notify(t);
    }
    return { tree: this.tree(), transitions: changed };
  }

  tree(): TreeView {
    return buildTree(this.rows, { here: this.host.sessionsHere(), unread: this.unread, branch: (cwd) => this.branch(cwd) });
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
    ensure(this.ctx, { origin: 'vscode' });
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
      if (Number(clientPid) === pid && session) return session;
    }
    return undefined;
  }

  /** tmux client of a terminal process, found by its pid. */
  private clientTty(pid: number): string | undefined {
    const result = this.ctx.tmux.run(['list-clients', '-F', '#{client_pid}\t#{client_tty}'], true);
    if (!result.ok) return undefined;
    for (const line of result.stdout.split('\n')) {
      const [clientPid, tty] = line.split('\t');
      if (Number(clientPid) === pid && tty) return tty;
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
    if (!this.ctx.tmux.hasSession(name)) ensure(this.ctx, { session: name });
    stamp(this.ctx, name, { origin: 'vscode' });
    clearBell(this.ctx, name);
    this.ctx.tmux.setTitle(name);
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
    if (!this.ctx.tmux.hasSession(name)) ensure(this.ctx, { session: name });
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
  async newSession(agent: string, cwd: string, customLauncher = '', workspaceFolders: string[] = []): Promise<string | undefined> {
    if (customLauncher) {
      const command = renderLauncher(customLauncher, { agent, cwd, relative: relativeToWorkspace(cwd, workspaceFolders), name: basename(cwd) });
      this.host.openTerminal('', [process.env.SHELL || '/bin/sh', '-lc', command], 'main', cwd);
      return undefined;
    }
    const name = create(this.ctx, { agent, cwd, origin: 'vscode' });
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

  adopt(name: string, agent: string): void {
    adopt(this.ctx, name, agent, 'vscode');
  }
}
