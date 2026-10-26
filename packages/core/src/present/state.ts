import { writeFileSync } from 'node:fs';
import type { Tmux } from '../tmux/client.js';

/**
 * Show a session's agent state on every terminal attached to it (spec §6, §7).
 *
 * Sequences are written straight to each client's tty, past tmux, so the
 * outer terminal sees them:
 * - OSC 9;4 progress: VS Code renders it through `${progress}` in the tab
 *   description (3 = spinner, 4 = warning, 0 = clear);
 * - OSC 2 title: VS Code's `${sequence}`, iTerm2's tab title;
 * - iTerm2 only (detected from tmux's client_termtype): a badge and tab colour.
 */

const GLYPH: Record<string, string> = { working: '●', waiting: '◐', done: '✓' };
const PROGRESS: Record<string, string> = { working: '3', waiting: '4', done: '0' };
const ITERM_COLOUR: Record<string, [number, number, number]> = {
  working: [70, 130, 230],
  waiting: [235, 170, 40],
  done: [80, 180, 100],
};

const OSC = '\x1b]';
const ST = '\x07';

export function sequencesFor(state: string, session: string, iterm2: boolean): string {
  const glyph = GLYPH[state];
  let out = `${OSC}9;4;${PROGRESS[state] ?? '0'};0${ST}`;
  out += `${OSC}2;${glyph ? `${glyph} ` : ''}${session}${ST}`;
  if (iterm2) {
    const badge = Buffer.from(glyph ? `${glyph} ${state}` : '').toString('base64');
    out += `${OSC}1337;SetBadgeFormat=${badge}${ST}`;
    const colour = ITERM_COLOUR[state];
    if (colour) {
      ['red', 'green', 'blue'].forEach((channel, i) => {
        out += `${OSC}6;1;bg;${channel};brightness;${colour[i]}${ST}`;
      });
    } else {
      out += `${OSC}6;1;bg;*;default${ST}`;
    }
  }
  return out;
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

/** Write the state to each attached terminal; failures are ignored (best effort). */
export function presentState(tmux: Tmux, session: string, state: string, clients = clientsOf(tmux, session)): number {
  let written = 0;
  for (const client of clients) {
    try {
      writeFileSync(client.tty, sequencesFor(state, session, /iterm/i.test(client.termtype)));
      written++;
    } catch {
      // A client that went away or a tty we cannot write is not an error.
    }
  }
  return written;
}
