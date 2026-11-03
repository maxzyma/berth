import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface ProcessLifetime { key: string; bornAt: number }
let own: ProcessLifetime | undefined;
let boot: string | undefined;
function bootIdentity(): string {
  if (boot) return boot;
  if (process.platform === 'linux') boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  else {
    const result = spawnSync('sysctl', ['-n', 'kern.bootsessionuuid'], { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL' });
    if (result.status !== 0) throw new Error('Cannot verify machine boot identity.');
    boot = result.stdout.trim();
    if (!/^[0-9a-f-]{36}$/i.test(boot)) throw new Error('Invalid machine boot identity.');
  }
  return boot;
}

/** Process birth plus boot identity, not PID existence alone. */
export function processLifetime(pid: number): ProcessLifetime | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (pid === process.pid && own) return own;
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {
    env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL',
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    try { process.kill(pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return undefined;
    }
    throw new Error(`Cannot verify process lifetime for ${pid}.`);
  }
  const bornAt = Date.parse(result.stdout.trim());
  if (!Number.isFinite(bornAt)) throw new Error(`Invalid process lifetime for ${pid}.`);
  const lifetime = { key: `${bootIdentity()}:${pid}:${bornAt}`, bornAt };
  if (pid === process.pid) own = lifetime;
  return lifetime;
}

export function processOwnerAlive(pid: number, lifetime: string | undefined, recordedAt: number): boolean {
  const current = processLifetime(pid);
  if (!current) return false;
  if (!lifetime) return current.bornAt <= recordedAt;
  if (current.key === lifetime) return true;
  return legacyMacOwnerMatches(pid, lifetime, current.bornAt);
}

/** Compatibility for already-running hosts and lock owners written before boot UUIDs. */
function legacyMacOwnerMatches(pid: number, lifetime: string, bornAt: number): boolean {
  if (process.platform !== 'darwin') return false;
  const legacy = /^\{ sec = (\d+), usec = \d+ \} .*:(\d+):(\d+)$/.exec(lifetime);
  if (!legacy || Number(legacy[2]) !== pid || Number(legacy[3]) !== bornAt) return false;
  // Old records contain a wall-clock boot estimate, which also drifts in whole
  // seconds. Their exact PID and process birth remain the migration anchor.
  // New UUID records never take this compatibility path.
  return true;
}
