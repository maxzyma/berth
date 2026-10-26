/** Session actions for Berth for VS Code; talks to the editor only through `Host`. */
import { spawnSync } from 'node:child_process';
import {
  adopt,
  create,
  ensure,
  list,
  presentState,
  stamp,
  type Context,
  type SessionRow,
} from '@berthdev/berth';
import { buildTree, transitions, type Transition, type TreeView } from './model.js';

export interface Host {
  /** Open a terminal attached to a session; unnamed, so its tab title follows the session. */
  openTerminal(session: string, argv: string[]): void;
  /** Run a command in a new terminal (custom launchers). */
  runInTerminal(command: string, cwd: string): void;
  /** Sessions shown by a terminal in this window. */
  sessionsHere(): Set<string>;
  focusTerminal(session: string): boolean;
  closeTerminals(session: string): void;
  notify(transition: Transition): void;
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

  private branch(cwd: string): string {
    if (!this.branches.has(cwd)) {
      const r = spawnSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8', timeout: 2000 });
      this.branches.set(cwd, r.status === 0 ? r.stdout.trim() : '');
    }
    return this.branches.get(cwd) ?? '';
  }

  /** Startup (spec §6): rebuild missing vscode sessions, then open one terminal for each not shown anywhere. */
  startup(): string[] {
    ensure(this.ctx, { origin: 'vscode' });
    const here = this.host.sessionsHere();
    const opened: string[] = [];
    for (const row of list(this.ctx)) {
      if (!row.live || !row.managed || row.origin !== 'vscode') continue;
      if (row.attachedClients > 0 || here.has(row.name)) continue;
      this.attachTerminal(row.name);
      opened.push(row.name);
    }
    return opened;
  }

  private attachTerminal(name: string): void {
    const [bin, ...args] = this.ctx.tmux.attachArgv(name);
    this.host.openTerminal(name, [bin, ...args]);
  }

  /** Selecting a row: focus its terminal, attaching first when needed; stopped sessions are rebuilt. */
  focus(name: string): void {
    this.unread.delete(name);
    if (this.host.focusTerminal(name)) return;
    if (!this.ctx.tmux.hasSession(name)) ensure(this.ctx, { session: name });
    this.attach(name);
  }

  attach(name: string): void {
    stamp(this.ctx, name, { origin: 'vscode' });
    this.attachTerminal(name);
    const state = this.rows.find((r) => r.name === name)?.state ?? '';
    // Re-show state once the new client exists.
    setTimeout(() => presentState(this.ctx.tmux, name, state), 500);
  }

  detach(name: string): void {
    this.host.closeTerminals(name);
  }

  newSession(agent: string, cwd: string, customLauncher = ''): string | undefined {
    if (customLauncher) {
      this.host.runInTerminal(customLauncher.replace(/\{agent\}/g, agent), cwd);
      return undefined;
    }
    const name = create(this.ctx, { agent, cwd, origin: 'vscode' });
    this.attachTerminal(name);
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
