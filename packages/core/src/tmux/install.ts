import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { shellQuote } from '../shell.js';
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

function hookArgs(cliPath: string): string[][] {
  // Hooks are global in the user's tmux config and run in whichever server
  // fires them: pass that server's socket so state stays per server. #{q:}
  // quotes values for the shell (session names may contain quotes).
  const berth = `${formatLiteral(shellQuote(process.execPath))} ${formatLiteral(shellQuote(cliPath))} --socket-path #{q:socket_path}`;
  // `|| true`: tmux prints a failed run-shell into the pane; a hook must never disturb it.
  const quiet = '>/dev/null 2>&1 || true';
  const snapshot = `${berth} snapshot ${quiet}`;
  // A bell asks for attention: agents without hooks become `waiting`.
  const bell = `${berth} bell --session #{q:session_name} ${quiet}`;
  // Marks iTerm2 panes with their session and shows state on the new client (spec §7.3).
  // `--termtype=`: some terminals (VS Code) report none, and an empty word would drop the value.
  const attached = `${berth} attached --session #{q:session_name} --tty #{q:client_tty} --termtype=#{q:client_termtype} ${quiet}`;
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

export function installTmux(tmux: Tmux, cliPath: string, env = process.env): string {
  const file = tmuxConfPath(env);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = hookArgs(cliPath).map((args) => args.map((a, i) => (i === 3 ? `'${a.replace(/'/g, `'\\''`)}'` : a)).join(' '));
  const block = [BEGIN, '# Managed by berth; remove with `berth tmux uninstall`.', ...lines, END].join('\n');
  writeConfigFile(file, replaceBlock(current, `${block}\n`));
  applyHooks(tmux, hookArgs(cliPath), file);
  return file;
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
