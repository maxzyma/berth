import { existsSync, readFileSync } from 'node:fs';
import { targetsExist } from '../agents/hook-health.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { shellQuote, shellSplit } from '../shell.js';
import { formatLiteral } from './fields.js';
import { writeConfigFile } from '../config/write.js';
import type { Tmux } from './client.js';

/**
 * `berth tmux install` (spec §5.3): a managed block in the user's tmux config
 * that snapshots on session create / rename / close. Hooks use a fixed array
 * index so the user's own hooks for the same events stay in place.
 */
const BEGIN = '# >>> berth >>>';
const END = '# <<< berth <<<';
const EVENTS = ['session-created', 'session-renamed', 'session-closed'];
const ATTACH_EVENTS = ['client-attached', 'client-session-changed'];
const INDEX = 97;

/** The program a hook runs; an editor runtime runs in Node mode (spec §8). */
export interface HookRuntime { executable: string; electron: boolean }
const currentRuntime = (): HookRuntime => ({ executable: process.execPath, electron: process.env.ELECTRON_RUN_AS_NODE === '1' });

function hookArgs(cliPath: string, runtime: HookRuntime): string[][] {
  // Hooks are global in the user's tmux config and run in whichever server
  // fires them: pass that server's socket so state stays per server. #{q:}
  // quotes values for the shell (session names may contain quotes).
  const mode = runtime.electron ? 'ELECTRON_RUN_AS_NODE=1 ' : '';
  const berth = `${mode}${formatLiteral(shellQuote(runtime.executable))} ${formatLiteral(shellQuote(cliPath))} --socket-path #{q:socket_path}`;
  // `|| true`: tmux prints a failed run-shell into the pane; a hook must never disturb it.
  const quiet = '>/dev/null 2>&1 || true';
  const snapshot = `${berth} snapshot ${quiet}`;
  // A bell asks for attention: agents without hooks become `waiting`.
  const bell = `${berth} bell --session #{q:session_name} ${quiet}`;
  // Marks iTerm2 panes with their session and shows state on the new client (spec §7.3).
  // Global current-client formats can point elsewhere; client hooks supply hook_client.
  const attached = `${berth} attached --client=#{q:hook_client} ${quiet}`;
  return [
    ...EVENTS.map((event) => ['set-hook', '-g', `${event}[${INDEX}]`, `run-shell -b ${JSON.stringify(snapshot)}`]),
    ['set-hook', '-g', `alert-bell[${INDEX}]`, `run-shell -b ${JSON.stringify(bell)}`],
    ...ATTACH_EVENTS.map((event) => ['set-hook', '-g', `${event}[${INDEX}]`, `run-shell -b ${JSON.stringify(attached)}`]),
  ];
}

export function tmuxConfPath(env = process.env): string {
  return join(env.HOME || homedir(), '.tmux.conf');
}

function replaceBlock(text: string, replacement: string): string {
  const starts = [...text.matchAll(/^[\t ]*# >>> berth >>>[\t ]*\r?$/gm)];
  const ends = [...text.matchAll(/^[\t ]*# <<< berth <<<[\t ]*\r?$/gm)];
  if (!starts.length && !ends.length) return `${text}${replacement && text && !text.endsWith('\n') ? '\n' : ''}${replacement}`;
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index! >= ends[0].index!) {
    throw new Error('Invalid Berth managed block in tmux configuration; repair its markers before retrying.');
  }
  const end = ends[0].index! + ends[0][0].length;
  return text.slice(0, starts[0].index) + replacement + text.slice(text[end] === '\n' ? end + 1 : end);
}

function applyHooks(tmux: Tmux, commands: string[][], file: string): void {
  try {
    if (tmux.serverRunning()) for (const args of commands) tmux.run(args);
  } catch (error) {
    throw new Error(`Configuration-file changes are complete (${file}), but running tmux hooks could not be updated: ${error instanceof Error ? error.message : String(error)}. Retry the command to finish the live update.`);
  }
}

function managedBlock(cliPath: string, runtime: HookRuntime): string {
  const lines = hookArgs(cliPath, runtime).map((args) => args.map((a, i) => (i === 3 ? `'${a.replace(/'/g, `'\\''`)}'` : a)).join(' '));
  return [BEGIN, '# Managed by berth; remove with `berth tmux uninstall`.', ...lines, END].join('\n');
}

export function installTmux(tmux: Tmux, cliPath: string, env = process.env, runtime = currentRuntime()): string {
  const file = tmuxConfPath(env);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeConfigFile(file, replaceBlock(current, `${managedBlock(cliPath, runtime)}\n`));
  applyHooks(tmux, hookArgs(cliPath, runtime), file);
  return file;
}

/**
 * State of the managed block against the one this runtime would write (spec §8):
 * `current`, `missing` (never installed), `broken` (its runtime or CLI file is
 * gone, so its silenced hooks run nothing) or `other` (a different, present
 * Berth installation). `block` identifies an inspected block for remembered answers.
 */
export function inspectTmuxHooks(cliPath: string, env = process.env, runtime = currentRuntime()):
  { state: 'current' | 'missing' | 'broken' | 'other'; block?: string; target?: string } {
  const file = tmuxConfPath(env);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const start = text.indexOf(BEGIN), end = text.indexOf(END, start);
  if (start < 0 || end < 0) return { state: 'missing' };
  const block = text.slice(start, end + END.length);
  if (block === managedBlock(cliPath, runtime)) return { state: 'current', block };
  const target = hookTarget(block);
  return { state: target && targetsExist(target.executable, target.cli) ? 'other' : 'broken', block, target: target?.cli };
}

/** The runtime and CLI a written snapshot hook runs; undefined when the line is not Berth's shape. */
function hookTarget(block: string): { executable: string; cli: string } | undefined {
  const line = block.split('\n').find((candidate) => candidate.startsWith(`set-hook -g session-created[${INDEX}] '`));
  if (!line?.endsWith("'")) return undefined;
  const hook = line.slice(line.indexOf("'") + 1, -1).replace(/'\\''/g, "'");
  if (!hook.startsWith('run-shell -b "')) return undefined;
  try {
    const words = shellSplit(JSON.parse(hook.slice('run-shell -b '.length)) as string);
    const [executable, cli] = words[0] === 'ELECTRON_RUN_AS_NODE=1' ? words.slice(1) : words;
    return executable && cli ? { executable: executable.replaceAll('##', '#'), cli: cli.replaceAll('##', '#') } : undefined;
  } catch { return undefined; }
}

export function uninstallTmux(tmux: Tmux, env = process.env): string {
  const file = tmuxConfPath(env);
  if (existsSync(file)) {
    const current = readFileSync(file, 'utf8');
    const rest = replaceBlock(current, '');
    if (rest !== current) writeConfigFile(file, rest);
  }
  applyHooks(tmux, [...EVENTS, 'alert-bell', ...ATTACH_EVENTS].map((event) => ['set-hook', '-gu', `${event}[${INDEX}]`]), file);
  return file;
}
