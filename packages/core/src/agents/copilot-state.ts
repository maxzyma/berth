import { join } from 'node:path';
import { agentRoot } from './roots.js';
import { transcriptCursor, transcriptTail } from './transcript-cursor.js';

function headerMatches(header: Record<string, unknown>, conversation: string): boolean {
  const data = header.data;
  return header.type === 'session.start' && !!data && typeof data === 'object'
    && 'sessionId' in data && data.sessionId === conversation;
}

export function copilotCursor(conversation: string, env: NodeJS.ProcessEnv): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(conversation)) return '';
  const root = agentRoot('copilot', env);
  return transcriptCursor(join(root, 'session-state', conversation, 'events.jsonl'), root,
    (header) => headerMatches(header, conversation));
}

/** Retry hooks are not terminal: require the native root turn-end and outcome. */
export function copilotState(value: string | undefined, conversation: string, env: NodeJS.ProcessEnv): '' | 'working' | undefined {
  try {
    const tail = transcriptTail(value, agentRoot('copilot', env), (header) => headerMatches(header, conversation));
    if (!tail) return undefined;
    let turnId: string | undefined;
    let ended = false;
    let inactive = false;
    let pending: Readonly<Record<string, string>> = {};
    let completed = false;
    let resumed = false;
    for (const line of tail.lines) {
      const row = JSON.parse(line);
      const data = row?.data;
      if (!row || typeof row.type !== 'string' || !data || typeof data !== 'object' || Array.isArray(data)) return undefined;
      if (['assistant.turn_end', 'session.error', 'abort'].includes(row.type)
        && (data.agentId || data.parentAgentId || data.parentToolCallId || data.parentAgentTaskId)) return undefined;
      if (['hook.start', 'hook.end', 'session.usage_record'].includes(row.type)) continue;
      const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
      if (!Number.isFinite(timestamp) || timestamp < tail.at || timestamp > Date.now()) return undefined;
      if (row.type === 'permission.requested') {
        const id = data.requestId;
        const tool = data.permissionRequest?.toolCallId;
        if (typeof id !== 'string' || !id || typeof tool !== 'string' || !tool
          || data.ownerSessionId !== conversation || Object.hasOwn(pending, id)) return undefined;
        pending = { ...pending, [id]: tool };
        resumed = false;
      } else if (row.type === 'permission.completed') {
        const id = data.requestId;
        if (typeof id !== 'string' || !Object.hasOwn(pending, id) || pending[id] !== data.toolCallId
          || !data.result || typeof data.result.kind !== 'string') return undefined;
        const { [id]: settled, ...remaining } = pending;
        pending = remaining;
        completed = true;
      }
      if (row.type === 'assistant.turn_end') {
        ended = typeof data.turnId === 'string' && data.turnId.length > 0
          && (turnId === undefined || data.turnId === turnId);
        inactive = false;
        resumed = false;
      } else if (row.type === 'session.error') {
        inactive = ended && typeof data.errorType === 'string' && typeof data.message === 'string' && data.message.trim().length > 0;
      } else if (row.type === 'abort') {
        inactive = ended && data.reason === 'user_initiated';
      } else {
        if (!['assistant.message', 'tool.execution_start', 'tool.execution_complete', 'system.message',
          'permission.requested', 'permission.completed', 'assistant.turn_start'].includes(row.type)) resumed = false;
        if (row.type === 'user.message') { turnId = undefined; completed = false; resumed = false; pending = {}; }
        if (row.type === 'assistant.turn_start') {
          turnId = typeof data.turnId === 'string' ? data.turnId : undefined;
          resumed = !!turnId && completed && Object.keys(pending).length === 0;
        }
        ended = false;
        inactive = false;
      }
    }
    return inactive ? '' : resumed && Object.keys(pending).length === 0 ? 'working' : undefined;
  } catch { return undefined; }
}
