import { hookActivityTiming } from './activity-timing.js';
import { copilotCursor } from './copilot-state.js';
import { lateBindingId } from './late-binding.js';
import { geminiCursor } from './gemini-state.js';
import { processLifetime } from '../process-owner.js';
import { captureProfile, profileKey, readProfile } from './profile.js';
import { withLock } from '../restore/lock.js';
import { BerthError, ExitCode } from '../errors.js';
import { shellQuote } from '../shell.js';
import { Tmux } from '../tmux/client.js';
import { presentState } from '../present/state.js';
import { createContext } from '../context.js';
import { discover, processes, sessionProducers, PRODUCER_CHANGED, BINDING_UNVERIFIED } from '../registry/discover.js';
import { snapshotQuietly } from '../snapshot/take.js';
import { nameConversation } from './naming.js';
import { requireAdapter } from './commands.js';
import { getAdapter, stateForEvent, type Adapter } from './registry.js';
import { inspectHooks } from './hook-health.js';
import { hookFormat, MARKER } from './hook-files.js';

function hookEvents(adapter: Adapter): string[] {
  return [...new Set(Object.values(adapter.events).flat())];
}

function targetOf(adapter: Adapter) {
  if (!adapter.hookTarget) throw new BerthError(`${adapter.displayName} has no hook integration`, ExitCode.usage);
  return adapter.hookTarget;
}

/** Command an agent runs for an event: `BERTH_HOOK=1 <node> <cli> hook <agent> <event>`. */
export function hookCommand(cliPath: string, agent: string, event: string): string {
  const runtimeMode = process.env.ELECTRON_RUN_AS_NODE === '1' ? 'ELECTRON_RUN_AS_NODE=1 ' : '';
  return `${MARKER} ${runtimeMode}${shellQuote(process.execPath)} ${shellQuote(cliPath)} hook ${agent} ${shellQuote(event)}`;
}

export function installHooks(agentId: string, cliPath: string, env = process.env): string {
  const adapter = requireAdapter(agentId);
  const format = hookFormat(targetOf(adapter), cliPath);
  const file = format.file(env);
  format.install(file, hookEvents(adapter), (event) => hookCommand(cliPath, adapter.id, event), adapter);
  if (inspectHooks(adapter, env) !== 'installed') throw new BerthError(`Hooks were written to ${file}, but configuration remains incomplete, disabled, or its runtime is unavailable. Inspect this file before retrying.`);
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
  return inspectHooks(adapter, env) === 'installed';
}

export type HookStatus = 'installed' | 'missing' | 'broken' | 'none' | 'unknown';

/** Whether an agent's hooks are installed; `none` when Berth has no hooks for it. */
export function hookStatus(agentId: string, env = process.env): HookStatus {
  const adapter = getAdapter(agentId);
  if (!adapter?.hookTarget) return 'none';
  try {
    return inspectHooks(adapter, env);
  } catch {
    return 'missing';
  }
}

/** Agent-owned activation that writing a hook file cannot complete. */
export function hookSetupGuidance(agentId: string): string | undefined {
  return agentId === 'codex'
    ? 'Codex manages hook trust in /hooks. Review new or changed Berth hooks there before they can run.'
    : undefined;
}

export function hookInstallNotice(agentId: string, file: string): string {
  const name = getAdapter(agentId)?.displayName ?? agentId;
  return `Berth: ${name} hook configuration installed (${file}).${hookSetupGuidance(agentId) ? ` ${hookSetupGuidance(agentId)}` : ''}`;
}

/** What a user is told when an agent in use has no hooks (spec §4.2). */
export function hookHint(agentId: string): string {
  const name = getAdapter(agentId)?.displayName ?? agentId;
  return `Berth: ${name} hooks are not installed. State updates and future conversation binding may be unavailable. Run: berth hooks install ${agentId}`;
}

