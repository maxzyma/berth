/** Asynchronous host transport; session decisions stay in the bundled core CLI. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Finding, SessionRow } from '@berthdev/berth';

const run = promisify(execFile);
const branchCache = new Map<string, { value: string; checkedAt: number }>();

async function branch(cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  const cached = branchCache.get(cwd);
  if (cached && Date.now() - cached.checkedAt < 5000) return cached.value;
  try {
    const result = await run('git', ['-C', cwd, 'branch', '--show-current'], { env, encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 });
    const value = result.stdout.trim();
    if (branchCache.size >= 1000) branchCache.clear();
    branchCache.set(cwd, { value, checkedAt: Date.now() });
    return value;
  } catch {
    branchCache.set(cwd, { value: '', checkedAt: Date.now() });
    return '';
  }
}

export async function sampleSessions(cli: string, env: NodeJS.ProcessEnv, runtime = process.execPath): Promise<SessionRow[]> {
  const result = await run(runtime, [cli, 'ls', '--json'], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
  });
  const data: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(data) || !data.every((row) => row && typeof row.name === 'string' && typeof row.cwd === 'string' && typeof row.agent === 'string' && typeof row.live === 'boolean')) {
    throw new Error('Invalid session inventory from Berth core. Check the installed package.');
  }
  return data as SessionRow[];
}

export async function sampleInventory(cli: string, env: NodeJS.ProcessEnv, runtime = process.execPath): Promise<{ rows: SessionRow[]; branches: ReadonlyMap<string, string> }> {
  const rows = await sampleSessions(cli, env, runtime);
  const folders = [...new Set(rows.filter((row) => row.managed).map((row) => row.cwd))];
  const entries: [string, string][] = [];
  // Bound child-process concurrency without blocking editor commands.
  for (let offset = 0; offset < folders.length; offset += 4) {
    const batch = await Promise.all(folders.slice(offset, offset + 4).map(async (cwd): Promise<[string, string]> => [cwd, await branch(cwd, env)]));
    entries.push(...batch);
  }
  return { rows, branches: new Map(entries) };
}


/** Setup queries may run several bounded native version probes; keep them off the host thread. */
export async function sampleDoctor(cli: string, env: NodeJS.ProcessEnv, runtime = process.execPath): Promise<Finding[]> {
  const result = await run(runtime, [cli, 'doctor', '--json'], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 20_000,
    killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
  const data: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(data) || !data.every((row) => row && typeof row.problem === 'string'
    && (row.session === undefined || typeof row.session === 'string')
    && (row.installHooksFor === undefined || typeof row.installHooksFor === 'string'))) {
    throw new Error('Invalid setup diagnosis from Berth core. Check the installed package.');
  }
  return data as Finding[];
}

/** A pending/rejected terminal must not hold the whole inventory refresh open. */
export async function resolveTerminalPids(
  pending: readonly PromiseLike<number | undefined>[], timeoutMs = 250,
): Promise<{ pids: (number | undefined)[]; ready: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let values = pending.map(() => ({ pid: undefined as number | undefined, ready: false }));
  const reads = pending.map(async (promise, i) => {
    try {
      const pid = await promise;
      values = values.map((value, index) => index === i ? { pid, ready: pid !== undefined } : value);
    } catch { /* Rejected identity remains unknown; other terminals still resolve. */ }
  });
  try {
    await Promise.race([Promise.all(reads), new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
    return { pids: values.map(value => value.pid), ready: values.every(value => value.ready) };
  } finally { if (timer) clearTimeout(timer); }
}
