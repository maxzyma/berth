import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '../context.js';
import { shellQuote } from '../shell.js';
import { formatLiteral } from '../tmux/fields.js';

/** Runtime-only closure evidence survives the last session and server disappearing. */
export function watchClosures(ctx: Context): void {
  if (!ctx.tmux.serverRunning()) return;
  const directory = join(ctx.config.stateDir, 'closed');
  const installed = ctx.tmux.run(['show-option', '-gqv', '@berth_closure_directory'], true).stdout.trim();
  if (installed === directory) return;
  mkdirSync(directory, { recursive: true });
  const marker = `${formatLiteral(directory)}/#{start_time}-#{pid}-#{hook_session}`;
  const command = `: > ${shellQuote(marker)}`;
  try {
    ctx.tmux.run(['set-hook', '-g', 'session-closed[98]', `run-shell ${shellQuote(command)}`]);
    ctx.tmux.run(['set-option', '-g', '@berth_closure_directory', directory]);
  } catch (error) {
    if (ctx.tmux.serverRunning()) throw error;
  }
}

export function wasClosed(ctx: Context, session: { serverStart?: string; sessionId?: string }): boolean {
  if (!session.serverStart || !session.sessionId) return false;
  return existsSync(join(ctx.config.stateDir, 'closed', `${session.serverStart}-${session.sessionId}`));
}

/** A still-running owner can finish its closure hook before recovery is considered. */
export function serverOwnerAlive(ctx: Context, serverStart: string | undefined): boolean {
  if (!serverStart) return false;
  const current = ctx.tmux.run(['display-message', '-p', '#{start_time}-#{pid}'], true);
  return current.ok && current.stdout.trim() === serverStart;
}
