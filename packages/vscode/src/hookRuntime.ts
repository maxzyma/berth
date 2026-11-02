/** Persistent hook runtime: independent of npm prefixes and extension version directories. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function prepareHookRuntime(bundle: string, storage: string): string {
  const target = join(storage, 'hooks', 'cli.mjs');
  const content = readFileSync(bundle);
  if (existsSync(target) && readFileSync(target).equals(content)) return target;
  mkdirSync(join(storage, 'hooks'), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  return target;
}

const run = promisify(execFile);
let installation: Promise<unknown> = Promise.resolve();

/** Serialize the shared runtime refresh and installer without blocking editor events. */
export function installBundledHooks(
  bundle: string,
  storage: string,
  agent: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; detail: string }> {
  const execute = async () => {
    try {
      const cli = prepareHookRuntime(bundle, storage);
      const result = await run(process.execPath, [cli, 'hooks', 'install', agent], {
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
        timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      });
      return { ok: true, detail: result.stdout.trim().split('\n').pop() ?? '' };
    } catch (error) {
      const failure = error as Error & { stderr?: string; killed?: boolean };
      return { ok: false, detail: failure.killed ? 'Hook installer exceeded its execution or output limit.'
        : failure.stderr?.trim() || failure.message };
    }
  };
  const result = installation.then(execute, execute);
  installation = result;
  return result;
}
