import { ARGUMENTS_UNAVAILABLE } from '../registry/discover.js';
import { applyLaunchEnvironment, captureProfile, profileAtRoot, readProfile, type AgentProfile } from '../agents/profile.js';
import { recordIdentity, nameCollision, COLLISION_HINT } from '../snapshot/identity.js';
import { startStagedPane, withPlaceholder } from '../registry/launch.js';
import { usableDirectory } from '../registry/directory.js';
import { wasClosed, serverOwnerAlive } from '../snapshot/lifecycle.js';
import { existsSync, statSync } from 'node:fs';
import { executableOnPath } from '../tools.js';
import type { Context } from '../context.js';
import { keptArgs, recoveryOptionsRequired, launchCommand, resumeCommand, requireAdapter } from '../agents/commands.js';
import { shellQuote, shellSplit } from '../shell.js';
import type { SnapshotSession, StoredSnapshot } from '../snapshot/store.js';
import { recoveryStatus } from './status.js';
import { BerthError } from '../errors.js';
import { snapshotQuietly, takeSnapshot } from '../snapshot/take.js';
import { withLock } from './lock.js';

export type RestoreOutcome = 'resume-requested' | 'launched' | 'skipped-live' | 'skipped-missing-cwd' | 'skipped-binding-conflict' | 'skipped-unbound' | 'skipped-missing-binary' | 'skipped-unsupported-resume' | 'failed' | 'skipped-name-conflict' | 'skipped-unknown-profile' | 'skipped-unverified-arguments';

export interface RestoreResult {
  name: string;
  outcome: RestoreOutcome;
  detail?: string;
}

export interface RestoreOptions {
  origin?: string;
  ownerWorkspace?: string;
  session?: string;
  /** How long to wait for another restore to finish; editors pass a short one so they never freeze. */
  lockTimeoutMs?: number;
}

function selected(s: SnapshotSession, options: RestoreOptions): boolean {
  if (options.ownerWorkspace && s.ownerWorkspace !== options.ownerWorkspace) return false;
  if (options.session && s.name !== options.session) return false;
  if (options.origin && options.origin !== 'all' && s.origin !== options.origin) return false;
  return true;
}

function prepare(ctx: Context, s: SnapshotSession): RestoreResult | { command: string } {
  if (s.bindingIssue) return { name: s.name, outcome: 'skipped-binding-conflict', detail: s.bindingIssue };
  if (!usableDirectory(s.cwd)) return { name: s.name, outcome: 'skipped-missing-cwd', detail: s.cwd };
  const adapter = requireAdapter(s.agent);
  if (s.agent !== 'shell' && !s.conversation) return { name: s.name, outcome: 'skipped-unbound', detail: 'Use the agent native conversation picker, or explicitly start a new session.' };
  if (s.agent !== 'shell' && !readProfile(s.agent, s.profile)) return { name: s.name, outcome: 'skipped-unknown-profile', detail: 'Choose the agent profile for this saved conversation (Choose Recovery Profile, or berth recovery-profile <session> --root <directory>).' };
  if (recoveryOptionsRequired(s.agent, s.argv, s.argvVerified)) return { name: s.name, outcome: 'skipped-unverified-arguments', detail: 'Saved launch options need review. Use Review Recovery Options or berth recovery-options <session> -- <options>.' };
  const input = { adapter, name: s.name, cwd: s.cwd, overrides: ctx.config.agents };
  const command = s.agent === 'shell' ? launchCommand(input) : resumeCommand({ ...input, conversation: s.conversation, originalArgv: s.argv });
  if (command === undefined) return { name: s.name, outcome: 'skipped-unsupported-resume', detail: 'This agent has no exact-ID resume command.' };
  const [binary] = command ? shellSplit(command) : [''];
  if (binary && !executableOnPath(binary, ctx.env, s.cwd)) return { name: s.name, outcome: 'skipped-missing-binary', detail: `Install ${binary}, then retry.` };
  return { command };
}

