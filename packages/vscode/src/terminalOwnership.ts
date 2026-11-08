import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** The marker remains in the process even when native revival omits API metadata. */
export const TERMINAL_OWNER_ENV = 'BERTH_EDITOR_OWNER';

/** Unrelated unresolved terminals cannot block a detached target or an owned view. */
export function handoffSources<T extends { ancestors: number[] }>(
  clients: readonly T[], unownedPids: ReadonlySet<number>, pidsReady: boolean, reusingOwned: boolean,
): T[] {
  if (!pidsReady && !reusingOwned && clients.length) {
    throw new Error('Terminal identification is still in progress. Try opening the session again.');
  }
  return clients.filter(client => client.ancestors.some(pid => unownedPids.has(pid)));
}

export function persistentTerminalOptions(owner: string) {
  return { isTransient: false, env: { [TERMINAL_OWNER_ENV]: owner } };
}

export function restoredTerminalSession(
  env: Readonly<Record<string, string | null | undefined>> | undefined,
  owner: string, pid: number | undefined, sessions: ReadonlyMap<number, string>,
  processOwned = false,
): string | undefined {
  const marker = env?.[TERMINAL_OWNER_ENV];
  if (!owner || pid === undefined || (marker !== undefined ? marker !== owner : !processOwned)) return undefined;
  return sessions.get(pid);
}

/** Read only the ownership marker; never retain or log a process environment. */
export async function terminalProcessOwned(pid: number, owner: string): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !/^[A-Za-z0-9-]+$/.test(owner)) return false;
  try {
    const token = `${TERMINAL_OWNER_ENV}=${owner}`;
    if (process.platform === 'linux') {
      return (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0').includes(token);
    }
    if (process.platform !== 'darwin') return false;
    const { stdout } = await execute('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], {
      encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    });
    return stdout.split(/\s+/).includes(token);
  } catch {
    // An inaccessible or exited process cannot establish ownership.
    return false;
  }
}
