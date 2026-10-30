import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { shellQuote } from '../shell.js';
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
  const berth = `${shellQuote(process.execPath)} ${shellQuote(cliPath)} --socket-path #{q:socket_path}`;
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

function withoutBlock(text: string): string {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < start) return text;
  return (text.slice(0, start) + text.slice(end + END.length)).replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

export function installTmux(tmux: Tmux, cliPath: string, env = process.env): string {
  const file = tmuxConfPath(env);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = hookArgs(cliPath).map((args) => args.map((a, i) => (i === 3 ? `'${a.replace(/'/g, `'\\''`)}'` : a)).join(' '));
  const block = [BEGIN, '# Managed by berth; remove with `berth tmux uninstall`.', ...lines, END].join('\n');
  const base = withoutBlock(current).replace(/\s*$/, '');
  writeFileSync(file, `${base ? `${base}\n\n` : ''}${block}\n`);
  if (tmux.serverRunning()) for (const args of hookArgs(cliPath)) tmux.run(args, true);
  return file;
}

export function uninstallTmux(tmux: Tmux, env = process.env): string {
  const file = tmuxConfPath(env);
  if (existsSync(file)) {
    const rest = withoutBlock(readFileSync(file, 'utf8')).replace(/\s*$/, '');
    writeFileSync(file, rest ? `${rest}\n` : '');
  }
  if (tmux.serverRunning()) for (const event of [...EVENTS, 'alert-bell', ...ATTACH_EVENTS]) tmux.run(['set-hook', '-gu', `${event}[${INDEX}]`], true);
  return file;
}
