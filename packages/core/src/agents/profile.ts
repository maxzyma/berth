import { configPath } from '../config/index.js';
import type { Context } from '../context.js';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { BerthError } from '../errors.js';
import { agentRoot } from './roots.js';

/** Only directory selectors belong to recoverable identity; credentials never do. */
export interface AgentProfile { environment: Record<string, string> }
const ROOT_KEYS: Record<string, string> = {
  claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME', gemini: 'GEMINI_CLI_HOME', qoder: 'QODER_CONFIG_DIR',
  copilot: 'COPILOT_HOME', kimi: 'KIMI_CODE_HOME', opencode: 'XDG_CONFIG_HOME',
};
export function profileKeys(agent: string): string[] {
  return [...new Set(['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', ...(ROOT_KEYS[agent] ? [ROOT_KEYS[agent]] : [])])];
}

export function captureProfile(agent: string, env: NodeJS.ProcessEnv = process.env): AgentProfile {
  const values: NodeJS.ProcessEnv = { ...env, HOME: env.HOME || homedir() };
  const environment = Object.fromEntries(profileKeys(agent).flatMap((key) => {
    const value = values[key];
    if (!value) return [];
    if (!isAbsolute(value) || /[\r\n\x1f]/.test(value)) throw new BerthError(`Agent profile ${key} must be an absolute single-line path.`);
    return [[key, value]];
  }));
  return { environment };
}

export function readProfile(agent: string, value: unknown): AgentProfile | undefined {
  if (typeof value === 'string') {
    try { return readProfile(agent, JSON.parse(value)); } catch { return undefined; }
  }
  if (!value || typeof value !== 'object' || !('environment' in value)) return undefined;
  const env = value.environment;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return undefined;
  const entries = Object.entries(env);
  const keys = profileKeys(agent);
  if (!entries.some(([key, path]) => key === 'HOME' && typeof path === 'string' && path.length > 0)
    || entries.some(([key, path]) => !keys.includes(key) || typeof path !== 'string' || !isAbsolute(path) || /[\r\n\x1f]/.test(path))) return undefined;
  return { environment: Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))) as Record<string, string> };
}

export function profileEnvironment(agent: string, profile: AgentProfile, base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const retained = Object.fromEntries(Object.entries(base).filter(([key]) => !profileKeys(agent).includes(key)));
  return { ...retained, ...profile.environment };
}

export function profileKey(agent: string, profile: AgentProfile): string {
  return JSON.stringify([agent, Object.entries(profile.environment).sort(([a], [b]) => a.localeCompare(b))]);
}

export function profileRoot(agent: string, profile: AgentProfile): string {
  return agentRoot(agent, profile.environment);
}

export function profileAtRoot(agent: string, env: NodeJS.ProcessEnv, root: string): AgentProfile {
  const key = ROOT_KEYS[agent];
  if (agent === 'opencode' && basename(root) !== 'opencode') throw new BerthError('Choose the opencode folder inside its XDG configuration directory.');
  if (agent === 'gemini' && basename(root) !== '.gemini') throw new BerthError('Choose the .gemini folder inside the Gemini home directory.');
  if (!key && basename(root) !== `.${agent}`) throw new BerthError(`Choose the .${agent} folder inside the agent home directory.`);
  return captureProfile(agent, { ...env, [key || 'HOME']: agent === 'opencode' || agent === 'gemini' || !key ? dirname(root) : root });
}


/** Route hooks back to this state owner while refreshing the agent's profile. */
export function applyLaunchEnvironment(ctx: Context, name: string, agent: string, profile: AgentProfile): void {
  ctx.tmux.setEnvironment(name, {
    ...Object.fromEntries(profileKeys(agent).map((key) => [key, profile.environment[key]])),
    ...(ctx.env.PATH !== undefined ? { PATH: ctx.env.PATH } : {}),
    BERTH_CONFIG: resolve(configPath(ctx.env)),
    BERTH_STATE_DIR: dirname(dirname(ctx.config.stateDir)),
  });
}
