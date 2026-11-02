import { processLifetime, processOwnerAlive } from '../process-owner.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BerthError } from '../errors.js';

const held = new Set<string>();

interface Ticket { id: string; pid: number; number: number; lifetime?: string; createdAt?: number }
function sleep(): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); }
function readTickets(dir: string): Ticket[] {
  return readdirSync(dir).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try {
      const value = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Ticket;
      return value.id === name.slice(0, -5) && Number.isSafeInteger(value.number) && value.number >= 0 && processOwnerAlive(value.pid, value.lifetime, value.createdAt ?? statSync(join(dir, name)).mtimeMs) ? [value] : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error; // A corrupt active contender must not be silently bypassed.
    }
  });
}
function legacyOwnerAlive(stateDir: string): boolean {
  try {
    const file = join(stateDir, 'ensure.lock', 'pid');
    return processOwnerAlive(Number(readFileSync(file, 'utf8')), undefined, statSync(file).mtimeMs);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Immutable ticket identities avoid stale-lock replacement races. */
function contender(stateDir: string): { blocked: () => boolean; release: () => void } {
  const dir = join(resolve(stateDir), 'ensure-tickets');
  mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const file = join(dir, `${id}.json`);
  const temporary = `${file}.tmp`;
  const lifetime = processLifetime(process.pid)!.key;
  const createdAt = Date.now();
  const release = () => {
    rmSync(file, { force: true });
    rmSync(temporary, { force: true });
  };
  const publish = (number: number) => {
    writeFileSync(temporary, JSON.stringify({ id, pid: process.pid, number, lifetime, createdAt }), { mode: 0o600 });
    renameSync(temporary, file);
  };
  try {
    publish(0);
    const number = Math.max(0, ...readTickets(dir).map((ticket) => ticket.number)) + 1;
    publish(number);
    return {
      blocked: () => legacyOwnerAlive(stateDir) || readTickets(dir).some((ticket) =>
        ticket.id !== id && (ticket.number === 0 || ticket.number < number || (ticket.number === number && ticket.id < id))),
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

/** Synchronous session operations permit nested calls on their owning stack. */
export function withLock<T>(stateDir: string, fn: () => T, timeoutMs = 30_000): T {
  const key = resolve(stateDir);
  if (held.has(key)) return fn();
  const ticket = contender(key);
  const deadline = Date.now() + timeoutMs;
  try {
    while (ticket.blocked()) {
      if (Date.now() >= deadline) throw new BerthError(`another restore is running (${stateDir})`);
      sleep();
    }
    held.add(key);
    try { return fn(); }
    finally { held.delete(key); }
  } finally { ticket.release(); }
}

/** Awaited host transactions retain ownership until completion without blocking the event loop. */
export async function withAsyncLock<T>(stateDir: string, fn: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const ticket = contender(stateDir);
  const deadline = Date.now() + timeoutMs;
  try {
    while (ticket.blocked()) {
      if (Date.now() >= deadline) throw new BerthError('Another operation is using this state. Try again when it finishes.');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    return await fn();
  } finally { ticket.release(); }
}
