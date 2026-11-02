import { agentRoot } from './roots.js';
import { transcriptCursor, transcriptTail } from './transcript-cursor.js';

export function geminiCursor(file: unknown, conversation: string, env: NodeJS.ProcessEnv): string {
  return transcriptCursor(file, agentRoot('gemini', env), (header) => header.sessionId === conversation);
}

/** Native cancellation is terminal; an error additionally needs a completed-loop acknowledgement. */
export function geminiInactive(value: string | undefined, conversation: string, env: NodeJS.ProcessEnv, completed = false): boolean {
  try {
    const tail = transcriptTail(value, agentRoot('gemini', env), (header) => header.sessionId === conversation);
    if (!tail) return false;
    let last: Record<string, unknown> | undefined;
    for (const line of tail.lines) {
      const data: unknown = JSON.parse(line);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      const row = data as Record<string, unknown>;
      if (typeof row.type === 'string') last = row;
      else if (typeof row.$rewindTo === 'string' && row.$rewindTo.length > 0) continue;
      else if (!row.$set || typeof row.$set !== 'object' || Array.isArray(row.$set)) return false;
    }
    const timestamp = typeof last?.timestamp === 'string' ? Date.parse(last.timestamp) : NaN;
    if (!last || typeof last.id !== 'string' || !Number.isFinite(timestamp)
      || timestamp < tail.at || timestamp > Date.now()) return false;
    const content = typeof last.content === 'string' ? last.content : '';
    if (last.type === 'info' && ['Request cancelled.', 'User cancelled the request.'].includes(content)) return true;
    return completed && ((last.type === 'error' && content.trim().length > 0) || (last.type === 'info' && [
      'This request failed. Press F12 for diagnostics, or run /settings and change "Error Verbosity" to full for full details.',
      'Some internal tool attempts failed before this final error. Press F12 for diagnostics, or run /settings and change "Error Verbosity" to full for details.',
    ].includes(content)));
  } catch { return false; }
}
