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

function targetsExist(runtime: string, cli: string): boolean {
  return accessible(runtime, constants.X_OK) && accessible(cli, constants.R_OK);
}

/** Accept only the shell command shape Berth writes; never execute it to inspect it. */
function validCommand(value: unknown, agent: string, event: string): boolean {
  if (typeof value !== 'string' || !value.startsWith(`${MARKER} `)) return false;
  const words = shellSplit(value);
  if (words[0] !== MARKER) return false;
  const electron = words[1] === 'ELECTRON_RUN_AS_NODE=1';
  const offset = electron ? 2 : 1;
  const args = words.slice(offset);
  if (args.length !== 5 || args[2] !== 'hook' || args[3] !== agent || args[4] !== event) return false;
  const canonical = `${MARKER} ${electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}${shellQuote(args[0])} ${shellQuote(args[1])} hook ${agent} ${shellQuote(event)}`;
  return value === canonical && targetsExist(args[0], args[1]);
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

function pluginComplete(text: string, events: string[]): boolean {
  const match = /const child = spawn\(("(?:[^"\\]|\\.)*"), \[("(?:[^"\\]|\\.)*"), 'hook', 'opencode', event\]/.exec(text);
  if (!match) return false;
  const runtime = JSON.parse(match[1]) as string, cli = JSON.parse(match[2]) as string;
  return targetsExist(runtime, cli) && [false, true].some((electron) => text === opencodePlugin(runtime, cli, events, electron));
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
