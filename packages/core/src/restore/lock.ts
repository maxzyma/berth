import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BerthError } from '../errors.js';

/** A lock directory with no PID yet is its owner's first moment; older than this, the owner died there. */
const PIDLESS_GRACE_MS = 10_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Whether the lock at `dir` belongs to nobody any more. */
function abandoned(dir: string): boolean {
  try {
    const owner = Number(readFileSync(join(dir, 'pid'), 'utf8'));
    return Number.isInteger(owner) && owner > 0 && !alive(owner);
  } catch {
    try {
      return Date.now() - statSync(dir).mtimeMs > PIDLESS_GRACE_MS;
    } catch {
      return false; // released meanwhile
    }
  }
}

/**
 * Directory lock (implementation §2.4): created atomically, holds the owner
 * PID. An abandoned lock is taken over by renaming it away first, so two
 * waiters cannot both remove it and both proceed. Others wait up to `timeoutMs`.
 */
export function withLock<T>(stateDir: string, fn: () => T, timeoutMs = 30_000): T {
  mkdirSync(stateDir, { recursive: true });
  const dir = join(stateDir, 'ensure.lock');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'pid'), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (abandoned(dir)) {
        const stale = `${dir}.stale-${process.pid}-${Date.now()}`;
        try {
          renameSync(dir, stale);
          rmSync(stale, { recursive: true, force: true });
        } catch {
          // Another waiter took it over first; try again.
        }
        continue;
      }
      if (Date.now() > deadline) throw new BerthError(`another restore is running (${dir})`);
      sleep(100);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
