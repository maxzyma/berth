import type { Context } from '../context.js';
import type { SnapshotSession } from './store.js';

/** Record every managed live session; returns the snapshot directory. */
export function takeSnapshot(ctx: Context, now = new Date()): string {
  const sessions: SnapshotSession[] = [];
  const scrollback: Record<string, string> = {};
  for (const s of ctx.tmux.listSessions()) {
    if (!s.meta.agent) continue;
    sessions.push({
      name: s.name,
      cwd: s.meta.cwd ?? s.path,
      agent: s.meta.agent,
      argv: s.meta.argv ?? '',
      conversation: s.meta.conversation ?? '',
      origin: s.meta.origin ?? 'none',
    });
    scrollback[s.name] = ctx.tmux.capturePane(s.name, ctx.config.scrollbackLines);
  }
  const dir = ctx.store.write(sessions, scrollback, now);
  ctx.store.prune(ctx.config.retention);
  return dir;
}
