import { socketPathFor } from './config/index.js';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import type { Context } from './context.js';
import type { Tools } from './iterm2/install.js';

/** Match executable-file PATH search; explicit paths never search PATH. */
export function executableOnPath(name: string, env = process.env, cwd = process.cwd()): string | undefined {
  if (!name) return undefined;
  const candidates = name.includes('/') ? [resolve(cwd, name)]
    : (env.PATH === undefined ? ['/usr/bin', '/bin'] : env.PATH.split(delimiter)).map((dir) => resolve(cwd, dir || '.', name));
  return candidates.find((file) => {
    try { accessSync(file, constants.X_OK); return statSync(file).isFile(); }
    catch { return false; }
  });
}

/** Absolute executable path, or the original command when unavailable. */
export function resolveBinary(name: string, env = process.env): string {
  return executableOnPath(name, env) ?? name;
}

export function toolsFor(ctx: Context, cliPath: string): Tools {
  const env = Object.fromEntries(['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'BERTH_CONFIG', 'BERTH_STATE_DIR'].flatMap((key) => ctx.env[key] ? [[key, ctx.env[key]!]] : []));
  return { node: process.execPath, cli: cliPath, tmux: resolveBinary(ctx.config.tmuxBin, ctx.env), socketPath: socketPathFor(ctx.config.tmuxSocket, ctx.config.tmuxSocketPath, ctx.env), path: ctx.env.PATH, env };
}
