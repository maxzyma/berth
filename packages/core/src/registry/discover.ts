import { codexProcessBinding } from '../agents/codex-binding.js';
import { captureProfile, readProfile, profileRoot } from '../agents/profile.js';
import { formatFields, readFields } from '../tmux/fields.js';
import { processDirectory } from '../process-directory.js';
import { processArguments } from '../process-arguments.js';
import { shellQuote, shellSplit } from '../shell.js';
import { processLifetime, processOwnerAlive } from '../process-owner.js';
import { withLock } from '../restore/lock.js';
import { spawnSync } from 'node:child_process';
import type { Context } from '../context.js';
import { ADAPTERS } from '../agents/registry.js';
import { isIterm2 } from '../present/state.js';

/**
 * Discovery (spec §4.3): an unbound session or managed shell is recognised as
 * an agent session from its active pane, so any launcher - or none -
 * gets its sessions managed without knowing Berth.
 */

export interface Detected {
  agent: string;
  /** The agent's command line, starting with its binary. */
  argv: string;
  pid: number;
  argvIssue?: string;
}

export interface Proc { pid: number; ppid: number; args: string; native?: boolean }
const argumentCache = new WeakMap<Proc, string[] | undefined>();
export const ARGUMENTS_UNAVAILABLE = 'Launch arguments could not be verified. Check process access (macOS also requires /usr/bin/perl) before restoring.';

export const BINDING_UNVERIFIED = 'Recovery binding needs verification. No agent process identity was recorded; verified identity evidence must confirm the conversation.';
export const PRODUCER_CHANGED = 'Agent producer changed. Verify the conversation before restoring.';
const MAX_DEPTH = 6;

export function processes(): Proc[] {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
  if (ps.status !== 0) return [];
  return ps.stdout.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), args: m[3], native: true }] : [];
  });
}

const BINARIES = new Map(ADAPTERS.filter((a) => a.binary).map((a) => [a.binary, a.id]));
const program = (word = '') => word.split('/').pop() ?? '';
const INTERPRETERS = new Set(['node', 'nodejs', 'bun', 'deno', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'python', 'python3', 'ruby', 'perl']);

/**
 * The agent among a process and its descendants: a program named like an
 * agent binary, or a script so named run by an interpreter (`node <cli>`).
 * Names are what matter: some agents run as a binary named after its version,
 * so tmux's pane_current_command does not tell.
 */
export function agentsAmong(rootPid: number, procs: Proc[], depth = 0): Detected[] {
  if (depth >= MAX_DEPTH) return [];
  const process = procs.find((p) => p.pid === rootPid);
  if (process) {
    if (process.native && !argumentCache.has(process)) argumentCache.set(process, processArguments(process.pid));
    const exact = process.native ? argumentCache.get(process) : shellSplit(process.args);
    const words = exact ?? process.args.split(/\s+/);
    const index = BINARIES.has(program(words[0])) ? 0 : INTERPRETERS.has(program(words[0])) && BINARIES.has(program(words[1])) ? 1 : -1;
    if (index >= 0) return [{ agent: BINARIES.get(program(words[index]))!, argv: exact ? [program(words[index]), ...words.slice(index + 1)].map(shellQuote).join(' ') : '', pid: process.pid, ...(!exact ? { argvIssue: ARGUMENTS_UNAVAILABLE } : {}) }];
  }
  return procs.filter((p) => p.ppid === rootPid).flatMap((p) => agentsAmong(p.pid, procs, depth + 1));
}

export function agentAmong(rootPid: number, procs: Proc[]): Detected | undefined {
  const found = agentsAmong(rootPid, procs);
  return found.length === 1 ? found[0] : undefined;
}

