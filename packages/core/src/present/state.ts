import { appendFileSync } from 'node:fs';
import type { Tmux } from '../tmux/client.js';

/**
 * Show a session's agent state on every terminal attached to it (spec §6, §7.4).
 *
 * Sequences are written straight to each client's tty, past tmux, so the
 * outer terminal sees them. Which ones depends on the terminal, read from
 * tmux's client_termtype:
 * - iTerm2: its tab status sequence (OSC 21337) — a dot and a subtitle;
 * - others (VS Code's xterm.js among them): OSC 9;4 progress, which VS Code
 *   shows through `${progress}`, and an OSC 2 title.
 */

const GLYPH: Record<string, string> = { working: '●', waiting: '◐', done: '✓' };
const PROGRESS: Record<string, string> = { working: '3', waiting: '4', done: '0' };
const ITERM_COLOUR: Record<string, string> = { working: '#4f8fe6', waiting: '#ebaa28', done: '#50b464' };
const ITERM_TEXT: Record<string, string> = { working: 'working', waiting: 'waiting for you', done: 'done' };

const OSC = '\x1b]';
const ST = '\x07';

export function isIterm2(termtype: string): boolean {
  return /^iTerm2\b/i.test(termtype);
}

/** iTerm2's tab status may not contain the sequence separators. */
function statusText(text: string): string {
  return text.replace(/[;\x07\x1b]/g, ' ').trim().slice(0, 80);
}

export function sequencesFor(state: string, session: string, iterm2: boolean, note = ''): string {
  if (iterm2) {
    const colour = ITERM_COLOUR[state];
    if (!colour) return `${OSC}21337;indicator=;status=${ST}`;
    const text = statusText(state === 'waiting' && note ? note : ITERM_TEXT[state]);
    return `${OSC}21337;indicator=${colour};status=${text};status-color=${colour}${ST}`;
  }
  const glyph = GLYPH[state];
  return `${OSC}9;4;${PROGRESS[state] ?? '0'};0${ST}${OSC}2;${glyph ? `${glyph} ` : ''}${session}${ST}`;
}

export interface Client {
  tty: string;
  termtype: string;
}

export function clientsOf(tmux: Tmux, session: string): Client[] {
  const result = tmux.run(['list-clients', '-t', `=${session}`, '-F', '#{client_tty}\t#{client_termtype}'], true);
  if (!result.ok) return [];
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [tty, termtype = ''] = line.split('\t');
      return { tty, termtype };
    });
}

export interface PresentOptions {
  note?: string;
  clients?: Client[];
}

/** Write the state to each attached terminal; failures are ignored (best effort). */
export function presentState(tmux: Tmux, session: string, state: string, options: PresentOptions = {}): number {
  const clients = options.clients ?? clientsOf(tmux, session);
  let written = 0;
  for (const client of clients) {
    try {
      appendFileSync(client.tty, sequencesFor(state, session, isIterm2(client.termtype), options.note ?? ''));
      written++;
    } catch {
      // A client that went away or a tty we cannot write is not an error.
    }
  }
  return written;
}
