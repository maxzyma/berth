/** Dependencies are inspected in the execution host, independently of sessions. */
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { configPath } from '../config/index.js';
import type { Context } from '../context.js';
import { executableOnPath } from '../tools.js';
import { getAdapter } from '../agents/registry.js';
import { launchCommand } from '../agents/commands.js';
import { shellSplit } from '../shell.js';

export interface DependencyCheck {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
  repair?: 'tmux' | 'node';
}
export interface EnvironmentReport { checks: DependencyCheck[]; ready: boolean }
export function executionHostSupported(platform: string = process.platform): boolean {
  return platform === 'darwin' || platform === 'linux';
}
export interface EnvironmentOptions {
  externalNode?: boolean;
  editor?: boolean;
  agent?: string;
  launcher?: string;
  cwd?: string;
}
export interface EnvironmentProbe {
  platform: string;
  nodeVersion: string;
  executable: string;
  find(name: string, cwd?: string): string | undefined;
  version(file: string, args: string[]): string | undefined;
  writable(path: string, directory: boolean): boolean;
}

function writable(path: string, directory: boolean): boolean {
  try {
    if (existsSync(path)) {
      if (statSync(path).isDirectory() !== directory) return false;
      accessSync(path, constants.R_OK | (directory ? constants.W_OK | constants.X_OK : 0));
      return true;
    }
    let parent = dirname(path);
    while (!existsSync(parent)) {
      const next = dirname(parent);
      if (next === parent) return false;
      parent = next;
    }
    if (!statSync(parent).isDirectory()) return false;
    accessSync(parent, constants.W_OK | constants.X_OK);
    return true;
  } catch { return false; }
}

export function environmentProbe(env: NodeJS.ProcessEnv): EnvironmentProbe {
  return {
    platform: process.platform, nodeVersion: process.versions.node, executable: process.execPath,
    find: (name, cwd) => executableOnPath(name, env, cwd), writable,
    version: (file, args) => {
      const result = spawnSync(file, args, { env, encoding: 'utf8', timeout: 2500, killSignal: 'SIGKILL', maxBuffer: 65536 });
      return !result.error && result.status === 0 ? result.stdout.trim() : undefined;
    },
  };
}

function nodeSupported(version: string | undefined): boolean {
  return !!version && /^(?:v)?(\d+)\./.test(version) && Number(version.replace(/^v/, '').split('.')[0]) >= 20;
}

function executableCheck(id: string, label: string, binary: string, probe: EnvironmentProbe,
  kind: 'tmux' | 'node', cwd?: string): DependencyCheck {
  const file = probe.find(binary, cwd);
  const version = file ? probe.version(file, [kind === 'tmux' ? '-V' : '--version']) : undefined;
  const ok = kind === 'node' ? nodeSupported(version) : !!version && Number(/^tmux\s+(\d+)/.exec(version)?.[1]) >= 3;
  return { id, label, ok, required: true,
    detail: ok ? `${version} · ${file}` : `${binary}: ${version ?? (file ? 'could not run version check' : 'not found on this host PATH')}. Requires ${kind === 'node' ? 'Node.js 20+' : 'tmux 3.0+'}.`,
    ...(!ok && binary === kind ? { repair: kind } : {}),
  };
}

/** This check never launches agents, starts a tmux server or writes user files. */
export function checkEnvironment(ctx: Context, options: EnvironmentOptions = {},
  probe = environmentProbe(ctx.env)): EnvironmentReport {
  const platform = executionHostSupported(probe.platform);
  let checks: DependencyCheck[] = [
    { id: 'platform', label: 'Execution host', ok: platform, required: true,
      detail: platform ? probe.platform : 'Open Berth in a Linux/WSL, container or SSH workspace. Native Windows tmux is not supported.' },
    { id: 'runtime', label: options.editor ? 'Editor Node.js runtime' : 'Berth Node.js runtime',
      ok: nodeSupported(probe.nodeVersion), required: true,
      detail: `${probe.nodeVersion} · ${probe.executable}. ${options.editor ? 'Provided by the editor; update the editor if below Node.js 20. No separate Node.js installation is required.' : 'Requires Node.js 20 or later.'}` },
    executableCheck('tmux', 'tmux', ctx.config.tmuxBin, probe, 'tmux'),
    ...[
      ['state', 'Session state', ctx.config.stateDir, true],
      ['snapshots', 'Snapshots', ctx.config.snapshotRoot, true],
      ['config', 'Berth configuration', configPath(ctx.env), false],
    ].map(([id, label, path, directory]) => ({ id: String(id), label: String(label),
      ok: probe.writable(String(path), Boolean(directory)), required: true,
      detail: `${path} · requires ${directory ? 'directory' : 'file or parent directory'} access; correct permissions or the configured location if unavailable.` })),
  ];
  if (probe.platform === 'darwin') checks = [...checks, { id: 'perl', label: 'Recovery process inspection',
    ok: !!probe.find('/usr/bin/perl'), required: false,
    detail: 'System Perl is used for exact macOS launch arguments; missing Perl limits recovery verification.' }];
  if (platform) checks = [...checks,
    { id: 'lsof', label: 'Codex process inspection', ok: !!probe.find('lsof'), required: false,
      detail: 'lsof enables passive Codex conversation discovery. Install lsof on this execution host if this capability is needed; basic session use remains available.' },
    { id: 'sqlite3', label: 'Codex native conversation lookup', ok: !!probe.find('sqlite3'), required: false,
      detail: 'sqlite3 enables lookup in the Codex conversation index. Install sqlite3 on this execution host if this capability is needed; basic session use remains available.' },
  ];
  if (options.externalNode) {
    checks = [...checks, executableCheck('external-node', 'Standalone CLI Node.js', 'node', probe, 'node')];
    const npm = probe.find('npm');
    const version = npm ? probe.version(npm, ['--version']) : undefined;
    checks = [...checks, { id: 'npm', label: 'Standalone CLI package installer', ok: !!version, required: true,
      detail: version ? `${version} · ${npm}` : 'npm is unavailable in this host environment. Install Node.js with npm, or repair your existing Node.js manager.',
      ...(!npm && !probe.find('node') ? { repair: 'node' as const } : {}) }];
  }
  const adapter = options.agent ? getAdapter(options.agent) : undefined;
  const custom = options.agent !== 'shell' && (options.launcher || (options.agent && ctx.config.agents[options.agent]?.launch));
  if (custom) {
    const shell = ctx.env.SHELL || '/bin/sh';
    checks = [...checks, { id: 'launcher', label: 'Custom launcher shell', ok: !!probe.find(shell), required: true,
      detail: `Runs in ${shell}. Shell functions, variables and script dependencies are resolved by your terminal; Berth does not replace the script.` }];
  } else if (adapter) {
    const command = launchCommand({ adapter, name: 'new-session', cwd: options.cwd ?? '', overrides: ctx.config.agents });
    const [binary] = shellSplit(command);
    const file = binary ? probe.find(binary, options.cwd) : undefined;
    const defaultShell = adapter.id === 'shell' && !command.trim();
    checks = [...checks, { id: 'launcher', label: 'Selected launcher', ok: defaultShell || !!file, required: true,
      detail: defaultShell ? 'Uses the default shell configured in tmux.' : file ?? `Cannot resolve ${binary ?? 'the launcher'}. Install it or correct the terminal launcher; Berth will not replace it.` }];
  } else if (options.agent) checks = [...checks, { id: 'launcher', label: 'Selected agent', ok: false, required: true, detail: `Unknown agent: ${options.agent}` }];
  return { checks, ready: checks.every(check => check.ok || !check.required) };
}
