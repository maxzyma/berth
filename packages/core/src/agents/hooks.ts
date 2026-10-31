import { BerthError, ExitCode } from '../errors.js';
import { shellQuote } from '../shell.js';
import { Tmux } from '../tmux/client.js';
import { presentState } from '../present/state.js';
import { createContext } from '../context.js';
import { snapshotQuietly } from '../snapshot/take.js';
import { requireAdapter } from './commands.js';
import { getAdapter, stateForEvent, type Adapter } from './registry.js';
import { containsBerth, hookFormat, MARKER } from './hook-files.js';

function hookEvents(adapter: Adapter): string[] {
  const { start, working, waiting, done } = adapter.events;
  return [...new Set([...start, ...working, ...waiting, ...done])];
}

function targetOf(adapter: Adapter) {
  if (!adapter.hookTarget) throw new BerthError(`${adapter.displayName} has no hook integration`, ExitCode.usage);
  return adapter.hookTarget;
}

/** Command an agent runs for an event: `BERTH_HOOK=1 <node> <cli> hook <agent> <event>`. */
export function hookCommand(cliPath: string, agent: string, event: string): string {
  return `${MARKER} ${shellQuote(process.execPath)} ${shellQuote(cliPath)} hook ${agent} ${shellQuote(event)}`;
}

export function installHooks(agentId: string, cliPath: string, env = process.env): string {
  const adapter = requireAdapter(agentId);
  const format = hookFormat(targetOf(adapter), cliPath);
  const file = format.file(env);
  format.install(file, hookEvents(adapter), (event) => hookCommand(cliPath, adapter.id, event), adapter);
  return file;
}

export function uninstallHooks(agentId: string, env = process.env): string {
  const format = hookFormat(targetOf(requireAdapter(agentId)));
  const file = format.file(env);
  format.uninstall(file);
  return file;
}

export function hooksInstalled(agentId: string, env = process.env): boolean {
  const adapter = requireAdapter(agentId);
  if (!adapter.hookTarget) return false;
  return containsBerth(hookFormat(adapter.hookTarget).file(env));
}

export type HookStatus = 'installed' | 'missing' | 'none';

/** Whether an agent's hooks are installed; `none` when Berth has no hooks for it. */
export function hookStatus(agentId: string, env = process.env): HookStatus {
  const adapter = getAdapter(agentId);
  if (!adapter?.hookTarget) return 'none';
  try {
    return hooksInstalled(agentId, env) ? 'installed' : 'missing';
  } catch {
    return 'missing';
  }
}

/** What a user is told when an agent in use has no hooks (spec §4.2). */
export function hookHint(agentId: string): string {
  const name = getAdapter(agentId)?.displayName ?? agentId;
  return `Berth: ${name} hooks are not installed, so after a restart this session starts a new conversation. Run: berth hooks install ${agentId}`;
}

/** What a hook event changes on the session, or nothing when the event does not matter. */
export function metaForEvent(adapter: Adapter, event: string, payload: Record<string, unknown>): Record<string, string> {
  const meta: Record<string, string> = {};
  const id = payload.session_id ?? payload.sessionId ?? payload.sessionID ?? payload.conversation_id;
  if (adapter.events.start.includes(event) && typeof id === 'string' && id) meta.conversation = id;
  let state = stateForEvent(adapter, event);
  // Some agents also notify for idle reminders; only a permission request means waiting.
  if (state === 'waiting' && adapter.waitingWhen && !adapter.waitingWhen(payload)) state = undefined;
  if (state) meta.state = state;
  // Latest notification text, shown in session lists (spec §6). A new state
  // replaces it, so a finished session never shows an old permission request.
  if (state) meta.note = typeof payload.message === 'string' ? payload.message.trim().slice(0, 200) : '';
  // The session's subtitle: the first line of the prompt the user just sent (spec §4.2).
  // Text the agent injects itself (`<task-notification>`, `<command-name>`…) is not the user's.
  if (state === 'working' && typeof payload.prompt === 'string' && !/^\s*<[a-z][\w-]*[\s>]/i.test(payload.prompt)) {
    // Attachment placeholders such as `[Image #3]` say nothing about the topic.
    const first = payload.prompt
      .split('\n')
      .map((l) => l.replace(/\[(Image|Pasted text) #\d+[^\]]*\]/g, '').replace(/\s+/g, ' ').trim())
      .find(Boolean);
    if (first) meta.topic = first.slice(0, 120);
  }
  return meta;
}

/**
 * Handle `berth hook <agent> <event>` inside an agent's pane. Never fails the
 * agent: problems are swallowed and the function returns what it stamped.
 */
export function handleHook(agentId: string, event: string, stdin: string, env = process.env): Record<string, string> {
  try {
    const adapter = requireAdapter(agentId);
    const pane = env.TMUX_PANE;
    const socketPath = env.TMUX?.split(',')[0];
    if (!pane || !socketPath) return {};
    let payload: Record<string, unknown> = {};
    try {
      payload = stdin.trim() ? (JSON.parse(stdin) as Record<string, unknown>) : {};
    } catch {
      payload = {};
    }
    const meta = metaForEvent(adapter, event, payload);
    if (Object.keys(meta).length === 0) return {};
    const tmux = new Tmux({ bin: env.BERTH_TMUX || 'tmux', socketPath });
    const session = tmux.sessionOfPane(pane);
    if (!session) return {};
    tmux.setMeta(session, meta);
    if (meta.state) presentState(tmux, session, meta.state, { note: meta.note });
    // A new conversation id must reach the snapshot before any reboot.
    if (meta.conversation) {
      const ctx = createContext({ ...env, BERTH_TMUX_SOCKET_PATH: socketPath });
      snapshotQuietly(ctx);
    }
    return meta;
  } catch {
    return {};
  }
}
