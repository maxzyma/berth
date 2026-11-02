/** Only root-turn events may supply a missed initial identity. */
const EVENTS: Readonly<Record<string, readonly string[]>> = {
  claude: ['UserPromptSubmit', 'Stop'],
  codex: ['UserPromptSubmit', 'Stop'],
  gemini: ['BeforeAgent', 'AfterAgent'],
  opencode: ['session.status', 'session.idle'],
  copilot: ['userPromptSubmitted', 'agentStop'],
  cursor: ['beforeSubmitPrompt', 'stop'],
  kimi: ['UserPromptSubmit', 'Stop'],
};

/** Conflicting aliases and child-agent context are not root identity evidence. */
export function lateBindingId(agent: string, event: string, payload: Record<string, unknown>): string | undefined {
  if (!EVENTS[agent]?.includes(event)) return undefined;
  if (['agent_id', 'agentId', 'parent_agent_id', 'parentAgentId', 'parent_session_id',
    'parentSessionId', 'parentID', 'parent_thread_id', 'parentToolCallId', 'parentAgentTaskId',
    'subagent_type', 'agent_role', 'agent_path'].some(key => payload[key] != null && payload[key] !== '')) return undefined;
  const ids = ['session_id', 'sessionId', 'sessionID', 'conversation_id']
    .filter(key => payload[key] !== undefined).map(key => payload[key]);
  const id = ids[0];
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(id)
    && ids.every(value => value === id) ? id : undefined;
}
