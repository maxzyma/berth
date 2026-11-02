import type { Tmux, SessionMeta } from '../tmux/client.js';

export type RecoveryState = 'requested' | 'confirmed' | 'unconfirmed' | 'failed';
export interface RecoveryStatus { recovery?: RecoveryState; recoveryAt?: string; recoveryDetail?: string }

/** A running pane proves process existence, not successful conversation resume. */
export function recoveryStatus(tmux: Tmux, name: string, meta: SessionMeta): RecoveryStatus {
  if (!meta.recovery) return {};
  const base = { recovery: meta.recovery as RecoveryState, recoveryAt: meta.recoveryAt, recoveryDetail: meta.recoveryDetail };
  if (meta.recovery === 'failed' || meta.recovery === 'confirmed') return base;
  const dead = tmux.run(['display-message', '-p', '-t', `=${name}:`, '#{pane_dead}'], true);
  if (dead.ok && dead.stdout.trim() === '1') return { ...base, recovery: 'failed', recoveryDetail: 'Agent process exited. Inspect terminal output before retrying.' };
  if (meta.recovery === 'requested' && Date.now() - Number(meta.recoveryAt) >= 30_000) {
    return { ...base, recovery: 'unconfirmed', recoveryDetail: 'No matching conversation acknowledgement. Inspect the terminal before continuing.' };
  }
  return base;
}