export function sessionProducers(ctx: Context, session: string, procs = processes(), allPanes?: string): (Detected & { pane: string; cwd: string })[] {
  const output = allPanes ?? ctx.tmux.run(['list-panes', '-a', '-F', formatFields(['session_name', 'pane_id', 'pane_pid', 'pane_current_path'])], true).stdout;
  return readFields(output, 4).flatMap(([name, pane, pid, cwd]) => {
    if (name !== session) return [];
    return agentsAmong(Number(pid), procs).map((found) => ({ ...found, pane, cwd: cwdOf(found.pid) || cwd }));
  });
}

/**
 * A process's working directory. The pane's current path is not it: tmux
 * reads the foreground process group's leader, which is a launcher's shell
 * when the agent runs under one.
 */
export function cwdOf(pid: number): string | undefined {
  return processDirectory(pid);
}

/** The agent running in a session's active pane, if any. */
export function detectAgent(ctx: Context, session: string): Detected | undefined {
  const pid = Number(ctx.tmux.run(['display-message', '-p', '-t', `=${session}:`, '#{pane_pid}'], true).stdout.trim());
  return pid ? agentAmong(pid, processes()) : undefined;
}

/**
 * Stamp every unmanaged session or managed shell whose active pane runs an agent. Returns
 * the sessions stamped; the caller snapshots. Never throws.
 */
export function discover(ctx: Context): string[] {
  return withLock(ctx.config.stateDir, () => discoverLocked(ctx));
}

