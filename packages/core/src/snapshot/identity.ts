import { createHash } from 'node:crypto';
import type { Context } from '../context.js';
import type { LiveSession } from '../tmux/client.js';
import type { SnapshotSession } from './store.js';
import { wasClosed } from './lifecycle.js';

export function recordIdentity(saved: SnapshotSession): string {
  return createHash('sha256').update(JSON.stringify([saved.serverStart, saved.sessionId, saved.name, saved.agent, saved.cwd, saved.conversation, saved.profile])).digest('hex');
}

export function sameSession(saved: SnapshotSession, live: LiveSession): boolean {
  if (live.meta.restoreSource === recordIdentity(saved) && live.meta.agent === saved.agent && (live.meta.conversation ?? '') === saved.conversation) return true;
  if (!saved.serverStart || saved.serverStart !== live.serverStart) return false;
  if (saved.sessionId) return saved.sessionId === live.sessionId;
  // Upgrade a legacy record only with matching lifetime and binding evidence.
  return saved.agent === live.meta.agent && saved.conversation === (live.meta.conversation ?? '');
}

export function nameCollision(ctx: Context, live: LiveSession, records: readonly SnapshotSession[]): SnapshotSession | undefined {
  return records.find((saved) => saved.name === live.name && !wasClosed(ctx, saved) && !sameSession(saved, live));
}
export const COLLISION_HINT = 'A stopped conversation reserves this name. Rename or end this live session to recover the saved conversation; its record has been preserved.';
