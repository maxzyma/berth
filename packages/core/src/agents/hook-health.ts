import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { shellQuote, shellSplit } from '../shell.js';
import { hookFormat, MARKER, opencodePlugin } from './hook-files.js';
import type { Adapter } from './registry.js';

type RecordValue = Record<string, unknown>;
export type FileHookHealth = 'installed' | 'missing' | 'broken';
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};

function accessible(file: string, mode: number): boolean {
  try {
    if (!isAbsolute(file) || !statSync(file).isFile()) return false;
    accessSync(file, mode);
    return true;
  } catch { return false; }
}

export function targetsExist(runtime: string, cli: string): boolean {
  return accessible(runtime, constants.X_OK) && accessible(cli, constants.R_OK);
}

export interface HookTarget { runtime: string; cli: string }

/** The runtime and CLI of a command in the exact shape Berth writes; never execute it to inspect it. */
function commandTarget(value: unknown, agent: string, event?: string): HookTarget | undefined {
  if (typeof value !== 'string' || !value.startsWith(`${MARKER} `)) return undefined;
  const words = shellSplit(value);
  if (words[0] !== MARKER) return undefined;
  const electron = words[1] === 'ELECTRON_RUN_AS_NODE=1';
  const args = words.slice(electron ? 2 : 1);
  if (args.length !== 5 || args[2] !== 'hook' || args[3] !== agent || (event !== undefined && args[4] !== event)) return undefined;
  const canonical = `${MARKER} ${electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}${shellQuote(args[0])} ${shellQuote(args[1])} hook ${agent} ${shellQuote(args[4])}`;
  return value === canonical ? { runtime: args[0], cli: args[1] } : undefined;
}

function validCommand(value: unknown, agent: string, event: string): boolean {
  const target = commandTarget(value, agent, event);
  return !!target && targetsExist(target.runtime, target.cli);
}

function jsonComplete(text: string, adapter: Adapter, events: string[]): boolean {
  const data = record(JSON.parse(text));
  if (data.disableAllHooks === true) return false;
  const flat = adapter.hookTarget === 'cursor-hooks' || adapter.hookTarget === 'copilot-hooks';
  if (flat && data.version !== 1) return false;
  const hooks = record(data.hooks);
  return events.every((event) => {
    const groups = hooks[event];
    if (!Array.isArray(groups)) return false;
    const commands = flat ? groups : groups.flatMap((value) => {
      const group = record(value);
      if (group.matcher && group.matcher !== '*') return [];
      return Array.isArray(group.hooks) ? group.hooks : [];
    });
    return commands.some((value) => {
      const entry = record(value);
      return entry.type === 'command' && validCommand(entry.command, adapter.id, event);
    });
  });
}

function tomlComplete(text: string, adapter: Adapter, events: string[]): boolean {
  const hooks = parseToml(text).hooks;
  return Array.isArray(hooks) && events.every((event) => hooks.some((value) => {
    const entry = record(value);
    return entry.event === event && validCommand(entry.command, adapter.id, event);
  }));
}

function pluginTarget(text: string): HookTarget | undefined {
  const match = /const child = spawn\(("(?:[^"\\]|\\.)*"), \[("(?:[^"\\]|\\.)*"), 'hook', 'opencode', event\]/.exec(text);
  return match ? { runtime: JSON.parse(match[1]) as string, cli: JSON.parse(match[2]) as string } : undefined;
}

function pluginComplete(text: string, events: string[]): boolean {
  const target = pluginTarget(text);
  if (!target) return false;
  return targetsExist(target.runtime, target.cli) && [false, true].some((electron) => text === opencodePlugin(target.runtime, target.cli, events, electron));
}

/** Every command string in a JSON or TOML hook configuration. */
function hookCommands(text: string, adapter: Adapter): unknown[] {
  if (adapter.hookTarget === 'kimi-config') {
    const hooks = parseToml(text).hooks;
    return Array.isArray(hooks) ? hooks.map((value) => record(value).command) : [];
  }
  const hooks = record(record(JSON.parse(text)).hooks);
  return Object.values(hooks).flatMap((groups) => (Array.isArray(groups) ? groups : []).flatMap((value) => {
    const group = record(value);
    return Array.isArray(group.hooks) ? group.hooks.map((entry) => record(entry).command) : [group.command];
  }));
}

/**
 * The runtime and CLI that an agent's installed Berth hooks run, whether or not
 * those files still exist; undefined when no Berth hook is installed (spec §6).
 */
export function inspectHookTarget(adapter: Adapter, env: NodeJS.ProcessEnv): HookTarget | undefined {
  if (!adapter.hookTarget) return undefined;
  const file = hookFormat(adapter.hookTarget).file(env);
  try {
    if (!existsSync(file)) return undefined;
    const text = readFileSync(file, 'utf8');
    if (!text.includes(MARKER)) return undefined;
    if (adapter.hookTarget === 'opencode-plugin') return pluginTarget(text);
    for (const command of hookCommands(text, adapter)) {
      const target = commandTarget(command, adapter.id);
      if (target) return target;
    }
    return undefined;
  } catch { return undefined; }
}

/** Configuration health only; agent version and runtime delivery need separate evidence. */
export function inspectHooks(adapter: Adapter, env: NodeJS.ProcessEnv): FileHookHealth {
  if (!adapter.hookTarget) return 'missing';
  const file = hookFormat(adapter.hookTarget).file(env);
  try {
    if (!existsSync(file)) return 'missing';
    const text = readFileSync(file, 'utf8');
    if (!text.includes(MARKER)) return 'missing';
    const events = [...new Set(Object.values(adapter.events).flat())];
    const complete = adapter.hookTarget === 'opencode-plugin' ? pluginComplete(text, events)
      : adapter.hookTarget === 'kimi-config' ? tomlComplete(text, adapter, events)
        : jsonComplete(text, adapter, events);
    return complete ? 'installed' : 'broken';
  } catch { return 'broken'; }
}
