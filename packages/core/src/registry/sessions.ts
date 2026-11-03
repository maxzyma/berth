import { prepareNativeState, observeNativeState, applyNativeState } from './native-state.js';
import { processLifetime } from '../process-owner.js';
import { applyLaunchEnvironment, captureProfile, profileEnvironment, profileKey, readProfile, type AgentProfile } from '../agents/profile.js';
import { withLock } from '../restore/lock.js';
import { nameCollision, COLLISION_HINT } from '../snapshot/identity.js';
import { withPlaceholder } from './launch.js';
import { usableDirectory } from './directory.js';
import { wasClosed } from '../snapshot/lifecycle.js';
import { recoveryStatus, type RecoveryStatus } from '../restore/status.js';
import { profiledTitleLookup } from '../agents/titles.js';
import { connections, type ConnectionInfo } from '../tmux/connections.js';
import { basename, join } from 'node:path';
import type { Context } from '../context.js';
import { BerthError, ExitCode } from '../errors.js';
import { launchCommand, recoveryOptionsRequired, requireAdapter } from '../agents/commands.js';
import type { SessionMeta } from '../tmux/client.js';
import { hooksInstalled, hookStatus, hookSetupGuidance, type HookStatus } from '../agents/hooks.js';
import { registeredHosts } from './hosts.js';
import { discover, sessionProducers } from './discover.js';
import { getAdapter } from '../agents/registry.js';
import { snapshotQuietly, takeSnapshot } from '../snapshot/take.js';
import { presentState } from '../present/state.js';

/** One row of `berth ls` (implementation §2.2). */
export interface SessionRow extends RecoveryStatus {
  name: string;
  managed: boolean;
  agent: string;
  cwd: string;
  conversation: string;
  origin: string;
  state: string;
  note: string;
  /** First line of the user's latest prompt (spec §4.2). */
  topic: string;
  attachedClients: number;
  connections?: ConnectionInfo[];
  conversationTitle?: string;
  bindingIssue?: string;
  ownerWorkspace?: string;
  live: boolean;
  /** Whether the agent's Berth hooks are installed (spec §4.2). */
  hooks: HookStatus;
  hookSetup?: string;
  profile?: AgentProfile;
  recoveryOptionsRequired?: boolean;
}

export const ORIGINS = ['vscode', 'iterm2', 'none'] as const;

export function list(ctx: Context): SessionRow[] {
  const live = ctx.tmux.listSessions();
  const saved = ctx.store.newest()?.sessions ?? [];
  const title = profiledTitleLookup([...live.map((row) => ({ agent: row.meta.agent ?? '', conversation: row.meta.conversation ?? '', profile: readProfile(row.meta.agent ?? '', row.meta.profile) })), ...saved], ctx.env, join(ctx.config.stateDir, 'title-cache'));
  const clients = live.length ? connections(ctx.tmux, registeredHosts(ctx.config.stateDir), true) : new Map<string, ConnectionInfo[]>();
  const statuses = new Map<string, HookStatus>();
  const hooks = (agent: string, profile?: AgentProfile): HookStatus => {
    if (!agent || agent === 'shell') return 'none';
    if (!profile) return 'unknown';
    const key = profileKey(agent, profile);
    if (!statuses.has(key)) statuses.set(key, hookStatus(agent, profileEnvironment(agent, profile, ctx.env)));
    return statuses.get(key)!;
  };
  const rows: SessionRow[] = live.map((s) => ({
    name: s.name,
    profile: readProfile(s.meta.agent ?? '', s.meta.profile),
    ...recoveryStatus(ctx.tmux, s.name, s.meta),
    managed: Boolean(s.meta.agent),
    agent: s.meta.agent ?? '',
    cwd: s.meta.cwd ?? s.path,
    bindingIssue: nameCollision(ctx, s, saved) ? COLLISION_HINT : s.meta.bindingIssue,
    ownerWorkspace: s.meta.ownerWorkspace,
    conversation: s.meta.conversation ?? '',
    conversationTitle: title(s.meta.agent ?? '', s.meta.cwd ?? s.path, s.meta.conversation ?? '', readProfile(s.meta.agent ?? '', s.meta.profile)),
    origin: s.meta.origin ?? (s.meta.agent ? 'none' : ''),
    state: s.meta.state ?? '',
    note: s.meta.note ?? '',
    topic: s.meta.topic ?? '',
    attachedClients: clients.get(s.name)?.length ?? 0,
    connections: clients.get(s.name) ?? [],
    live: true,
    hooks: hooks(s.meta.agent ?? '', readProfile(s.meta.agent ?? '', s.meta.profile)),
  }));
  const liveNames = new Set(live.map((s) => s.name));
  for (const s of saved) {
    if (liveNames.has(s.name) || wasClosed(ctx, s)) continue;
    rows.push({ ...s, recoveryOptionsRequired: recoveryOptionsRequired(s.agent, s.argv, s.argvVerified), conversationTitle: title(s.agent, s.cwd, s.conversation, readProfile(s.agent, s.profile)), managed: true, state: '', note: '', topic: '', attachedClients: 0, live: false, hooks: hooks(s.agent, readProfile(s.agent, s.profile)) });
  }
  return rows.map((row) => row.hooks === 'installed' ? { ...row, hookSetup: hookSetupGuidance(row.agent) } : row);
}

