import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { BerthError, ExitCode } from '../errors.js';

export interface AgentOverride {
  launch?: string;
  resume?: string;
}

export interface BerthConfig {
  tmuxBin: string;
  tmuxSocket?: string;
  stateDir: string;
  snapshotRoot: string;
  scrollbackLines: number;
  retention: number;
  agents: Record<string, AgentOverride>;
  /** Command a restored iTerm2 pane runs to attach; `{session}` is the session name (spec §7.3). */
  iterm2Attach?: string;
}

type Env = Record<string, string | undefined>;

function configPath(env: Env): string {
  if (env.BERTH_CONFIG) return env.BERTH_CONFIG;
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, 'berth', 'config.toml');
}

function defaultStateDir(env: Env): string {
  const base = env.XDG_STATE_HOME || join(env.HOME || homedir(), '.local', 'state');
  return join(base, 'berth');
}

function readFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new BerthError(`cannot read config ${path}: ${(error as Error).message}`, ExitCode.usage);
  }
}

function positiveInt(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BerthError(`config: ${name} must be a positive integer`, ExitCode.usage);
  }
  return value;
}

function agentOverrides(value: unknown): Record<string, AgentOverride> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null) throw new BerthError('config: [agents] must be a table', ExitCode.usage);
  const result: Record<string, AgentOverride> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const entry = raw as Record<string, unknown>;
    for (const key of ['launch', 'resume']) {
      if (entry[key] !== undefined && typeof entry[key] !== 'string') {
        throw new BerthError(`config: agents.${id}.${key} must be a string`, ExitCode.usage);
      }
    }
    result[id] = { launch: entry.launch as string | undefined, resume: entry.resume as string | undefined };
  }
  return result;
}

/** Precedence: environment > config file > defaults (flags are applied by the CLI). */
export function loadConfig(env: Env = process.env): BerthConfig {
  const file = readFile(configPath(env));
  const tmux = (file.tmux ?? {}) as Record<string, unknown>;
  const snapshot = (file.snapshot ?? {}) as Record<string, unknown>;
  const tmuxSocket = env.BERTH_TMUX_SOCKET || (typeof tmux.socket === 'string' ? tmux.socket : undefined);
  // State is per tmux server: snapshots and locks of one server never restore into another.
  const baseState = env.BERTH_STATE_DIR || (typeof file.state_dir === 'string' ? file.state_dir : defaultStateDir(env));
  const stateDir = join(baseState, 'servers', tmuxSocket ?? 'default');
  return {
    tmuxBin: env.BERTH_TMUX || (typeof tmux.binary === 'string' ? tmux.binary : 'tmux'),
    tmuxSocket,
    stateDir,
    snapshotRoot: typeof snapshot.root === 'string' ? snapshot.root : join(stateDir, 'snapshots'),
    scrollbackLines: positiveInt(snapshot.scrollback_lines, 'snapshot.scrollback_lines', 3000),
    retention: positiveInt(snapshot.keep, 'snapshot.keep', 5),
    agents: agentOverrides(file.agents),
    iterm2Attach: typeof (file.iterm2 as Record<string, unknown> | undefined)?.attach === 'string'
      ? ((file.iterm2 as Record<string, unknown>).attach as string)
      : undefined,
  };
}