/** What a hook event changes on the session, or nothing when the event does not matter. */
export function metaForEvent(adapter: Adapter, event: string, payload: Record<string, unknown>): Record<string, string> {
  const meta: Record<string, string> = {};
  const id = payload.session_id ?? payload.sessionId ?? payload.sessionID ?? payload.conversation_id;
  if (adapter.events.start.includes(event) && typeof id === 'string' && id) meta.conversation = id;
  let state = stateForEvent(adapter, event);
  // Some agents also notify for idle reminders; only a permission request means waiting.
  if (state === 'waiting' && adapter.waitingWhen && !adapter.waitingWhen(payload, event)) state = undefined;
  if (state !== undefined && adapter.idleWhen?.(event, payload)) state = '';
  if (state !== undefined) meta.state = state;
  // Latest notification text, shown in session lists (spec §6). A new state
  // replaces it, so a finished session never shows an old permission request.
  if (state !== undefined) {
    const input = payload.tool_input;
    const description = input && typeof input === 'object' && 'description' in input ? input.description : undefined;
    const message = typeof payload.message === 'string' && payload.message.trim() ? payload.message
      : state === 'waiting' && typeof description === 'string' ? description
        : state === 'waiting' && typeof payload.tool_name === 'string' ? `Approval requested: ${payload.tool_name}` : '';
    meta.note = state === '' ? '' : message.trim().slice(0, 200);
  }
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
/** What a hook returns to its agent, beyond the session metadata it records. */
export interface HookReply { sessionTitle?: string }

/** A SessionStart title applies only for these sources (Claude Code hooks reference). */
const TITLE_SOURCES = ['startup', 'resume', 'fork'];

export function handleHook(agentId: string, event: string, stdin: string, env = process.env, reply: HookReply = {}): Record<string, string> {
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
    let meta = metaForEvent(adapter, event, payload);
    const lateId = lateBindingId(agentId, event, payload);
    if (Object.keys(meta).length === 0) return {};
    const tmux = new Tmux({ bin: env.BERTH_TMUX || 'tmux', socketPath });
    const session = tmux.sessionOfPane(pane);
    if (!session) return {};
    const ctx = createContext({ ...env, BERTH_TMUX_SOCKET_PATH: socketPath });
    const recorded = withLock(ctx.config.stateDir, () => {
      let live = tmux.listSessions().find((s) => s.name === session);
      const table = processes();
      const producers = sessionProducers(ctx, session, table);
      const ancestors: number[] = [];
      for (let pid = process.pid; pid > 1 && ancestors.length < 64 && !ancestors.includes(pid);) {
        ancestors.push(pid);
        pid = table.find((p) => p.pid === pid)?.ppid ?? 0;
      }
      if (!live?.meta.agent || live.meta.agent === 'shell') {
        const producer = producers[0];
        if (!ctx.config.autoAdopt || (!adapter.events.start.includes(event) && !lateId) || producers.length !== 1
          || producer.agent !== agentId || producer.pane !== pane || !ancestors.includes(producer.pid)) return {};
        discover(ctx);
        live = tmux.listSessions().find((s) => s.name === session);
      }
      if (!live?.meta.agent) return {};
      if (agentId === 'gemini' && event === 'BeforeModel' && live.meta.state !== 'waiting') return {};
      if (live.meta.agent !== agentId) {
        tmux.setMeta(session, { bindingIssue: 'Agent producer changed. Verify the conversation before restoring.' });
        snapshotQuietly(ctx);
        return {};
      }
      const otherPane = live.meta.producerPane && live.meta.producerPane !== pane;
      if (producers.length > 1 || otherPane) {
        tmux.setMeta(session, { bindingIssue: 'Multiple independent agents. Move each agent to its own tmux session before restoring.' });
        snapshotQuietly(ctx);
        return {};
      }
      const producer = producers[0];
      if (producer) {
        if (producer.agent !== agentId || producer.pane !== pane || !ancestors.includes(producer.pid)) return {};
      }
      if (!producer && (!live.meta.recovery || live.meta.recovery === 'confirmed') && meta.conversation && live.meta.conversation && meta.conversation !== live.meta.conversation) {
        tmux.setMeta(session, { bindingIssue: 'Cannot verify the producer of a different conversation. Inspect the agent and re-adopt before restoring.' });
        snapshotQuietly(ctx);
        return {};
      }
      const payloadId = payload.session_id ?? payload.sessionId ?? payload.sessionID ?? payload.conversation_id;
      if (!adapter.events.start.includes(event) && typeof payloadId === 'string' && live.meta.conversation && payloadId !== live.meta.conversation) return {};
      if (producer && lateId && !live.meta.conversation && (!live.meta.recovery || live.meta.recovery === 'confirmed')
        && (!live.meta.bindingIssue || [PRODUCER_CHANGED, BINDING_UNVERIFIED].includes(live.meta.bindingIssue))) {
        const existingProfile = readProfile(agentId, live.meta.profile);
        const observedProfile = captureProfile(agentId, env);
        if (live.meta.profile && (!existingProfile || profileKey(agentId, existingProfile) !== profileKey(agentId, observedProfile))) return {};
        meta = { ...meta, conversation: lateId };
      }
      // Claim once in tmux, so simultaneous first hooks cannot both own the row.
      tmux.run(['set-option', '-o', '-t', `=${session}:`, '@berth_producerPane', pane], true);
      const owner = tmux.run(['display-message', '-p', '-t', `=${session}:`, '#{@berth_producerPane}'], true).stdout.trim();
      if (owner !== pane) {
        tmux.setMeta(session, { bindingIssue: 'Another pane owns this conversation. Separate agents before restoring.' });
        snapshotQuietly(ctx);
        return {};
      }
      const confirmsExisting = !!producer && typeof payloadId === 'string' && !!live.meta.conversation && payloadId === live.meta.conversation;
      const profile = meta.conversation || (confirmsExisting && !live.meta.profile) ? captureProfile(agentId, env) : undefined;
      if (live.meta.recovery && live.meta.recovery !== 'confirmed' && meta.conversation) {
        const expectedProfile = readProfile(agentId, live.meta.profile);
        if (profile && expectedProfile && profileKey(agentId, profile) !== profileKey(agentId, expectedProfile)) {
          tmux.setMeta(session, { recovery: 'failed', recoveryDetail: 'Agent opened a different profile. The expected conversation and profile were preserved.' });
          snapshotQuietly(ctx);
          return {};
        }
        if (meta.conversation !== live.meta.conversation) {
          tmux.setMeta(session, { recovery: 'failed', recoveryDetail: 'Agent opened a different conversation. Inspect the terminal; the expected ID was preserved.' });
          snapshotQuietly(ctx);
          return {};
        }
        const dead = tmux.run(['display-message', '-p', '-t', pane, '#{pane_dead}'], true).stdout.trim();
        if (dead === '1') return {};
        tmux.setMeta(session, { recovery: 'confirmed', recoveryDetail: '' });
        tmux.run(['set-option', '-w', '-t', `=${session}:`, 'remain-on-exit', 'off']);
      }
      tmux.setMeta(session, {
        ...meta, producerPane: pane,
        ...(meta.state !== undefined ? { activityTiming: hookActivityTiming(
          meta.conversation && meta.conversation !== live.meta.conversation ? undefined : live.meta.activityTiming,
          live.meta.state || '', meta.state, meta.topic !== undefined,
        ) } : meta.conversation && meta.conversation !== live.meta.conversation ? { activityTiming: '' } : {}),
        ...(agentId === 'gemini' && event === 'BeforeAgent' ? {
          nativeTranscript: producer ? geminiCursor(payload.transcript_path, meta.conversation || live.meta.conversation || '', env) : '',
        } : agentId === 'copilot' && event === 'userPromptSubmitted' ? {
          nativeTranscript: producer ? copilotCursor(meta.conversation || live.meta.conversation || '', env) : '',
        } : ['gemini', 'copilot'].includes(agentId) && adapter.events.start.includes(event) ? { nativeTranscript: '' } : {}),
        ...(producer ? { producerLifetime: processLifetime(producer.pid)?.key } : {}),
        ...(producer && (meta.conversation || (typeof payloadId === 'string' && payloadId === live.meta.conversation)) && (live.meta.bindingIssue === PRODUCER_CHANGED || live.meta.bindingIssue === BINDING_UNVERIFIED) ? { bindingIssue: '' } : {}),
        ...(profile ? { profile: JSON.stringify(profile) } : {}),
      });
      if (meta.state !== undefined) presentState(tmux, session, meta.state, { note: meta.note });
      // Hook naming (spec §4.2.1): a pending rename rides on the next hook that accepts a title.
      if (live.meta.nameSync && adapter.naming?.hook?.events.includes(event)
        && (event !== 'SessionStart' || TITLE_SOURCES.includes(String(payload.source ?? 'startup')))) {
        if (payload.session_title !== session) reply.sessionTitle = session;
        tmux.setMeta(session, { nameSync: '' });
      }
      // A new conversation id must reach the snapshot before any reboot.
      if (meta.conversation || (confirmsExisting && (profile || live.meta.bindingIssue === PRODUCER_CHANGED || live.meta.bindingIssue === BINDING_UNVERIFIED))) {
        snapshotQuietly(ctx);
      }
      return meta;
    });
    // Protocol naming retries a pending rename once the agent is active again.
    if (adapter.naming?.protocol) void nameConversation(ctx, session).catch(() => false);
    return recorded;
  } catch {
    return {};
  }
}
