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
  const berth = `${shellQuote(process.execPath)} ${shellQuote(cliPath)}`;
  const snapshot = `${berth} snapshot >/dev/null 2>&1`;
  // A bell asks for attention: agents without hooks become `waiting`.
  const bell = `${berth} bell --session '#{session_name}' >/dev/null 2>&1`;
  // Marks iTerm2 panes with their session and shows state on the new client (spec §7.3).
  const attached = `${berth} attached --session '#{session_name}' --tty '#{client_tty}' --termtype '#{client_termtype}' >/dev/null 2>&1`;
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
