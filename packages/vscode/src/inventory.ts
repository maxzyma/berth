/** Asynchronous host transport; session decisions stay in the bundled core CLI. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EnvironmentOptions, EnvironmentReport, Finding, SessionRow } from '@berthdev/berth';

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

export async function sampleSessions(cli: string, env: NodeJS.ProcessEnv, runtime = process.execPath, knownOnly = false): Promise<SessionRow[]> {
  const result = await run(runtime, [cli, 'ls', '--json', ...(knownOnly ? ['--known-only'] : [])], {
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
  if (!Array.isArray(data) || !data.every((row) => row && typeof row.problem === 'string' && typeof row.code === 'string'
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

/** Base checks must work before tmux or any agent has been installed. */
export async function sampleEnvironment(cli: string, env: NodeJS.ProcessEnv,
  options: EnvironmentOptions = {}, runtime = process.execPath): Promise<EnvironmentReport> {
  const args = [cli, 'environment', '--json', '--editor',
    ...(options.externalNode ? ['--external-node'] : []),
    ...Object.entries({ agent: options.agent, launcher: options.launcher, cwd: options.cwd })
      .flatMap(([key, value]) => value ? [`--${key}`, value] : [])];
  const result = await run(runtime, args, { env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  return environmentReport(result.stdout);
}

function environmentReport(stdout: string): EnvironmentReport {
  const data = JSON.parse(stdout);
  if (!data || typeof data.ready !== 'boolean' || !Array.isArray(data.checks)
    || !data.checks.every((c: Record<string, unknown>) => c && typeof c.id === 'string'
      && typeof c.label === 'string' && typeof c.detail === 'string' && typeof c.ok === 'boolean'
      && typeof c.required === 'boolean' && (c.repair === undefined || ['tmux', 'node'].includes(String(c.repair))))) {
    throw new Error('Invalid environment report from Berth core.');
  }
  return data as EnvironmentReport;
}

/** The core inspected the selected launcher before creating and found setup incomplete; nothing was created. */
export class EnvironmentNotReady extends Error {
  constructor(readonly report: EnvironmentReport) {
    super('Berth setup is incomplete for this session.');
    this.name = 'EnvironmentNotReady';
  }
}

/** Exit code of `new --require-ready` when nothing was created (implementation §2.3). */
const NOT_READY = 5;

/** Run the same core creation transaction without blocking the editor event loop. */
/** Rename through the core, off the editor event loop; the core rolls tmux back if its snapshot fails. */
export async function renameSession(cli: string, env: NodeJS.ProcessEnv, from: string, to: string, runtime = process.execPath): Promise<void> {
  try {
    await run(runtime, [cli, 'rename', from, to], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  } catch (error) {
    const reported = (error as { stderr?: string }).stderr?.trim().replace(/^berth:\s*/, '');
    throw new Error(reported || (error as Error).message);
  }
}

export async function createSession(cli: string, env: NodeJS.ProcessEnv,
  options: { agent: string; cwd: string; origin?: string; ownerWorkspace?: string }, runtime = process.execPath): Promise<string> {
  // The core inspects the launcher first, so a separate environment check is not needed.
  const result = await run(runtime, [cli, 'new', options.agent, '--cwd', options.cwd,
    '--origin', options.origin ?? 'vscode', '--require-ready', '--editor',
    ...(options.ownerWorkspace ? ['--owner-workspace', options.ownerWorkspace] : [])], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  }).catch((error: { code?: unknown; stdout?: string }) => {
    if (error.code === NOT_READY) throw new EnvironmentNotReady(environmentReport(error.stdout ?? ''));
    throw error;
  });
  // Do not timeout/retry a mutation: it could already have created a session.
  const name = result.stdout.trim();
  if (!name || /[\r\n]/.test(name)) throw new Error('Creation result is unavailable. Refresh the session list before trying again.');
  return name;
}