function rebuild(ctx: Context, s: SnapshotSession): RestoreResult {
  const prepared = prepare(ctx, s);
  if (!('command' in prepared)) return prepared;
  const { command } = prepared;
  const adapter = requireAdapter(s.agent);
  // Register expected identity before the agent can emit its start hook.
  return withPlaceholder(ctx, s.name, s.cwd, () => {
    const profile = readProfile(s.agent, s.profile);
    if (profile) applyLaunchEnvironment(ctx, s.name, s.agent, profile);
    ctx.tmux.setMeta(s.name, {
      profile: profile ? JSON.stringify(profile) : undefined,
      agent: s.agent, cwd: s.cwd, argv: s.argv, argvVerified: s.argvVerified ? '1' : undefined, restoreSource: recordIdentity(s),
      conversation: s.conversation || undefined, origin: s.origin, ownerWorkspace: s.ownerWorkspace,
      ...(s.agent === 'shell' ? {} : {
        recovery: adapter.events.start.length ? 'requested' : 'unconfirmed',
        recoveryAt: String(Date.now()),
        recoveryDetail: adapter.events.start.length ? 'Waiting for the expected conversation.' : 'This agent cannot acknowledge recovery. Inspect the terminal.',
      }),
    });
    ctx.tmux.setTitle(s.name);
    if (s.agent !== 'shell') ctx.tmux.run(['set-option', '-w', '-t', `=${s.name}:`, 'remain-on-exit', 'on']);
    startStagedPane(ctx, s.name, command);
    return { name: s.name, outcome: s.agent === 'shell' ? 'launched' : 'resume-requested' };
  });

}

/** A failed attempt never turns an owned placeholder into a successful recovery. */
function attempt(ctx: Context, s: SnapshotSession): RestoreResult {
  try {
    if (ctx.tmux.hasSession(s.name)) {
      const live = ctx.tmux.listSessions().find((session) => session.name === s.name);
      if (live) return { name: s.name, outcome: nameCollision(ctx, live, [s]) ? 'skipped-name-conflict' : 'skipped-live' };
    }
    return rebuild(ctx, s);
  }
  catch (error) {
    return { name: s.name, outcome: 'failed', detail: (error as Error).message };
  }
}

function restoreSelected(ctx: Context, snapshot: StoredSnapshot | undefined, options: RestoreOptions): RestoreResult[] {
  if (!snapshot) return [];
  const live = new Set(ctx.tmux.listSessions().map((session) => session.name));
  const sessions = snapshot.sessions.filter((s) => selected(s, options) && !wasClosed(ctx, s)
    && (live.has(s.name) || s.recovery === 'failed' || !serverOwnerAlive(ctx, s.serverStart)));
  const results = sessions.map((s) => attempt(ctx, s));
  const pending = sessions.flatMap((s, index) => results[index].outcome === 'failed'
    ? [{ ...s, sessionId: undefined, recovery: 'failed' as const, recoveryDetail: results[index].detail }] : []);
  if (pending.length || results.some((r) => r.outcome === 'resume-requested' || r.outcome === 'launched')) {
    takeSnapshot(ctx, new Date(), [], pending);
  }
  return results;
}

/** Explicit restore uses its chosen snapshot; ensure reads latest inside the lock. */
export function restoreFrom(ctx: Context, snapshot: StoredSnapshot | undefined, options: RestoreOptions = {}): RestoreResult[] {
  return withLock(ctx.config.stateDir, () => restoreSelected(ctx, snapshot, options), options.lockTimeoutMs);
}
export function ensure(ctx: Context, options: RestoreOptions = {}): RestoreResult[] {
  return withLock(ctx.config.stateDir, () => restoreSelected(ctx, ctx.store.newest(), options), options.lockTimeoutMs);
}


