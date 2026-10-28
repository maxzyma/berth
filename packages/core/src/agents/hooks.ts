import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { BerthError, ExitCode } from '../errors.js';
import { shellQuote } from '../shell.js';
import { Tmux } from '../tmux/client.js';
import { presentState } from '../present/state.js';
import { createContext } from '../context.js';
import { snapshotQuietly } from '../snapshot/take.js';
import { requireAdapter } from './commands.js';
import { stateForEvent, type Adapter } from './registry.js';

/** Marker that identifies hook entries written by Berth. */
const MARKER = 'BERTH_HOOK=1';

interface HookCommand { type: string; command: string }
interface HookGroup { matcher?: string; hooks: HookCommand[] }
type HookFile = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>;

function hookFile(adapter: Adapter, env: Record<string, string | undefined>): string {
  const home = env.HOME || homedir();
  switch (adapter.hookTarget) {
    case 'claude-settings':
      return join(home, '.claude', 'settings.json');
    case 'codex-hooks':
      return join(home, '.codex', 'hooks.json');
    default:
      throw new BerthError(`${adapter.displayName} has no hook integration in Berth yet`, ExitCode.usage);
  }
}

function hookEvents(adapter: Adapter): string[] {
  const { start, working, waiting, done } = adapter.events;
  return [...new Set([...start, ...working, ...waiting, ...done])];
}

function readHooks(file: string): HookFile {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as HookFile;
  } catch (error) {
    throw new BerthError(`cannot parse ${file}: ${(error as Error).message}`);
  }
}

function withoutBerth(groups: HookGroup[] = []): HookGroup[] {
  return groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !h.command?.includes(MARKER)) }))
    .filter((g) => g.hooks.length > 0);
}

function writeHooks(file: string, data: HookFile): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Command an agent runs for an event: `BERTH_HOOK=1 <node> <cli> hook <agent> <event>`. */
export function hookCommand(cliPath: string, agent: string, event: string): string {
  return `${MARKER} ${shellQuote(process.execPath)} ${shellQuote(cliPath)} hook ${agent} ${shellQuote(event)}`;
}

export function installHooks(agentId: string, cliPath: string, env = process.env): string {
  const adapter = requireAdapter(agentId);
  const file = hookFile(adapter, env);
  const data = readHooks(file);
  const hooks: Record<string, HookGroup[]> = { ...(data.hooks ?? {}) };
  for (const event of hookEvents(adapter)) {
    hooks[event] = [...withoutBerth(hooks[event]), { hooks: [{ type: 'command', command: hookCommand(cliPath, adapter.id, event) }] }];
  }
  writeHooks(file, { ...data, hooks });
  return file;
}

export function uninstallHooks(agentId: string, env = process.env): string {
  const adapter = requireAdapter(agentId);
  const file = hookFile(adapter, env);
  if (!existsSync(file)) return file;
  const data = readHooks(file);
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(data.hooks ?? {})) {
    const kept = withoutBerth(groups);
    if (kept.length > 0) hooks[event] = kept;
  }
  writeHooks(file, { ...data, hooks });
  return file;
}

export function hooksInstalled(agentId: string, env = process.env): boolean {
  const adapter = requireAdapter(agentId);
  if (!adapter.hookTarget) return false;
  const data = readHooks(hookFile(adapter, env));
  return Object.values(data.hooks ?? {}).some((groups) => groups.some((g) => g.hooks?.some((h) => h.command?.includes(MARKER))));
}

/** What a hook event changes on the session, or nothing when the event does not matter. */
export function metaForEvent(adapter: Adapter, event: string, payload: Record<string, unknown>): Record<string, string> {
  const meta: Record<string, string> = {};
  const id = payload.session_id ?? payload.sessionID ?? payload.conversation_id;
  if (adapter.events.start.includes(event) && typeof id === 'string' && id) meta.conversation = id;
  let state = stateForEvent(adapter, event);
  // Claude Code also sends Notification for an idle reminder; only a permission request means waiting.
  if (adapter.id === 'claude' && event === 'Notification' && !/permission/i.test(String(payload.message ?? ''))) state = undefined;
  if (state) meta.state = state;
  // Latest notification text, shown in session lists (spec §6).
  if (state && typeof payload.message === 'string' && payload.message.trim()) meta.note = payload.message.trim().slice(0, 200);
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
