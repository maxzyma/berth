import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import type { Context } from './context.js';
import type { Tools } from './iterm2/install.js';

/** Absolute path of a binary on PATH, or the name unchanged when not found. */
export function resolveBinary(name: string, env = process.env): string {
  if (isAbsolute(name)) return name;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  return name;
}

export function toolsFor(ctx: Context, cliPath: string): Tools {
  return { node: process.execPath, cli: cliPath, tmux: resolveBinary(ctx.config.tmuxBin), socket: ctx.config.tmuxSocket, path: process.env.PATH };
}
