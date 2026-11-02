import { copilotState } from '../agents/copilot-state.js';
import { geminiInactive } from '../agents/gemini-state.js';
import { spawnSync } from 'node:child_process';
import type { Context } from '../context.js';
import type { LiveSession } from '../tmux/client.js';
import { readProfile, profileEnvironment, profileKey } from '../agents/profile.js';
import { processLifetime } from '../process-owner.js';
import { presentState } from '../present/state.js';
import { nameCollision } from '../snapshot/identity.js';
import { resolveBinary } from '../tools.js';
import { processes, sessionProducers } from './discover.js';

export interface NativeCandidate {
  session: LiveSession;
  pid: number;
  bornAt: number;
}

interface NativeObservation extends NativeCandidate { state?: 'working' }

function eligible(session: LiveSession): boolean {
  const m = session.meta;
  return (m.agent === 'claude' || (['gemini', 'copilot'].includes(m.agent || '') && !!m.nativeTranscript)) && !!m.conversation && !m.bindingIssue
    && !!m.producerPane && !!m.producerLifetime
    && (m.state === 'working' || m.state === 'waiting' || (m.agent === 'gemini' && m.state === 'done'));
}

/** Called under the state lock; one least-recently attempted profile per pass. */
export function prepareNativeState(ctx: Context): NativeCandidate[] {
  const live = ctx.tmux.listSessions().filter(eligible);
  const saved = ctx.store.newest()?.sessions ?? [];
  const groups = new Map<string, LiveSession[]>();
  for (const session of live) {
    const profile = readProfile(session.meta.agent!, session.meta.profile);
    if (!profile || nameCollision(ctx, session, saved)) continue;
    const key = profileKey(session.meta.agent!, profile);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  const attempted = (rows: LiveSession[]) => Math.max(0, ...rows.map((s) => Number(s.meta.nativeCheckedAt) || 0));
  const selected = [...groups.values()].sort((a, b) => attempted(a) - attempted(b))[0];
  if (!selected) return [];
  const now = String(Date.now());
  const procs = processes();
  return selected.flatMap((session) => {
    ctx.tmux.setMeta(session.name, { nativeCheckedAt: now });
    const updated = { ...session, meta: { ...session.meta, nativeCheckedAt: now } };
    try {
      const producers = sessionProducers(ctx, session.name, procs);
      const producer = producers.length === 1 ? producers[0] : undefined;
      const lifetime = producer && processLifetime(producer.pid);
      if (!producer || producer.agent !== session.meta.agent || producer.argvIssue
        || producer.pane !== session.meta.producerPane || !lifetime
        || lifetime.key !== session.meta.producerLifetime) return [];
      return [{ session: updated, pid: producer.pid, bornAt: lifetime.bornAt }];
    } catch { return []; } // Unverifiable ownership is not an idle observation.
  });
}

/** Native schemas are versioned externally; unknown or ambiguous data is inert. */
export function nativeIdle(data: unknown, candidate: NativeCandidate): boolean {
  if (!Array.isArray(data)) return false;
  const records = data.filter((row) => row && typeof row === 'object'
    && (row.pid === candidate.pid || row.sessionId === candidate.session.meta.conversation));
  if (records.length !== 1) return false;
  const row = records[0];
  return row.pid === candidate.pid && row.sessionId === candidate.session.meta.conversation
    && row.kind === 'interactive' && row.status === 'idle'
    && typeof row.startedAt === 'number' && Number.isFinite(row.startedAt)
    && row.startedAt >= candidate.bornAt && row.startedAt <= Date.now();
}

/** No shared state lock may be held while invoking the native CLI. */
export function observeNativeState(ctx: Context, candidates: NativeCandidate[]): NativeObservation[] {
  const first = candidates[0];
  const agent = first?.session.meta.agent;
  const profile = first && agent && readProfile(agent, first.session.meta.profile);
  if (!profile) return [];
  const env = profileEnvironment(agent!, profile, ctx.env);
  if (agent === 'copilot') return candidates.flatMap((candidate): NativeObservation[] => {
    const { session } = candidate;
    const state = copilotState(session.meta.nativeTranscript, session.meta.conversation!, env);
    if (state === undefined || state === session.meta.state) return [];
    return [{ ...candidate, ...(state === 'working' ? { state } : {}) }];
  });
  if (agent === 'gemini') return candidates.filter(({ session }) =>
    geminiInactive(session.meta.nativeTranscript, session.meta.conversation!, env, session.meta.state === 'done'));
  try {
    const result = spawnSync(resolveBinary('claude', env), ['agents', '--json'], {
      env, encoding: 'utf8', timeout: 1500, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) return [];
    const data: unknown = JSON.parse(result.stdout);
    return candidates.filter((candidate) => nativeIdle(data, candidate));
  } catch { return []; }
}

export function sameNativeCandidate(before: LiveSession, after: LiveSession): boolean {
  return before.name === after.name && before.serverStart === after.serverStart
    && before.sessionId === after.sessionId
    && Object.keys({ ...before.meta, ...after.meta }).filter((key) => key !== 'nativeCheckedAt').every((key) =>
      before.meta[key as keyof typeof before.meta] === after.meta[key as keyof typeof after.meta]);
}

/** Called under the state lock; observations never establish session identity. */
export function applyNativeState(ctx: Context, observations: NativeObservation[]): void {
  if (!observations.length) return;
  const live = ctx.tmux.listSessions();
  const saved = ctx.store.newest()?.sessions ?? [];
  const procs = processes();
  for (const observation of observations) {
    const current = live.find((s) => sameNativeCandidate(observation.session, s));
    if (!current || !eligible(current) || nameCollision(ctx, current, saved)) continue;
    try {
      const producers = sessionProducers(ctx, current.name, procs);
      const producer = producers.length === 1 ? producers[0] : undefined;
      if (!producer || producer.pid !== observation.pid || producer.agent !== current.meta.agent
        || producer.argvIssue || producer.pane !== current.meta.producerPane
        || processLifetime(producer.pid)?.key !== current.meta.producerLifetime) continue;
      ctx.tmux.setMeta(current.name, { state: observation.state ?? '', note: '' });
      presentState(ctx.tmux, current.name, observation.state ?? '');
    } catch { /* A disappearing or unverifiable producer leaves hooks authoritative. */ }
  }
}
