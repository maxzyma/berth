import { spawnSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import type { Context } from '../context.js';
import { ADAPTERS } from '../agents/registry.js';
import { isIterm2 } from '../present/state.js';

/**
 * Discovery (spec §4.3): a session nobody stamped is recognised as an agent
 * session from the processes in its active pane, so any launcher - or none -
 * gets its sessions managed without knowing Berth.
 */

export interface Detected {
  agent: string;
  /** The agent's command line, starting with its binary. */
  argv: string;
  pid: number;
}

interface Proc { pid: number; ppid: number; args: string }

const MAX_DEPTH = 6;

function processes(): Proc[] {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8' });
  if (ps.status !== 0) return [];
  return ps.stdout.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }] : [];
  });
}

const BINARIES = new Map(ADAPTERS.filter((a) => a.binary).map((a) => [a.binary, a.id]));
const program = (word = '') => word.split('/').pop() ?? '';

/**
 * The agent among a process and its descendants: a program named like an
 * agent binary, or a script so named run by an interpreter (`node <cli>`).
 * Names are what matter: some agents run as a binary named after its version,
 * so tmux's pane_current_command does not tell.
 */
export function agentAmong(rootPid: number, procs: Proc[]): Detected | undefined {
  for (let level = [rootPid], depth = 0; level.length && depth < MAX_DEPTH; depth++) {
    for (const p of procs.filter((q) => level.includes(q.pid))) {
      const words = p.args.split(/\s+/);
      const direct = BINARIES.get(program(words[0]));
      if (direct) return { agent: direct, argv: [program(words[0]), ...words.slice(1)].join(' '), pid: p.pid };
      const viaInterpreter = BINARIES.get(program(words[1]));
      if (viaInterpreter) return { agent: viaInterpreter, argv: [program(words[1]), ...words.slice(2)].join(' '), pid: p.pid };
    }
    level = procs.filter((q) => level.includes(q.ppid)).map((q) => q.pid);
  }
  return undefined;
}

/**
 * A process's working directory. The pane's current path is not it: tmux
 * reads the foreground process group's leader, which is a launcher's shell
 * when the agent runs under one.
 */
export function cwdOf(pid: number): string | undefined {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    // Not Linux: ask lsof.
  }
  const r = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : undefined;
}

/** The agent running in a session's active pane, if any. */
export function detectAgent(ctx: Context, session: string): Detected | undefined {
  const pid = Number(ctx.tmux.run(['display-message', '-p', '-t', `=${session}:`, '#{pane_pid}'], true).stdout.trim());
  return pid ? agentAmong(pid, processes()) : undefined;
}

/**
 * Stamp every unmanaged live session whose active pane runs an agent. Returns
 * the sessions stamped; the caller snapshots. Never throws.
 */
export function discover(ctx: Context): string[] {
  if (!ctx.config.autoAdopt) return [];
  try {
    const unmanaged = ctx.tmux.listSessions().filter((s) => !s.meta.agent);
    if (unmanaged.length === 0) return [];
    const panes = ctx.tmux.run(['list-panes', '-a', '-F', '#{session_name}\t#{pane_active}\t#{window_active}\t#{pane_pid}\t#{pane_current_path}'], true);
    const clients = ctx.tmux.run(['list-clients', '-F', '#{client_session}\t#{client_termtype}'], true);
    const procs = processes();
    const stamped: string[] = [];
    for (const s of unmanaged) {
      const pane = panes.stdout.split('\n').map((l) => l.split('\t')).find(([name, active, windowActive]) => name === s.name && active === '1' && windowActive === '1');
      if (!pane) continue;
      const found = agentAmong(Number(pane[3]), procs);
      if (!found) continue;
      const iterm2 = clients.stdout.split('\n').some((l) => {
        const [session, termtype = ''] = l.split('\t');
        return session === s.name && isIterm2(termtype);
      });
      ctx.tmux.setMeta(s.name, { agent: found.agent, cwd: cwdOf(found.pid) || pane[4] || s.path, argv: found.argv, origin: iterm2 ? 'iterm2' : 'none' });
      ctx.tmux.setTitle(s.name);
      stamped.push(s.name);
    }
    return stamped;
  } catch {
    return [];
  }
}
