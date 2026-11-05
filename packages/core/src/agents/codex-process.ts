import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { processArguments } from '../process-arguments.js';
import { processLifetime } from '../process-owner.js';

/** Follow only the npm wrapper's direct native child with the same CLI arguments. */
export function codexRuntime(pid: number): { pid: number; lifetime: string } | undefined {
  const argv = processArguments(pid), owner = processLifetime(pid)?.key;
  if (!argv || !owner) return undefined;
  if (!['node', 'nodejs', 'bun'].includes(basename(argv[0]))) return { pid, lifetime: owner };
  if (!['codex', 'codex.js'].includes(basename(argv[1] || ''))) return undefined;
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 750, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  if (ps.status !== 0 || ps.error) return undefined;
  const children = ps.stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match || Number(match[2]) !== pid) return [];
    const child = Number(match[1]), args = processArguments(child);
    return args && basename(args[0]) === 'codex'
      && JSON.stringify(args.slice(1)) === JSON.stringify(argv.slice(2)) ? [child] : [];
  });
  if (children.length > 1 || processLifetime(pid)?.key !== owner) return undefined;
  const runtime = children[0] ?? pid;
  const lifetime = processLifetime(runtime)?.key;
  return lifetime ? { pid: runtime, lifetime } : undefined;
}
