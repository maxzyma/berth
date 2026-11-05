import type { Context } from '../context.js';
import type { SessionRow } from './sessions.js';
import { codexScreen, type CodexScreen } from '../agents/codex-screen.js';
import { processLifetime } from '../process-owner.js';
import { BINDING_UNVERIFIED, processes, sessionProducers } from './discover.js';
import { sameNativeCandidate } from './native-state.js';

/** Ephemeral display only: no hook, transcript, binding or snapshot mutation. */
export function withCodexScreenActivity(ctx: Context, rows: SessionRow[]): SessionRow[] {
  const eligible = rows.filter(row => row.live && row.agent === 'codex'
    && row.state !== 'waiting'
    && (!row.bindingIssue || row.bindingIssue === BINDING_UNVERIFIED));
  if (!eligible.length) return rows.map(({ terminalPreview: _previous, ...row }) => row);
  const live = ctx.tmux.listSessions();
  const procs = processes();
  const samples = new Map<string, CodexScreen>();
  for (const row of eligible) {
    const session = live.find(s => s.name === row.name);
    if (!session || session.meta.state !== (row.state || undefined)) continue;
    const producers = sessionProducers(ctx, row.name, procs);
    const producer = producers.length === 1 ? producers[0] : undefined;
    if (!producer || producer.agent !== 'codex' || producer.argvIssue
      || producer.pane !== session.meta.producerPane
      || processLifetime(producer.pid)?.key !== session.meta.producerLifetime) continue;
    const viewport = ctx.tmux.run(['capture-pane', '-p', '-S', '0', '-t', producer.pane], true);
    const sample = viewport.ok ? codexScreen(viewport.stdout) : undefined;
    if (!sample) continue;
    const current = ctx.tmux.listSessions().find(s => sameNativeCandidate(session, s));
    const owners = sessionProducers(ctx, row.name);
    if (current && owners.length === 1 && owners[0].pid === producer.pid
      && owners[0].pane === producer.pane
      && processLifetime(producer.pid)?.key === session.meta.producerLifetime) samples.set(row.name, sample);
  }
  return rows.map(row => {
    const sample = samples.get(row.name);
    const { terminalPreview: _previous, ...fresh } = row;
    return { ...fresh, ...(sample?.working ? { state: 'working', note: '', ...(row.state !== 'working' ? { activityTiming: undefined } : {}) } : {}),
      ...(sample?.terminalPreview ? { terminalPreview: sample.terminalPreview } : {}) };
  });
}
