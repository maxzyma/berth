import type { Context } from '../context.js';
import type { SnapshotSession } from './store.js';
import { conversationByName } from '../agents/name-key.js';
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
export function takeSnapshot(ctx: Context, now = new Date(), forget: readonly string[] = []): string {
  const sessions: SnapshotSession[] = [];
  const scrollback: Record<string, string> = {};
  discover(ctx);
  const live = ctx.tmux.listSessions();
  const serverStart = live[0]?.serverStart;
  for (const s of live) {
    if (!s.meta.agent) continue;
    const cwd = s.meta.cwd ?? s.path;
    let conversation = s.meta.conversation ?? '';
    // No hook-reported id: fall back to the name key (spec §4.2).
    if (!conversation) {
      conversation = conversationByName(s.meta.agent, cwd, s.name) ?? '';
      if (conversation) ctx.tmux.setMeta(s.name, { conversation });
    }
    sessions.push({ name: s.name, cwd, agent: s.meta.agent, argv: s.meta.argv ?? '', conversation, origin: s.meta.origin ?? 'none', serverStart: s.serverStart });
    scrollback[s.name] = ctx.tmux.capturePane(s.name, ctx.config.scrollbackLines);
  }
  const liveNames = new Set(live.map((s) => s.name));
  const previous = ctx.store.newest();
  for (const old of previous?.sessions ?? []) {
    if (liveNames.has(old.name) || forget.includes(old.name)) continue;
    // Older snapshots do not say which server they saw: keep the old behaviour.
    if (!old.serverStart || old.serverStart === serverStart) continue;
    sessions.push(old);
    try {
      scrollback[old.name] = ctx.store.scrollback(previous!.dir, old.name);
    } catch {
      // No saved scrollback; the session still comes back.
    }
  }
  const dir = ctx.store.write(sessions, scrollback, now);
  ctx.store.prune(ctx.config.retention);
  return dir;
}
