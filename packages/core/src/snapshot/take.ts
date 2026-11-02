import { readProfile } from '../agents/profile.js';
import { nameCollision } from './identity.js';
import { watchClosures, wasClosed } from './lifecycle.js';
import { recoveryStatus } from '../restore/status.js';
import type { Context } from '../context.js';
import type { SnapshotSession } from './store.js';
import { withLock } from '../restore/lock.js';
import { discover } from '../registry/discover.js';

/** Snapshot, never throwing: for callers whose own work must not fail on it. */
export function snapshotQuietly(ctx: Context): void {
  try {
    takeSnapshot(ctx);
  } catch {
    // The next change or hook snapshots again.
  }
}

/** Manage sessions found running an agent, and snapshot when there were any. */
export function adoptDiscovered(ctx: Context): string[] {
  const found = discover(ctx);
  if (found.length) snapshotQuietly(ctx);
  return found;
}

/**
 * Record every managed live session, and carry forward the sessions still
 * waiting to be restored (spec §5.3): those the previous snapshot saw in an
 * earlier tmux server, gone since because that server ended, and not
 * forgotten. A session missing from the same server ended on purpose (exit,
 * kill) and is dropped. Returns the snapshot directory.
 */
export function takeSnapshot(ctx: Context, now?: Date, forget: readonly string[] = [], pending: readonly SnapshotSession[] = []): string {
  return withLock(ctx.config.stateDir, () => collectSnapshot(ctx, now ?? new Date(), forget, pending));
}

function collectSnapshot(ctx: Context, now: Date, forget: readonly string[], pending: readonly SnapshotSession[]): string {
  const sessions: SnapshotSession[] = [];
  watchClosures(ctx);
  discover(ctx);
  const live = ctx.tmux.listSessions();
  const serverStart = live[0]?.serverStart;
  const previous = ctx.store.newest();
  const collisions = new Set(live.filter((session) => nameCollision(ctx, session, previous?.sessions ?? [])).map((session) => session.name));
  for (const s of live) {
    if (!s.meta.agent || collisions.has(s.name)) continue;
    const cwd = s.meta.cwd ?? s.path;
    const conversation = s.meta.conversation ?? '';
    sessions.push({ profile: readProfile(s.meta.agent, s.meta.profile), ...recoveryStatus(ctx.tmux, s.name, s.meta), ...(s.meta.ownerWorkspace ? { ownerWorkspace: s.meta.ownerWorkspace } : {}), name: s.name, cwd, agent: s.meta.agent, argv: s.meta.argv ?? '', argvVerified: s.meta.argvVerified === '1', conversation, origin: s.meta.origin ?? 'none', serverStart: s.serverStart, sessionId: s.sessionId, ...(s.meta.bindingIssue ? { bindingIssue: s.meta.bindingIssue } : {}) });
  }
  const liveNames = new Set(live.filter((s) => !collisions.has(s.name)).map((s) => s.name));
  const pendingNames = new Set(pending.map((session) => session.name));
  const records = [...pending, ...(previous?.sessions ?? []).filter((session) => !pendingNames.has(session.name))];
  for (const old of records) {
    if (liveNames.has(old.name) || forget.includes(old.name) || (!pendingNames.has(old.name) && wasClosed(ctx, old))) continue;
    // Older snapshots do not say which server they saw: keep the old behaviour.
    if (!pendingNames.has(old.name) && !collisions.has(old.name) && !old.retained && old.recovery !== 'failed' && (!old.serverStart || old.serverStart === serverStart)) continue;
    sessions.push(collisions.has(old.name) || pendingNames.has(old.name) ? { ...old, retained: true } : old);
  }
  const scrollback = Object.fromEntries(sessions.flatMap((session): [string, string][] => {
    if (liveNames.has(session.name)) {
      return [[session.name, ctx.tmux.capturePane(session.name, ctx.config.scrollbackLines)]];
    }
    const text = previous ? ctx.store.optionalScrollback(previous.dir, session.name) : undefined;
    return text === undefined ? [] : [[session.name, text]];
  }));
  const dir = ctx.store.write(sessions, scrollback, now);
  ctx.store.prune(ctx.config.retention);
  return dir;
}
