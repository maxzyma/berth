import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { Context } from '../context.js';
import { launchCommand, resumeCommand, requireAdapter } from '../agents/commands.js';
import { shellSplit } from '../shell.js';
import type { SnapshotSession, StoredSnapshot } from '../snapshot/store.js';
import { withLock } from './lock.js';

export type RestoreOutcome = 'resumed' | 'launched' | 'shell' | 'skipped-live' | 'skipped-missing-cwd';

export interface RestoreResult {
  name: string;
  outcome: RestoreOutcome;
  detail?: string;
}

export interface RestoreOptions {
  origin?: string;
  session?: string;
}

function onPath(binary: string, env = process.env): boolean {
  if (!binary) return true;
  if (binary.includes('/')) return existsSync(binary);
  return (env.PATH ?? '').split(delimiter).some((dir) => dir && existsSync(join(dir, binary)));
}

function selected(s: SnapshotSession, options: RestoreOptions): boolean {
  if (options.session && s.name !== options.session) return false;
  if (options.origin && options.origin !== 'all' && s.origin !== options.origin) return false;
  return true;
}

function rebuild(ctx: Context, s: SnapshotSession): RestoreResult {
  if (!existsSync(s.cwd)) return { name: s.name, outcome: 'skipped-missing-cwd', detail: s.cwd };
  const adapter = requireAdapter(s.agent);
  const input = { adapter, name: s.name, cwd: s.cwd, overrides: ctx.config.agents };
  const resumed = s.conversation
    ? resumeCommand({ ...input, conversation: s.conversation, originalArgv: s.argv })
    : undefined;
  let command = resumed ?? launchCommand({ ...input, extraArgs: [] });
  let outcome: RestoreOutcome = resumed ? 'resumed' : 'launched';
  const [binary] = command ? shellSplit(command) : [''];
  if (!onPath(binary ?? '')) {
    command = '';
    outcome = 'shell';
  }
  ctx.tmux.newSession(s.name, s.cwd, command);
  ctx.tmux.setMeta(s.name, {
    agent: s.agent,
    cwd: s.cwd,
    argv: s.argv,
    conversation: s.conversation || undefined,
    origin: s.origin,
  });
  ctx.tmux.setTitle(s.name);
  return { name: s.name, outcome, detail: outcome === 'shell' ? `${binary} not found` : undefined };
}

/** Rebuild missing managed sessions from a snapshot; live ones are left alone. */
export function restoreFrom(ctx: Context, snapshot: StoredSnapshot | undefined, options: RestoreOptions = {}): RestoreResult[] {
  if (!snapshot) return [];
  return withLock(ctx.config.stateDir, () =>
    snapshot.sessions
      .filter((s) => selected(s, options))
      .map((s) => (ctx.tmux.hasSession(s.name) ? { name: s.name, outcome: 'skipped-live' as const } : rebuild(ctx, s))),
  );
}

export function ensure(ctx: Context, options: RestoreOptions = {}): RestoreResult[] {
  return restoreFrom(ctx, ctx.store.newest(), options);
}
