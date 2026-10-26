import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BerthError } from '../errors.js';

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

/**
 * Directory lock (implementation §2.4): created atomically, holds the owner PID.
 * A lock whose owner is dead is taken over; otherwise wait up to `timeoutMs`.
 */
export function withLock<T>(stateDir: string, fn: () => T, timeoutMs = 30_000): T {
  mkdirSync(stateDir, { recursive: true });
  const dir = join(stateDir, 'ensure.lock');
  const pidFile = join(dir, 'pid');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(pidFile, String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner = NaN;
      try {
        owner = Number(readFileSync(pidFile, 'utf8'));
      } catch {
        // Owner has not written its PID yet; treat as alive until the deadline.
      }
      if (Number.isInteger(owner) && !alive(owner)) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new BerthError(`timed out waiting for ${dir}`);
      sleep(100);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
