import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'smol-toml';
import { BerthError, ExitCode } from '../errors.js';

export interface AgentOverride {
  launch?: string;
  resume?: string;
}

export interface BerthConfig {
  tmuxBin: string;
  tmuxSocket?: string;
  /** `-S` socket path; set by tmux hooks, which know the server they run in. */
  tmuxSocketPath?: string;
  stateDir: string;
  snapshotRoot: string;
  legacySnapshotRoot?: string;
  scrollbackLines: number;
  retention: number;
  agents: Record<string, AgentOverride>;
  /** Manage sessions found running an agent without being stamped (spec §4.3). */
  autoAdopt: boolean;
  /** Command a restored iTerm2 pane runs to attach; `{session}` is the session name (spec §7.3). */
  iterm2Attach?: string;
}

type Env = Record<string, string | undefined>;

export function configPath(env: Env): string {
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

function canonical(path: string): string {
  try { return realpathSync(path); }
  catch {
    const absolute = resolve(path);
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(canonical(parent), basename(absolute));
  }
}

/** Resolve the full endpoint once for persistence and host attachment. */
export function socketPathFor(socket: string | undefined, path: string | undefined, env: Env): string {
  const directory = canonical(join(env.TMUX_TMPDIR || '/tmp', `tmux-${process.getuid?.() ?? 0}`));
  const inherited = !socket && !path ? env.TMUX?.split(',')[0] : undefined;
  const endpoint = path || inherited || join(directory, socket || 'default');
  return join(canonical(dirname(resolve(endpoint))), basename(endpoint));
}

/** Same endpoint through -L/-S shares state; different directories never do. */
export function socketIdentity(socket: string | undefined, path: string | undefined, env: Env): string {
  const uid = process.getuid?.() ?? 0;
  const standard = canonical(`/tmp/tmux-${uid}`);
  const endpoint = socketPathFor(socket, path, env);
  const parent = canonical(dirname(resolve(endpoint)));
  if (parent === standard) return basename(endpoint);
  return `socket-${createHash('sha256').update(join(parent, basename(endpoint))).digest('hex')}`;
}

/** Precedence: environment > config file > defaults (flags are applied by the CLI). */
export function loadConfig(env: Env = process.env): BerthConfig {
  const file = readFile(configPath(env));
  const tmux = (file.tmux ?? {}) as Record<string, unknown>;
  const snapshot = (file.snapshot ?? {}) as Record<string, unknown>;
  const tmuxSocket = env.BERTH_TMUX_SOCKET || (typeof tmux.socket === 'string' ? tmux.socket : undefined);
  const tmuxSocketPath = env.BERTH_TMUX_SOCKET_PATH || (!tmuxSocket ? env.TMUX?.split(',')[0] : undefined) || undefined;
  // State is per tmux server: snapshots and locks of one server never restore
  // into another. Canonical endpoint identity also covers custom socket directories.
  const server = socketIdentity(tmuxSocket, tmuxSocketPath, env);
  const baseState = env.BERTH_STATE_DIR || (typeof file.state_dir === 'string' ? file.state_dir : defaultStateDir(env));
  const stateDir = join(baseState, 'servers', server);
  const legacyKey = basename(tmuxSocketPath || tmuxSocket || 'default');
  const legacyRoot = typeof snapshot.root === 'string' ? join(snapshot.root, legacyKey) : join(baseState, 'servers', legacyKey, 'snapshots');
  return {
    tmuxBin: env.BERTH_TMUX || (typeof tmux.binary === 'string' ? tmux.binary : 'tmux'),
    tmuxSocket,
    tmuxSocketPath,
    stateDir,
    legacySnapshotRoot: server !== legacyKey && existsSync(legacyRoot) ? legacyRoot : undefined,
    snapshotRoot: typeof snapshot.root === 'string' ? join(snapshot.root, server) : join(stateDir, 'snapshots'),
    scrollbackLines: positiveInt(snapshot.scrollback_lines, 'snapshot.scrollback_lines', 3000),
    retention: positiveInt(snapshot.keep, 'snapshot.keep', 5),
    agents: agentOverrides(file.agents),
    autoAdopt: env.BERTH_AUTO_ADOPT ? env.BERTH_AUTO_ADOPT !== '0' : (file.sessions as Record<string, unknown> | undefined)?.auto_adopt !== false,
    iterm2Attach: typeof (file.iterm2 as Record<string, unknown> | undefined)?.attach === 'string'
      ? ((file.iterm2 as Record<string, unknown>).attach as string)
      : undefined,
  };
}
