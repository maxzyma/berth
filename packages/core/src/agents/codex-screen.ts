/** Version-tested Codex TUI presentation evidence; never a binding authority. */
export interface CodexScreen {
  working: boolean;
  /** Best-effort visible prompt excerpt, never a persisted topic or identity. */
  terminalPreview?: string;
  /** Complete native-footer candidate only; callers must not bind from this. */
  conversationCandidate?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUNNING = /^\s*[•●◦·]\s+(?:Working|Thinking|Waiting for background terminal)\s+\([^\n]*\besc to interrupt\)(?:\s.*)?$/;

function visiblePrompt(lines: string[]): string | undefined {
  const index = lines.reduce((last, line, i) => /^›(?:\s|$)/.test(line) ? i : last, -1);
  if (index < 0) return undefined;
  // A textual excerpt cannot authenticate a message. Exclude common quoted/code
  // shapes and require response output after the most recent visible prompt.
  if (lines.some(line => /^\s*(?:```|~~~)/.test(line))) return undefined;
  const text = lines[index].slice(1).trim();
  if (!text || text.startsWith('/') || /[\x00-\x1f\x7f]/.test(text)) return undefined;
  if (!lines.slice(index + 1).some(line => /^[•●◦·]\s+\S/.test(line))) return undefined;
  return Array.from(text).slice(0, 120).join('');
}

/** Input must be the visible grid, with no scrollback and no ANSI sequences. */
export function codexScreen(viewport: string): CodexScreen | undefined {
  if (viewport.length > 256 * 1024 || /\x1b/.test(viewport)) return undefined;
  const lines = viewport.split('\n');
  const composer = lines.reduce((last, line, index) => /^\s*›(?:\s|$)/.test(line) ? index : last, -1);
  if (composer < 0) return undefined;
  const footer = lines.slice(composer + 1).filter(line => line.trim());
  if (!footer.length || footer.length > 4) return undefined;
  // Require the native footer, not a prompt quoted somewhere in the transcript.
  const status = footer[0].trim();
  const parts = status.split(/\s+·\s+/);
  const ids = parts.filter(part => UUID.test(part));
  const nativeStatus = /\bContext \d+% used\b|\b\d+% context left\b/.test(status);
  const defaultStatus = lines.slice(0, composer).some(line => /^\s*>_ OpenAI Codex \(v[\d.]+\)\s*$/.test(line))
    && /^\S+ (?:default|none|minimal|low|medium|high|xhigh|max|ultra)\s+·\s+\S/.test(status);
  if (!nativeStatus && !defaultStatus && ids.length !== 1) return undefined;
  if (footer.slice(1).some(line => !/^\s*(?:[?←⚠]|\d+% context left)/.test(line))) return undefined;
  // Runtime widgets can include a tip or quota warning before the composer.
  const tail = lines.slice(Math.max(0, composer - 8), composer);
  const indicator = tail.reduce((last, line, index) => RUNNING.test(line) ? index : last, -1);
  const trailing = indicator < 0 ? [] : tail.slice(indicator + 1).filter(line => line.trim());
  const working = indicator >= 0 && trailing.every(line => /^\s*(?:↳\s*Tip:|⚠)/.test(line));
  const terminalPreview = visiblePrompt(lines.slice(0, composer));
  return { working, ...(terminalPreview ? { terminalPreview } : {}),
    ...(ids.length === 1 ? { conversationCandidate: ids[0] } : {}) };
}
