import { appendFileSync } from 'node:fs';
import type { Context } from '../context.js';
import { stamp } from '../registry/sessions.js';
import { isIterm2, presentState } from './state.js';

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
}
