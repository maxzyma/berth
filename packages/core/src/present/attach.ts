import { appendFileSync } from 'node:fs';
import type { Context } from '../context.js';
import { stamp } from '../registry/sessions.js';
import { isIterm2, presentState } from './state.js';
import { hookHint, hookStatus } from '../agents/hooks.js';
import { adoptDiscovered } from '../snapshot/take.js';

/** iTerm2 user variable naming the session a pane shows (spec §7.3). */
export const PANE_VARIABLE = 'berthSession';

export function setUserVar(name: string, value: string): string {
  return `\x1b]1337;SetUserVar=${name}=${Buffer.from(value).toString('base64')}\x07`;
}

export interface AttachedClient {
  session: string;
  tty: string;
  termtype: string;
}

/**
 * A client attached to a session, or switched to one (tmux hooks
 * client-attached / client-session-changed). For iTerm2 the pane is marked
 * with the session's name and the session's origin becomes iterm2; every
 * client is shown the session's current state.
 */
export function clientAttached(ctx: Context, client: AttachedClient): void {
  adoptDiscovered(ctx);
  const live = ctx.tmux.listSessions().find((s) => s.name === client.session);
  if (!live?.meta.agent) return;
  if (isIterm2(client.termtype)) {
    try {
      appendFileSync(client.tty, setUserVar(PANE_VARIABLE, client.session));
    } catch {
      // The client went away; nothing to mark.
    }
    if (live.meta.origin !== 'iterm2') stamp(ctx, client.session, { origin: 'iterm2' });
  }
  presentState(ctx.tmux, client.session, live.meta.state ?? '', { note: live.meta.note, clients: [{ tty: client.tty, termtype: client.termtype }] });
  if (live.meta.origin !== 'vscode') hintHooksOnce(ctx, live.meta.agent, client.tty);
}

const HINT_SECONDS = 10;

/**
 * Terminals other than VS Code (which asks in its own UI) get the hooks hint
 * in tmux's status line, once per agent per tmux server.
 */
function hintHooksOnce(ctx: Context, agent: string, tty: string): void {
  if (hookStatus(agent, ctx.env) !== 'missing') return;
  const flag = `@berth_hinted_${agent}`;
  if (ctx.tmux.run(['show-option', '-gqv', flag], true).stdout.trim()) return;
  ctx.tmux.run(['set-option', '-g', flag, '1'], true);
  ctx.tmux.run(['display-message', '-c', tty, '-d', String(HINT_SECONDS * 1000), hookHint(agent)], true);
}
