import type { Context } from '../context.js';
import { BerthError } from '../errors.js';
import { watchClosures } from '../snapshot/lifecycle.js';
import { sameDirectory } from './directory.js';
import { shellQuote } from '../shell.js';

/** Stage identity before execution, and clean up only this attempt's immutable session. */
export function withPlaceholder<T>(ctx: Context, name: string, cwd: string, start: () => T): T {
  const idle = `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} -e ${shellQuote('setInterval(() => {}, 3600000)')}`;
  const sessionId = ctx.tmux.newSession(name, cwd, idle);
  try {
    watchClosures(ctx);
    if (!sameDirectory(ctx.tmux.paneCurrentPath(name) ?? '', cwd)) {
      throw new BerthError('Terminal did not start in the requested folder.');
    }
    return start();
  } catch (error) {
    const current = ctx.tmux.run(['display-message', '-p', '-t', `=${name}:`, '#{session_id}'], true);
    if (current.ok && current.stdout.trim() === sessionId) {
      try { ctx.tmux.killSession(name); }
      catch {
        ctx.tmux.setMeta(name, { recovery: 'failed', recoveryDetail: `Launch failed: ${(error as Error).message}` });
      }
    }
    throw error;
  }
}

/** An omitted respawn repeats the staging command; an empty command exits immediately. */
export function startStagedPane(ctx: Context, name: string, command: string | undefined): void {
  const shell = command ? undefined : ctx.tmux.run(['show-options', '-gv', 'default-shell']).stdout.trim();
  if (!command && !shell) throw new BerthError('tmux has no configured default shell.');
  ctx.tmux.run(['respawn-pane', '-k', '-t', `=${name}:`, ...(command ? [command] : [shell!, '-l'])]);
}