/** Reconcile discovery and externally renamed live sessions before presenting inventory. */
export function inventory(ctx: Context): SessionRow[] {
  const candidates = withLock(ctx.config.stateDir, () => prepareNativeState(ctx));
  const observations = observeNativeState(ctx, candidates);
  return withLock(ctx.config.stateDir, () => {
    applyNativeState(ctx, observations);
    return inventoryLocked(ctx);
  });
}

function inventoryLocked(ctx: Context): SessionRow[] {
  const adopted = discover(ctx);
  const live = ctx.tmux.listSessions();
  const server = live[0]?.serverStart;
  const current = live.filter((session) => session.meta.agent).map((session) => session.name).sort();
  const saved = (ctx.store.newest()?.sessions ?? []).filter((session) => session.serverStart === server).map((session) => session.name).sort();
  if (adopted.length || (server && current.some((name) => !saved.includes(name)))) takeSnapshot(ctx);
  return list(ctx);
}

export function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'session';
}

/** Default name from the cwd's basename; suffix -2, -3, … on collision with any live session. */
export function uniqueName(ctx: Context, base: string): string {
  const taken = new Set([...ctx.tmux.listSessions(), ...(ctx.store.newest()?.sessions ?? [])].map((s) => s.name));
  const name = sanitizeName(base);
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name}-${n}`)) return `${name}-${n}`;
}

export function checkOrigin(origin: string): string {
  if (!(ORIGINS as readonly string[]).includes(origin)) {
    throw new BerthError(`origin must be one of ${ORIGINS.join(', ')}`, ExitCode.usage);
  }
  return origin;
}

export interface NewOptions {
  agent: string;
  cwd: string;
  name?: string;
  origin?: string;
  extraArgs?: string[];
}

export function create(ctx: Context, options: NewOptions): string {
  return withLock(ctx.config.stateDir, () => createLocked(ctx, options));
}

function createLocked(ctx: Context, options: NewOptions): string {
  const adapter = requireAdapter(options.agent);
  const name = options.name ? sanitizeName(options.name) : uniqueName(ctx, basename(options.cwd));
  if (ctx.tmux.hasSession(name) || ctx.store.newest()?.sessions.some((saved) => saved.name === name && !wasClosed(ctx, saved))) {
    throw new BerthError(`session name is already reserved: ${name}; resume or forget the stopped conversation first`, ExitCode.usage);
  }
  const command = launchCommand({ adapter, name, cwd: options.cwd, extraArgs: options.extraArgs, overrides: ctx.config.agents });
  const origin = checkOrigin(options.origin ?? 'none');
  if (!usableDirectory(options.cwd)) throw new BerthError('Choose an existing accessible folder.', ExitCode.usage);
  const profile = adapter.id === 'shell' ? undefined : captureProfile(adapter.id, ctx.env);
  return withPlaceholder(ctx, name, options.cwd, () => {
    if (profile) applyLaunchEnvironment(ctx, name, adapter.id, profile);
    ctx.tmux.setMeta(name, {
      agent: adapter.id,
      profile: profile ? JSON.stringify(profile) : undefined,
      cwd: options.cwd,
      argv: command, argvVerified: '1',
      origin,
    });
    ctx.tmux.setTitle(name);
    ctx.tmux.run(['respawn-pane', '-k', '-t', `=${name}:`, ...(command ? [command] : [])]);
    snapshotQuietly(ctx);
    return name;
  });
}

export function requireLive(ctx: Context, name: string): void {
  if (!ctx.tmux.hasSession(name)) throw new BerthError(`no such session: ${name}`, ExitCode.notFound);
}

/**
 * Make a live session managed. Its directory is the one it records, else the
 * active pane's current directory (a launcher may have changed into the
 * project), else the session's start directory.
 */
export function adopt(ctx: Context, name: string, agent: string, origin?: string): void {
  return withLock(ctx.config.stateDir, () => adoptLocked(ctx, name, agent, origin));
}

function adoptLocked(ctx: Context, name: string, agent: string, origin?: string): void {
  requireLive(ctx, name);
  const adapter = requireAdapter(agent);
  const live = ctx.tmux.listSessions().find((s) => s.name === name);
  const changingAgent = Boolean(live?.meta.agent && live.meta.agent !== agent);
  const producers = sessionProducers(ctx, name);
  if (producers.some((producer) => producer.argvIssue)) throw new BerthError(producers.find((producer) => producer.argvIssue)!.argvIssue!);
  const lifetime = producers[0] ? processLifetime(producers[0].pid)?.key : undefined;
  const resetBinding = Boolean(live?.meta.bindingIssue || changingAgent || (lifetime && live?.meta.conversation && live.meta.producerLifetime !== lifetime));
  if (producers.length > 1 || (producers.length === 1 && producers[0].agent !== agent)) {
    throw new BerthError('Selected agent does not match the independent producer in this session.', ExitCode.usage);
  }
  if (live?.meta.bindingIssue && (producers.length !== 1 || producers[0].agent !== agent)) {
    throw new BerthError('Separate independent agents into their own sessions before adopting again.', ExitCode.usage);
  }
  ctx.tmux.setMeta(name, {
    ...(resetBinding ? { bindingIssue: '', producerPane: producers[0]?.pane ?? '', producerLifetime: lifetime ?? '', restoreSource: '', profile: '', conversation: '', state: '', topic: '', note: '', recovery: '', recoveryAt: '', recoveryDetail: '' } : {}),
    argvVerified: producers[0] ? '1' : (changingAgent ? '' : live?.meta.argvVerified),
    agent: adapter.id,
    cwd: producers[0]?.cwd ?? live?.meta.cwd ?? ctx.tmux.paneCurrentPath(name) ?? live?.path ?? '',
    argv: producers[0]?.argv ?? (changingAgent ? undefined : live?.meta.argv) ?? adapter.launch.replace(/\{\w+\}/g, '').trim(),
    origin: checkOrigin(origin ?? live?.meta.origin ?? 'none'),
  });
  ctx.tmux.setTitle(name);
  snapshotQuietly(ctx);
}

/** Rename live identity and its recovery record before hosts update their references. */
export function rename(ctx: Context, from: string, to: string): void {
  return withLock(ctx.config.stateDir, () => renameLocked(ctx, from, to));
}

function renameLocked(ctx: Context, from: string, to: string): void {
  requireLive(ctx, from);
  if (!to || sanitizeName(to) !== to) throw new BerthError('invalid session name', ExitCode.usage);
  if (from === to) return;
  if (ctx.tmux.hasSession(to) || ctx.store.newest()?.sessions.some((s) => s.name === to)) {
    throw new BerthError(`session already exists: ${to}`, ExitCode.usage);
  }
  const live = ctx.tmux.listSessions().find((session) => session.name === from)!;
  const collision = nameCollision(ctx, live, ctx.store.newest()?.sessions ?? []);
  ctx.tmux.renameSession(from, to);
  try {
    takeSnapshot(ctx, new Date(), collision ? [] : [from], collision ? [collision] : []);
  } catch (error) {
    ctx.tmux.renameSession(to, from);
    snapshotQuietly(ctx);
    throw error;
  }
}

/** Intentional end must not be mistaken for the last server disappearing. */
export function end(ctx: Context, name: string): void {
  return withLock(ctx.config.stateDir, () => endLocked(ctx, name));
}

function endLocked(ctx: Context, name: string): void {
  requireLive(ctx, name);
  const live = ctx.tmux.listSessions().find((session) => session.name === name)!;
  const collision = nameCollision(ctx, live, ctx.store.newest()?.sessions ?? []);
  ctx.tmux.killSession(name);
  takeSnapshot(ctx, new Date(), collision ? [] : [name], collision ? [collision] : []);
}

/** Give up a stopped session: it is no longer restored or listed (spec §5.3). */
export function forget(ctx: Context, name: string): void {
  return withLock(ctx.config.stateDir, () => forgetLocked(ctx, name));
}

function forgetLocked(ctx: Context, name: string): void {
  if (ctx.tmux.hasSession(name)) throw new BerthError(`${name} is running; end it instead`, ExitCode.usage);
  if (!ctx.store.newest()?.sessions.some((s) => s.name === name)) throw new BerthError(`no stopped session ${name}`, ExitCode.notFound);
  takeSnapshot(ctx, new Date(), [name]);
}

const STAMPABLE = new Set(['agent', 'cwd', 'argv', 'conversation', 'origin', 'state', 'note', 'topic', 'ownerWorkspace']);

export function stamp(ctx: Context, name: string, values: Record<string, string>): void {
  return withLock(ctx.config.stateDir, () => stampLocked(ctx, name, values));
}

function stampLocked(ctx: Context, name: string, values: Record<string, string>): void {
  requireLive(ctx, name);
  let meta: SessionMeta = {};
  for (const [key, value] of Object.entries(values)) {
    if (!STAMPABLE.has(key)) throw new BerthError(`cannot stamp ${key}`, ExitCode.usage);
    if (key === 'origin') checkOrigin(value);
    if (key === 'agent') requireAdapter(value);
    meta = { ...meta, [key]: value };
  }
  if (meta.argv !== undefined) meta = { ...meta, argvVerified: '1' };
  const prior = ctx.tmux.listSessions().find((session) => session.name === name)?.meta;
  if (meta.agent && prior?.agent && meta.agent !== prior.agent) adoptLocked(ctx, name, meta.agent, meta.origin);
  if (meta.conversation !== undefined && meta.conversation !== prior?.conversation) {
    meta = { ...meta, recovery: '', recoveryAt: '', recoveryDetail: '', state: meta.state ?? '', note: meta.note ?? '', topic: meta.topic ?? '' };
  }
  if (meta.conversation) {
    const agent = meta.agent ?? prior?.agent;
    if (agent && agent !== 'shell') {
      const producers = sessionProducers(ctx, name);
      if (producers.length > 1 || (producers[0] && producers[0].agent !== agent)) throw new BerthError('Cannot bind a conversation to an incompatible producer.');
      meta = { ...meta, profile: JSON.stringify(captureProfile(agent, ctx.env)), ...(producers[0] ? {
        producerPane: producers[0].pane, producerLifetime: processLifetime(producers[0].pid)?.key,
      } : {}) };
    }
  }
  ctx.tmux.setMeta(name, meta);
  // A state change shows on attached terminals whoever reports it (spec §6, §7).
  if (meta.state !== undefined) {
    const note = meta.note ?? ctx.tmux.listSessions().find((s) => s.name === name)?.meta.note;
    presentState(ctx.tmux, name, meta.state, { note });
  }
  // What a restore needs changed: record it now, not at the next session event.
  if (['agent', 'cwd', 'argv', 'conversation', 'origin', 'ownerWorkspace'].some((k) => k in meta)) snapshotQuietly(ctx);
}

/** Note that marks a waiting state raised by a terminal bell rather than a hook. */
export const BELL_NOTE = 'bell';

/**
 * A terminal bell from a managed session (tmux alert-bell). Agents without
 * Berth hooks get state `waiting`, so every agent can ask for attention; for
 * agents with complete waiting hooks and no independent hook trust gate,
 * the bell is ignored. Existing explicit waiting information is preserved. Returns whether the state changed.
 */
export function bellRang(ctx: Context, name: string, env = process.env): boolean {
  const live = ctx.tmux.listSessions().find((s) => s.name === name);
  const agent = live?.meta.agent;
  if (!agent) return false;
  const adapter = getAdapter(agent);
  const profile = readProfile(agent, live?.meta.profile);
  if (live?.meta.state === 'waiting' && live.meta.note !== BELL_NOTE) return false;
  if (!adapter?.requiresHookTrust && adapter?.events.waiting.length && profile && hooksInstalled(agent, profileEnvironment(agent, profile, env))) return false;
  stamp(ctx, name, { state: 'waiting', note: BELL_NOTE });
  return true;
}

/** Seeing a session answers its bell: clear a bell-raised waiting state. */
export function clearBell(ctx: Context, name: string): void {
  withLock(ctx.config.stateDir, () => {
    const live = ctx.tmux.listSessions().find((s) => s.name === name);
    if (live?.meta.state === 'waiting' && live.meta.note === BELL_NOTE) stamp(ctx, name, { state: '', note: '' });
  }, 3000);
}
