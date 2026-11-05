import { codexRuntime } from '../agents/codex-process.js';
import type { Context } from '../context.js';
import type { LiveSession, SessionMeta } from '../tmux/client.js';
import { realpathSync } from 'node:fs';
import { codexScreen } from '../agents/codex-screen.js';
import { codexNativeRecord, codexNativeRoot, codexRevision, type CodexNativeRecord } from '../agents/codex-native.js';
import { captureProfile, profileRoot, readProfile } from '../agents/profile.js';
import { processLifetime } from '../process-owner.js';
import { withLock } from '../restore/lock.js';
import { snapshotQuietly } from '../snapshot/take.js';
import { presentState } from '../present/state.js';
import { nameCollision } from '../snapshot/identity.js';
import { BINDING_UNVERIFIED, processes, sessionProducers, type Detected } from './discover.js';
import { sameNativeCandidate } from './native-state.js';

export const CODEX_SELECTION_UNKNOWN = 'The current Codex conversation is not verified. Exact recovery is suspended until its native session ID is visible.';
interface Observation {
  session: LiveSession;
  producer: Detected & { pane: string; cwd: string };
  lifetime: string;
  runtime?: { pid: number; lifetime: string };
  selected?: string;
  record?: CodexNativeRecord;
}
const acceptedIssue = (issue?: string) => !issue || [BINDING_UNVERIFIED, CODEX_SELECTION_UNKNOWN].includes(issue);

function observe(ctx: Context): Observation[] {
  const procs = processes();
  return ctx.tmux.listSessions().filter(s => s.meta.agent === 'codex' && acceptedIssue(s.meta.bindingIssue)).flatMap(session => {
    const owners = sessionProducers(ctx, session.name, procs);
    const producer = owners.length === 1 ? owners[0] : undefined;
    const lifetime = producer && processLifetime(producer.pid)?.key;
    if (!producer || producer.agent !== 'codex' || producer.argvIssue || !lifetime
      || (session.meta.producerPane && producer.pane !== session.meta.producerPane)
      || (session.meta.producerLifetime && lifetime !== session.meta.producerLifetime)) return [];
    const viewport = ctx.tmux.run(['capture-pane', '-p', '-S', '0', '-t', producer.pane], true);
    if (!viewport.ok) return []; // Failed queries are not evidence that selection changed.
    const selected = codexScreen(viewport.stdout)?.conversationCandidate;
    if (!selected && !session.meta.nativeCodexSelection) return [];
    const runtime = selected ? codexRuntime(producer.pid) : undefined;
    const root = runtime && codexNativeRoot(runtime.pid, runtime.lifetime);
    const record = root && selected ? codexNativeRecord(root, selected) : undefined;
    return [{ session, producer, lifetime, runtime, selected, record }];
  });
}

function profileMatches(session: LiveSession, root: string): boolean {
  const profile = readProfile('codex', session.meta.profile);
  if (!profile) return !session.meta.profile;
  try { return realpathSync(profileRoot('codex', profile)) === root; }
  catch { return false; }
}

function metadata(ctx: Context, o: Observation, working: boolean): SessionMeta | undefined {
  const m = o.session.meta, r = o.record;
  if (!r || !profileMatches(o.session, r.root)) {
    return m.nativeCodexSelection ? { bindingIssue: CODEX_SELECTION_UNKNOWN,
      ...(m.state === 'waiting' ? {} : { state: '', note: '' }), topic: '' } : undefined;
  }
  const recovering = !!m.recovery && m.recovery !== 'confirmed';
  if (recovering && m.conversation !== r.id) return {
    recovery: 'failed', recoveryDetail: 'Agent opened a different conversation. The expected ID was preserved.',
  };
  if (!m.producerLifetime && m.conversation && m.conversation !== r.id && !recovering) return undefined;
  const changed = m.conversation !== r.id;
  const selection = JSON.stringify({ id: r.id, root: r.root, revision: r.revision });
  const state = m.state === 'waiting' && !changed ? 'waiting' : working ? 'working' : r.state;
  return {
    conversation: r.id, bindingIssue: '', nativeCodexSelection: selection,
    producerPane: o.producer.pane, producerLifetime: o.lifetime,
    profile: m.profile || JSON.stringify(captureProfile('codex', { ...ctx.env, CODEX_HOME: r.root })),
    ...(r.topic !== undefined ? { topic: r.topic } : changed ? { topic: '' } : {}),
    ...(state !== undefined ? { state, note: state === 'waiting' ? m.note || '' : '',
      activityTiming: state === 'waiting' && !changed ? m.activityTiming || ''
        : state === r.state && r.activityTiming ? JSON.stringify(r.activityTiming) : '' } : changed ? { state: '', note: '' } : {}),
    ...(recovering ? { recovery: 'confirmed', recoveryDetail: '' } : changed ? { recovery: '', recoveryAt: '', recoveryDetail: '', restoreSource: '' } : {}),
  };
}

/** Independent native selection and profile evidence; no daemon environment routing. */
export function reconcileCodexSelection(ctx: Context): void {
  const observations = observe(ctx); // File and process queries run outside the lock.
  if (!observations.length) return;
  withLock(ctx.config.stateDir, () => {
    const saved = ctx.store.newest()?.sessions ?? [];
    let identityChanged = false;
    for (const o of observations) {
      const current = ctx.tmux.listSessions().find(s => sameNativeCandidate(o.session, s));
      if (!current || nameCollision(ctx, current, saved)) continue;
      const owners = sessionProducers(ctx, current.name);
      if (owners.length !== 1 || owners[0].pid !== o.producer.pid || owners[0].pane !== o.producer.pane
        || processLifetime(o.producer.pid)?.key !== o.lifetime) continue;
      if (o.runtime && JSON.stringify(codexRuntime(o.producer.pid)) !== JSON.stringify(o.runtime)) continue;
      const viewport = ctx.tmux.run(['capture-pane', '-p', '-S', '0', '-t', o.producer.pane], true);
      if (!viewport.ok) continue;
      const screen = codexScreen(viewport.stdout);
      if (screen?.conversationCandidate !== o.selected) continue;
      if (o.record && codexRevision(o.record.file) !== o.record.revision) continue;
      const patch = metadata(ctx, o, screen?.working === true);
      if (!patch) continue;
      const entries = Object.entries(patch).filter(([key, value]) => (current.meta[key as keyof SessionMeta] || '') !== value);
      if (!entries.length) continue;
      const delta = Object.fromEntries(entries) as SessionMeta;
      ctx.tmux.setMeta(current.name, delta);
      if (delta.state !== undefined) presentState(ctx.tmux, current.name, delta.state, { note: delta.note });
      identityChanged ||= entries.some(([key]) => ['conversation', 'profile', 'bindingIssue', 'recovery'].includes(key));
    }
    if (identityChanged) snapshotQuietly(ctx);
  });
}
