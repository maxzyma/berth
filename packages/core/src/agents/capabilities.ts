import { spawnSync } from 'node:child_process';
import { executableOnPath } from '../tools.js';
import type { Adapter } from './registry.js';

export interface VersionObservation { executable: string; version?: string; detail?: string }
export interface CapabilityAssessment { severity: 'info' | 'warning'; detail: string }

/** Evidence refers to a tested release, not the current process or profile. */
const TESTED: Readonly<Record<string, readonly string[]>> = {
  claude: ['2.1.310'], codex: ['0.162.1', '0.166.0'], kimi: ['0.31.1'], opencode: ['1.19.5'], gemini: ['0.66.0'], copilot: ['1.0.105'],
};

export function assessCapability(agent: string, version: string): CapabilityAssessment {
  // Cursor's dated build format is distinct from its editor's semantic version.
  // Source: https://cursor.com/changelog/cli-jan-16-2026 (checked 2026-11-01).
  const dated = /^(20\d{2})\.(\d{2})\.(\d{2})(?:-[A-Za-z0-9.-]+)?$/.exec(version);
  const date = dated && new Date(Date.UTC(Number(dated[1]), Number(dated[2]) - 1, Number(dated[3])));
  const validDate = dated && date && date.getUTCFullYear() === Number(dated[1])
    && date.getUTCMonth() + 1 === Number(dated[2]) && date.getUTCDate() === Number(dated[3]);
  if (agent === 'cursor' && validDate && dated.slice(1, 4).join('') < '20260116') {
    return { severity: 'warning', detail: 'Predates the 2026-01-16 lifecycle hooks release. Update Cursor CLI, then verify a session binding and exact-ID recovery.' };
  }
  if (TESTED[agent]?.includes(version)) {
    return { severity: 'info', detail: 'Berth tested this release on macOS with an isolated model fixture. Hook trust, binding and recovery in this profile still require their own acknowledgement.' };
  }
  return { severity: 'info', detail: 'This exact release has no Berth native acceptance record. Verify hook delivery and exact-ID recovery; hook files alone do not establish compatibility.' };
}

/** Query only a standard adapter executable; never invoke a custom launcher. */
type VersionProbe = (executable: string, cwd: string) => { status: number | null; stdout: string; error?: Error };

export function versionInspector(env: NodeJS.ProcessEnv, probe: VersionProbe = (executable, cwd) =>
  spawnSync(executable, ['--version'], { env, cwd, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 }),
): (adapter: Adapter, cwd?: string) => VersionObservation {
  const cache = new Map<string, VersionObservation>();
  let probes = 0;
  return (adapter, cwd = process.cwd()) => {
    const executable = executableOnPath(adapter.binary, env, cwd);
    if (!executable) return { executable: adapter.binary, detail: 'executable unavailable' };
    const prior = cache.get(executable);
    if (prior) return prior;
    if (probes >= 8) return { executable, detail: 'version query limit reached; inspect this executable separately' };
    probes++;
    let observation: VersionObservation;
    try {
      const result = probe(executable, cwd);
      const output = result.status === 0 && !result.error ? result.stdout.trim() : '';
      const matches = [...output.matchAll(/(?:^|\s)v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)(?=$|\s|\()/g)].map((match) => match[1]);
      const version = new Set(matches).size === 1 ? matches[0] : undefined;
      observation = { executable, ...(version ? { version } : { detail: result.error ? 'version query failed or timed out' : 'version output unavailable or unrecognized' }) };
    } catch { observation = { executable, detail: 'version query could not run' }; }
    cache.set(executable, observation);
    return observation;
  };
}