/** Replace only an explicitly failed/unconfirmed attempt, keeping its exact target. */
export function retryRecovery(ctx: Context, name: string): RestoreResult {
  return withLock(ctx.config.stateDir, () => {
    const live = ctx.tmux.listSessions().find((session) => session.name === name);
    if (live && nameCollision(ctx, live, ctx.store.newest()?.sessions ?? [])) {
      return { name, outcome: 'skipped-name-conflict', detail: COLLISION_HINT };
    }
    if (live) {
      const status = recoveryStatus(ctx.tmux, name, live.meta).recovery;
      if (status !== 'failed' && status !== 'unconfirmed') throw new BerthError('This session has no failed or unconfirmed recovery to retry.');
      takeSnapshot(ctx);
    }
    const saved = ctx.store.newest()?.sessions.find((session) => session.name === name);
    if (!saved) throw new BerthError(`No recovery record for ${name}. Refresh the list.`);
    const prepared = prepare(ctx, saved);
    if (!('command' in prepared)) return prepared;
    if (live) ctx.tmux.killSession(name);
    const result = attempt(ctx, saved);
    takeSnapshot(ctx, new Date(), [], result.outcome === 'failed' ? [{ ...saved, sessionId: undefined, recovery: 'failed', recoveryDetail: result.detail }] : []);
    return result;
  }, 3000);
}


/** Relocate one stopped recovery record without changing its conversation identity. */
export function relocateRecovery(ctx: Context, name: string, cwd: string): void {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new BerthError('Choose an existing folder.');
  withLock(ctx.config.stateDir, () => {
    if (ctx.tmux.hasSession(name)) throw new BerthError('End the live session before changing its recovery folder.');
    const saved = ctx.store.newest();
    if (!saved?.sessions.some((session) => session.name === name)) throw new BerthError(`No recovery record for ${name}.`);
    const sessions = saved.sessions.map((session) => session.name === name ? { ...session, cwd } : session);
    const scrollback = retainedScrollback(ctx, saved, sessions);
    ctx.store.write(sessions, scrollback);
  }, 3000);
}


/** Explicitly choose a stopped conversation's profile; never infer it from the host. */
export function setRecoveryProfile(ctx: Context, name: string, root?: string): AgentProfile {
  return withLock(ctx.config.stateDir, () => {
    if (ctx.tmux.hasSession(name)) throw new BerthError('Profile changes require a stopped session. A live agent reports its profile through its start hook.');
    const saved = ctx.store.newest();
    const record = saved?.sessions.find((session) => session.name === name);
    if (!saved || !record || record.agent === 'shell') throw new BerthError('No saved agent conversation for this session.');
    if (root && !usableDirectory(root)) throw new BerthError('Choose an existing accessible agent profile folder.');
    const profile = root ? profileAtRoot(record.agent, ctx.env, root) : captureProfile(record.agent, ctx.env);
    const sessions = saved.sessions.map((session) => session.name === name ? { ...session, profile } : session);
    const scrollback = retainedScrollback(ctx, saved, sessions);
    ctx.store.write(sessions, scrollback);
    return profile;
  });
}


/** Explicitly replace only the options an adapter can preserve on resume. */
export function setRecoveryOptions(ctx: Context, name: string, options: readonly string[]): void {
  withLock(ctx.config.stateDir, () => {
    if (ctx.tmux.hasSession(name)) throw new BerthError('Recovery options require a stopped session.');
    const saved = ctx.store.newest();
    const record = saved?.sessions.find((session) => session.name === name);
    if (!saved || !record || record.agent === 'shell') throw new BerthError('No saved agent conversation for this session.');
    const adapter = requireAdapter(record.agent);
    const argv = [adapter.binary, ...options].map(shellQuote).join(' ');
    if (JSON.stringify(keptArgs(adapter, argv)) !== JSON.stringify(options)) throw new BerthError('Use only supported resume options, without a prompt or -- terminator.');
    const sessions = saved.sessions.map((session) => session.name === name ? { ...session, argv, argvVerified: true, ...(session.bindingIssue === ARGUMENTS_UNAVAILABLE ? { bindingIssue: undefined } : {}) } : session);
    const scrollback = retainedScrollback(ctx, saved, sessions);
    ctx.store.write(sessions, scrollback);
  });
}

function retainedScrollback(ctx: Context, saved: StoredSnapshot, sessions: readonly SnapshotSession[]): Record<string, string> {
  return Object.fromEntries(sessions.flatMap((session): [string, string][] => {
    const text = ctx.store.optionalScrollback(saved.dir, session.name);
    return text === undefined ? [] : [[session.name, text]];
  }));
}
