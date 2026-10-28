import { basename } from 'node:path';
import type { Context } from '../context.js';
import { BerthError, ExitCode } from '../errors.js';
import { launchCommand, requireAdapter } from '../agents/commands.js';
import type { SessionMeta } from '../tmux/client.js';
import { hooksInstalled } from '../agents/hooks.js';
import { getAdapter } from '../agents/registry.js';
import { presentState } from '../present/state.js';

/** One row of `berth ls` (implementation §2.2). */
export interface SessionRow {
  name: string;
  managed: boolean;
  agent: string;
  cwd: string;
  conversation: string;
  origin: string;
  state: string;
  note: string;
  attachedClients: number;
  live: boolean;
}

export const ORIGINS = ['vscode', 'iterm2', 'none'] as const;

export function list(ctx: Context): SessionRow[] {
  const live = ctx.tmux.listSessions();
  const rows: SessionRow[] = live.map((s) => ({
    name: s.name,
    managed: Boolean(s.meta.agent),
    agent: s.meta.agent ?? '',
    cwd: s.meta.cwd ?? s.path,
    conversation: s.meta.conversation ?? '',
    origin: s.meta.origin ?? (s.meta.agent ? 'none' : ''),
    state: s.meta.state ?? '',
    note: s.meta.note ?? '',
    attachedClients: s.attachedClients,
    live: true,
  }));
  const liveNames = new Set(live.map((s) => s.name));
  for (const s of ctx.store.newest()?.sessions ?? []) {
    if (liveNames.has(s.name)) continue;
    rows.push({ ...s, managed: true, state: '', note: '', attachedClients: 0, live: false });
  }
  return rows;
}

export function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'session';
}

/** Default name from the cwd's basename; suffix -2, -3, … on collision with any live session. */
export function uniqueName(ctx: Context, base: string): string {
  const taken = new Set(ctx.tmux.listSessions().map((s) => s.name));
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
  const adapter = requireAdapter(options.agent);
  const name = options.name ? sanitizeName(options.name) : uniqueName(ctx, basename(options.cwd));
  if (ctx.tmux.hasSession(name)) throw new BerthError(`session already exists: ${name}`, ExitCode.usage);
  const command = launchCommand({ adapter, name, cwd: options.cwd, extraArgs: options.extraArgs, overrides: ctx.config.agents });
  ctx.tmux.newSession(name, options.cwd, command);
  ctx.tmux.setMeta(name, {
    agent: adapter.id,
    cwd: options.cwd,
    argv: command,
    origin: checkOrigin(options.origin ?? 'none'),
  });
  ctx.tmux.setTitle(name);
  return name;
}

export function requireLive(ctx: Context, name: string): void {
  if (!ctx.tmux.hasSession(name)) throw new BerthError(`no such session: ${name}`, ExitCode.notFound);
}

export function adopt(ctx: Context, name: string, agent: string, origin?: string): void {
  requireLive(ctx, name);
  const adapter = requireAdapter(agent);
  const live = ctx.tmux.listSessions().find((s) => s.name === name);
  ctx.tmux.setMeta(name, {
    agent: adapter.id,
    cwd: live?.meta.cwd ?? live?.path ?? '',
    argv: live?.meta.argv ?? adapter.launch.replace(/\{\w+\}/g, '').trim(),
    origin: checkOrigin(origin ?? live?.meta.origin ?? 'none'),
  });
  ctx.tmux.setTitle(name);
}

const STAMPABLE = new Set(['agent', 'cwd', 'argv', 'conversation', 'origin', 'state', 'note']);

export function stamp(ctx: Context, name: string, values: Record<string, string>): void {
  requireLive(ctx, name);
  const meta: SessionMeta = {};
  for (const [key, value] of Object.entries(values)) {
    if (!STAMPABLE.has(key)) throw new BerthError(`cannot stamp ${key}`, ExitCode.usage);
    if (key === 'origin') checkOrigin(value);
    if (key === 'agent') requireAdapter(value);
    meta[key as keyof SessionMeta] = value;
  }
  ctx.tmux.setMeta(name, meta);
  // A state change shows on attached terminals whoever reports it (spec §6, §7).
  if (meta.state !== undefined) {
    const note = meta.note ?? ctx.tmux.listSessions().find((s) => s.name === name)?.meta.note;
    presentState(ctx.tmux, name, meta.state, { note });
  }
}

/** Note that marks a waiting state raised by a terminal bell rather than a hook. */
export const BELL_NOTE = 'bell';

/**
 * A terminal bell from a managed session (tmux alert-bell). Agents without
 * Berth hooks get state `waiting`, so every agent can ask for attention; for
 * agents whose hooks are installed the hooks are more precise and the bell
 * is ignored. Returns whether the state changed.
 */
export function bellRang(ctx: Context, name: string, env = process.env): boolean {
  const live = ctx.tmux.listSessions().find((s) => s.name === name);
  const agent = live?.meta.agent;
  if (!agent) return false;
  const adapter = getAdapter(agent);
  if (adapter?.hookTarget && hooksInstalled(agent, env)) return false;
  stamp(ctx, name, { state: 'waiting', note: BELL_NOTE });
  return true;
}

/** Seeing a session answers its bell: clear a bell-raised waiting state. */
export function clearBell(ctx: Context, name: string): void {
  const live = ctx.tmux.listSessions().find((s) => s.name === name);
  if (live?.meta.state === 'waiting' && live.meta.note === BELL_NOTE) stamp(ctx, name, { state: '', note: '' });
}