function discoverLocked(ctx: Context): string[] {
  if (!ctx.config.autoAdopt) return [];
  try {
    const candidates = ctx.tmux.listSessions();
    if (candidates.length === 0) return [];
    const clients = ctx.tmux.run(['list-clients', '-F', formatFields(['client_session', 'client_termtype'])], true);
    const procs = processes();
    const panes = ctx.tmux.run(['list-panes', '-a', '-F', formatFields(['session_name', 'pane_id', 'pane_pid', 'pane_current_path'])], true).stdout;
    const stamped: string[] = [];
    const nativePool = candidates.filter(row => !row.meta.agent || ['shell', 'codex'].includes(row.meta.agent));
    const nativeStart = Math.floor(Date.now() / 2_000) % Math.max(1, nativePool.length);
    const nativeCandidates = new Set(Array.from({ length: Math.min(2, nativePool.length) }, (_, index) => nativePool[(nativeStart + index) % nativePool.length].name));
    for (const s of candidates) {
      const producers = sessionProducers(ctx, s.name, procs, panes);
      if (producers.length > 1) {
        const issue = 'Multiple independent agents. Move each agent to its own tmux session before restoring.';
        if (s.meta.bindingIssue !== issue) {
          ctx.tmux.setMeta(s.name, { bindingIssue: issue });
          stamped.push(s.name);
        }
        continue;
      }
      const found = producers[0];
      if (!found) continue;
      const lifetime = processLifetime(found.pid)?.key;
      if (!lifetime) continue;
      if (found.agent === 'codex' && !shellSplit(found.argv).some(word => ['app-server', 'exec', 'mcp-server', 'review'].includes(word))
        && (!s.meta.agent || s.meta.agent === 'codex' || s.meta.agent === 'shell')
        && !found.argvIssue && nativeCandidates.has(s.name)
        && (!s.meta.recovery || s.meta.recovery === 'confirmed')
        && (!s.meta.conversation || !s.meta.profile || s.meta.bindingIssue === PRODUCER_CHANGED || s.meta.bindingIssue === BINDING_UNVERIFIED)) {
        const binding = codexProcessBinding(found.pid, lifetime);
        const profile = readProfile('codex', s.meta.profile);
        if (binding && (!s.meta.conversation || s.meta.conversation === binding.conversation)
          && (!profile || profileRoot('codex', profile) === binding.root)
          && (!s.meta.bindingIssue || [PRODUCER_CHANGED, BINDING_UNVERIFIED].includes(s.meta.bindingIssue))) {
          const current = ctx.tmux.listSessions().find(row => row.name === s.name);
          const owners = sessionProducers(ctx, s.name);
          if (current?.sessionId === s.sessionId && current.serverStart === s.serverStart
            && owners.length === 1 && owners[0].pid === found.pid && owners[0].pane === found.pane
            && processLifetime(found.pid)?.key === lifetime) {
            ctx.tmux.setMeta(s.name, { agent: 'codex', conversation: binding.conversation,
              profile: JSON.stringify(profile ?? captureProfile('codex', { ...ctx.env, CODEX_HOME: binding.root })),
              producerPane: found.pane, producerLifetime: lifetime, bindingIssue: '',
              cwd: s.meta.cwd || found.cwd || s.path, argv: found.argv, argvVerified: '1' });
            ctx.tmux.setTitle(s.name);
            stamped.push(s.name);
            continue;
          }
        }
      }
      if (s.meta.agent && s.meta.agent !== 'shell') {
        if (found.argvIssue) {
          if (!s.meta.bindingIssue) {
            ctx.tmux.setMeta(s.name, { bindingIssue: found.argvIssue });
            stamped.push(s.name);
          }
          continue;
        }
        if (s.meta.bindingIssue === ARGUMENTS_UNAVAILABLE) {
          ctx.tmux.setMeta(s.name, { bindingIssue: '', argv: found.argv, argvVerified: '1' });
          stamped.push(s.name);
        }
        const sameLifetime = !!s.meta.producerLifetime && processOwnerAlive(found.pid, s.meta.producerLifetime, Date.now());
        if (sameLifetime && s.meta.agent === found.agent && s.meta.producerPane === found.pane
          && (!s.meta.bindingIssue || s.meta.bindingIssue === PRODUCER_CHANGED)
          && (s.meta.producerLifetime !== lifetime || s.meta.bindingIssue === PRODUCER_CHANGED)) {
          ctx.tmux.setMeta(s.name, { producerLifetime: lifetime, bindingIssue: '' });
          stamped.push(s.name);
        }
        if (s.meta.agent !== found.agent || (s.meta.producerPane && s.meta.producerPane !== found.pane)
          || (s.meta.producerLifetime && !sameLifetime)) {
          const issue = PRODUCER_CHANGED;
          if (s.meta.bindingIssue !== issue) {
            ctx.tmux.setMeta(s.name, { bindingIssue: issue });
            stamped.push(s.name);
          }
        } else if (!s.meta.producerLifetime && s.meta.conversation && (!s.meta.recovery || s.meta.recovery === 'confirmed')) {
          if (!s.meta.bindingIssue || s.meta.bindingIssue === PRODUCER_CHANGED) {
            ctx.tmux.setMeta(s.name, { bindingIssue: BINDING_UNVERIFIED });
            stamped.push(s.name);
          }
        } else if (!s.meta.producerPane || !s.meta.producerLifetime || s.meta.argvVerified !== '1') {
          ctx.tmux.setMeta(s.name, { producerPane: found.pane, producerLifetime: lifetime,
            ...(s.meta.argvVerified !== '1' ? { argv: found.argv, argvVerified: '1' } : {}),
          });
          stamped.push(s.name);
        }
        continue;
      }
      const iterm2 = readFields(clients.stdout, 2).some(([session, termtype]) => {
        return session === s.name && isIterm2(termtype);
      });
      ctx.tmux.setMeta(s.name, {
        agent: found.agent,
        producerPane: found.pane,
        producerLifetime: lifetime,
        cwd: found.cwd || s.path,
        argv: found.argv, argvVerified: found.argvIssue ? '' : '1',
        ...(found.argvIssue ? { bindingIssue: found.argvIssue } : {}),
        origin: s.meta.origin && s.meta.origin !== 'none' ? s.meta.origin : iterm2 ? 'iterm2' : 'none',
      });
      ctx.tmux.setTitle(s.name);
      stamped.push(s.name);
    }
    return stamped;
  } catch {
    return [];
  }
}
