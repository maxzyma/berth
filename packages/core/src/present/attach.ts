import { withLock } from '../restore/lock.js';
import { createHash } from 'node:crypto';
import { profileEnvironment, readProfile } from '../agents/profile.js';
import { appendFileSync } from 'node:fs';
import type { Context } from '../context.js';
import { stamp } from '../registry/sessions.js';
import { clientsOf, isIterm2, presentState } from './state.js';
import { hookHint, hookStatus } from '../agents/hooks.js';
import { adoptDiscovered } from '../snapshot/take.js';
import { formatFields, readFields } from '../tmux/fields.js';

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

function namedClient(ctx: Context, name: string): AttachedClient | undefined {
  const result = ctx.tmux.run(['list-clients', '-F', formatFields(['client_name', 'session_name', 'client_tty', 'client_termtype'])], true);
  if (!result.ok) return undefined;
  const found = readFields(result.stdout, 4).find(([clientName]) => clientName === name);
  if (!found) return undefined;
  const [, session, tty, termtype] = found;
  return { session, tty, termtype };
}

/** Terminal identification may arrive after client-attached; never hold the state lock while waiting. */
export function clientAttachedWhenReady(ctx: Context, name: string): void {
  if (!name) return;
  const deadline = Date.now() + 5000;
  for (;;) {
    const client = namedClient(ctx, name);
    if (!client) return;
    if (client.termtype || Date.now() >= deadline) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  clientAttached(ctx, { name });
}

/**
 * A client attached to a session, or switched to one (tmux hooks
 * client-attached / client-session-changed). For iTerm2 the pane is marked
 * with the session's name and the session's origin becomes iterm2; every
 * client is shown the session's current state.
 */
export function clientAttached(ctx: Context, client: AttachedClient | { name: string }): void {
  withLock(ctx.config.stateDir, () => {
    if (!('name' in client)) return attachCurrentClient(ctx, client);
    if (!client.name) return;
    const found = namedClient(ctx, client.name);
    if (found) attachCurrentClient(ctx, found);
  }, 3000);
}

function attachCurrentClient(ctx: Context, event: AttachedClient): void {
  const current = clientsOf(ctx.tmux, event.session).find((client) => client.tty === event.tty);
  if (!current) return;
  const client = { ...current, session: event.session };
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
  if (live.meta.origin !== 'vscode') hintHooksOnce(ctx, live.meta.agent, client.tty, live.meta.profile);
}

const HINT_SECONDS = 10;

/**
 * Terminals other than VS Code (which asks in its own UI) get the hooks hint
 * in tmux's status line, once per agent per tmux server.
 */
function hintHooksOnce(ctx: Context, agent: string, tty: string, rawProfile?: string): void {
  const profile = readProfile(agent, rawProfile);
  if (!profile || hookStatus(agent, profileEnvironment(agent, profile, ctx.env)) !== 'missing') return;
  const key = createHash('sha256').update(JSON.stringify(profile.environment)).digest('hex').slice(0, 12);
  const flag = `@berth_hinted_${agent}_${key}`;
  if (ctx.tmux.run(['show-option', '-gqv', flag], true).stdout.trim()) return;
  ctx.tmux.run(['set-option', '-g', flag, '1'], true);
  ctx.tmux.run(['display-message', '-c', tty, '-d', String(HINT_SECONDS * 1000), hookHint(agent)], true);
}
