import { shellQuote } from '../shell.js';
import { dirname, sep } from 'node:path';
import { environmentProbe, type EnvironmentProbe } from './environment.js';

export interface DependencyInstall {
  executable: string;
  args: string[];
  display: string;
}

/** A plan only: callers must obtain an explicit user choice before execution. */
export function dependencyInstall(dependency: 'tmux' | 'node', env: NodeJS.ProcessEnv,
  probe: EnvironmentProbe = environmentProbe(env), uid = process.getuid?.()): DependencyInstall | undefined {
  if (!['darwin', 'linux'].includes(probe.platform)) return undefined;
  const brew = probe.find('brew');
  if (brew) {
    const existing = probe.find(dependency);
    if (existing && !existing.startsWith(dirname(dirname(brew)) + sep)) return undefined;
    const action = probe.find(dependency) ? 'upgrade' : 'install';
    return { executable: brew, args: [action, dependency], display: `${shellQuote(brew)} ${action} ${dependency}` };
  }
  if (probe.platform !== 'linux') return undefined;
  const apt = probe.find('apt-get');
  const manager = apt ?? probe.find('dnf');
  if (!manager) return undefined;
  const existing = probe.find(dependency);
  if (existing && !existing.startsWith(dirname(dirname(manager)) + sep)) return undefined;
  const packages = dependency === 'node' ? ['nodejs', 'npm'] : ['tmux'];
  const args = ['install', '-y', ...packages];
  if (uid === 0) return { executable: manager, args, display: `${shellQuote(manager)} ${args.join(' ')}` };
  const sudo = probe.find('sudo');
  return sudo ? { executable: sudo, args: [manager, ...args], display: `${shellQuote(sudo)} ${shellQuote(manager)} ${args.join(' ')}` } : undefined;
}
