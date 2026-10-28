import type { Context } from '../context.js';
import type { SnapshotSession } from './store.js';
import { claudeConversationByName } from '../agents/claude-name.js';

/** Record every managed live session; returns the snapshot directory. */
/** Snapshot, never throwing: for callers whose own work must not fail on it. */
export function snapshotQuietly(ctx: Context): void {
  try {
    takeSnapshot(ctx);
  } catch {
    // The next change or hook snapshots again.
  }
}

export function takeSnapshot(ctx: Context, now = new Date()): string {
  const sessions: SnapshotSession[] = [];
  const scrollback: Record<string, string> = {};
  for (const s of ctx.tmux.listSessions()) {
    if (!s.meta.agent) continue;
    const cwd = s.meta.cwd ?? s.path;
    let conversation = s.meta.conversation ?? '';
    // No hook-reported id: fall back to the name key (spec §4.2).
    if (!conversation && s.meta.agent === 'claude') {
      conversation = claudeConversationByName(cwd, s.name) ?? '';
      if (conversation) ctx.tmux.setMeta(s.name, { conversation });
    }
    sessions.push({ name: s.name, cwd, agent: s.meta.agent, argv: s.meta.argv ?? '', conversation, origin: s.meta.origin ?? 'none' });
    scrollback[s.name] = ctx.tmux.capturePane(s.name, ctx.config.scrollbackLines);
  }
  const dir = ctx.store.write(sessions, scrollback, now);
  ctx.store.prune(ctx.config.retention);
  return dir;
}
