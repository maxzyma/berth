/**
 * Agent adapters (spec §8, implementation §3).
 *
 * `source` records where each row's commands and events come from:
 * - `help <version>`: checked against the CLI's own --help on that version;
 * - `cmux`: follows cmux's handling of that agent (reference commit in spec §8);
 * - `docs`: the CLI's official documentation (links in spec §8).
 * No code is taken from other projects; facts about the CLIs are restated here.
 */

export type AgentState = 'working' | 'waiting' | 'done' | '';

export interface HookEvents {
  /** Events whose payload carries the conversation id. */
  start: string[];
  working: string[];
  waiting: string[];
  done: string[];
  /** Events that clear activity without reporting successful completion. */
  idle?: string[];
}

/** Hook file formats Berth can write (see hook-files.ts). */
export type HookTarget =
  | 'claude-settings'
  | 'codex-hooks'
  | 'gemini-settings'
  | 'qoder-settings'
  | 'cursor-hooks'
  | 'copilot-hooks'
  | 'kimi-config'
  | 'opencode-plugin';

export type OptionArity = boolean | 'many' | 'optional';

export interface Adapter {
  id: string;
  displayName: string;
  binary: string;
  launch: string;
  /** Absent when the agent cannot resume a conversation. */
  resume?: string;
  /** Options kept on resume; value says whether the option takes an argument. */
  keep: Record<string, OptionArity>;
  /** Known options omitted from recovery; arity still controls parsing. */
  discard?: Record<string, OptionArity>;
  /** Where Berth writes hooks for this agent, when it supports them. */
  hookTarget?: HookTarget;
  /** Each configured hook may still need native runtime trust review. */
  requiresHookTrust?: boolean;
  events: HookEvents;
  /** For a waiting event that also fires for other reasons: whether this payload asks for the user. */
  waitingWhen?: (payload: Record<string, unknown>, event: string) => boolean;
  /** A registered activity event can instead report an interrupted turn. */
  idleWhen?: (event: string, payload: Record<string, unknown>) => boolean;
  source: string;
}

const noEvents: HookEvents = { start: [], working: [], waiting: [], done: [] };

const claudeEvents: HookEvents = {
  start: ['SessionStart'],
  working: ['UserPromptSubmit', 'PostToolBatch'],
  waiting: ['PermissionRequest', 'Notification'],
  done: ['Stop'],
  idle: ['StopFailure'],
};

export const ADAPTERS: Adapter[] = [
  {
    id: 'claude',
    displayName: 'Claude Code',
    binary: 'claude',
    launch: 'claude --name {name} {args}',
    resume: 'claude --resume {conversation} --name {name} {args}',
    keep: {
      '--model': true,
      '--permission-mode': true,
      '--dangerously-skip-permissions': false,
      '--add-dir': 'many',
      '--settings': true,
      '--mcp-config': 'many',
      '--strict-mcp-config': false,
      '--restricted': false, '--safe-mode': false, '--bare': false,
      '--setting-sources': true, '--tools': 'many',
      '--allowedTools': 'many', '--allowed-tools': 'many',
      '--disallowedTools': 'many', '--disallowed-tools': 'many',
      '--allow-dangerously-skip-permissions': false,
      '--agent': true,
    },
    discard: { '--name': true, '--resume': 'optional', '-r': 'optional', '--continue': false, '-c': false, '--print': false, '-p': false, '--append-system-prompt': true, '--system-prompt': true, '--session-id': true, '--fork-session': false, '--output-format': true, '--input-format': true, '--verbose': false },
    hookTarget: 'claude-settings',
    events: claudeEvents,
    waitingWhen: (p, event) => event === 'PermissionRequest' || (typeof p.notification_type === 'string'
      ? p.notification_type === 'permission_prompt' : /permission/i.test(String(p.message ?? ''))),
    source: 'help 2.1.310; official hooks reference (2026-11-01)',
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    binary: 'codex',
    launch: 'codex {args}',
    resume: 'codex resume {conversation} {args}',
    keep: {
      '--model': true,
      '-m': true,
      '--sandbox': true,
      '-s': true,
      '--ask-for-approval': true,
      '-a': true,
      '--profile': true,
      '-p': true,
      '--config': true,
      '-c': true,
      '--dangerously-bypass-approvals-and-sandbox': false,
      '--dangerously-bypass-hook-trust': false, '--approve-for-me': false,
      '--enable': true, '--disable': true, '--add-dir': true, '--search': false,
      '--no-alt-screen': false,
    },
    discard: { '--last': false, '--all': false, '--cd': true, '-C': true },
    hookTarget: 'codex-hooks',
    requiresHookTrust: true,
    events: { start: ['SessionStart'], working: ['UserPromptSubmit', 'PostToolUse'], waiting: ['PermissionRequest'], done: ['Stop'], idle: ['Interrupt'] },
    source: 'help 0.166.0 (commands); official hooks documentation (2026-11-01)',
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    binary: 'gemini',
    launch: 'gemini {args}',
    resume: 'gemini --resume {conversation} {args}',
    keep: { '--model': true, '-m': true, '--yolo': false, '--approval-mode': true },
    discard: { '--resume': 'optional', '-r': 'optional', '--prompt': true, '-p': true },
    hookTarget: 'gemini-settings',
    events: { start: ['SessionStart'], working: ['BeforeAgent', 'BeforeModel'], waiting: ['Notification'], done: ['AfterAgent'] },
    waitingWhen: (p) => p.notification_type === 'ToolPermission',
    source: 'cmux; official hooks reference; native 0.66.0 binding/recovery/approval/rejection/cancellation/provider-error fixtures verified',
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    binary: 'opencode',
    launch: 'opencode {args}',
    resume: 'opencode --session {conversation} {args}',
    keep: { '--model': true, '-m': true, '--agent': true },
    discard: { '--session': true, '-s': true, '--continue': false, '-c': false, '--prompt': true },
    hookTarget: 'opencode-plugin',
    events: { start: ['session.created', 'session.updated'], working: ['session.status', 'permission.replied'], waiting: ['permission.asked'], done: ['session.idle'], idle: ['session.error'] },
    source: 'docs (plugins); cmux',
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    binary: 'copilot',
    launch: 'copilot {args}',
    resume: 'copilot --resume={conversation} {args}',
    keep: {
      '--model': true, '--reasoning-effort': true, '--allow-all-tools': false, '--add-dir': true,
      '--allow-tool': 'many', '--deny-tool': 'many', '--no-auto-update': false,
      '--disable-client-telemetry': false, '--disable-builtin-mcps': false,
      '--no-custom-instructions': false, '--no-ask-user': false,
    },
    discard: {
      '--resume': 'optional', '-r': 'optional', '--continue': false,
      '--prompt': true, '-p': true, '--interactive': true, '-i': true,
      '--name': true, '-n': true, '--session-id': true,
    },
    hookTarget: 'copilot-hooks',
    events: { start: ['sessionStart'], working: ['userPromptSubmitted'], waiting: ['notification'], done: ['agentStop'] },
    waitingWhen: (p) => /permission/i.test(String(p.notification_type ?? p.notificationType ?? '')),
    source: 'cmux; official Copilot hooks reference (2026-11-01); native 1.0.105 fixture',
  },
  {
    id: 'cursor',
    displayName: 'Cursor CLI',
    binary: 'cursor-agent',
    launch: 'cursor-agent {args}',
    resume: 'cursor-agent --resume {conversation} {args}',
    keep: { '--model': true, '--force': false },
    discard: { '--resume': true, '--print': false, '-p': false, '--output-format': true },
    hookTarget: 'cursor-hooks',
    events: { start: ['sessionStart'], working: ['beforeSubmitPrompt'], waiting: [], done: ['stop'] },
    idleWhen: (event, payload) => event === 'stop' && payload.status !== 'completed',
    source: 'help 2025.09.12 (commands); release 2026-01-16 (lifecycle hooks); native version acceptance pending; cmux',
  },
  {
    id: 'kimi',
    displayName: 'Kimi CLI',
    binary: 'kimi',
    launch: 'kimi {args}',
    resume: 'kimi --session {conversation} {args}',
    keep: { '--add-dir': true, '--model': true, '-m': true, '--yolo': false, '-y': false, '--auto': false, '--plan': false },
    discard: { '--session': true, '--continue': false, '--print': false, '--prompt': true, '--work-dir': true, '--agent': true, '--agent-file': true },
    hookTarget: 'kimi-config',
    events: { start: ['SessionStart'], working: ['UserPromptSubmit', 'PermissionResult'], waiting: ['PermissionRequest'], done: ['Stop'], idle: ['Interrupt', 'StopFailure'] },
    source: 'help 0.31.1 (commands); docs (hooks); cmux',
  },
  {
    id: 'qoder',
    displayName: 'Qoder CLI',
    binary: 'qodercli',
    launch: 'qodercli --name {name} {args}',
    resume: 'qodercli --resume {conversation} {args}',
    keep: { '--model': true, '--yolo': false, '--permission-mode': true, '--dangerously-skip-permissions': false, '--allowed-mcp-server-names': true, '--tools': 'many', '--allowed-tools': true, '--disallowed-tools': true, '--mcp-config': true, '--strict-mcp-config': false, '--setting-sources': true },
    discard: { '--name': true, '--resume': true, '--continue': false, '--print': false, '-p': false },
    hookTarget: 'qoder-settings',
    events: { start: ['SessionStart'], working: ['UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure'], waiting: ['PermissionRequest'], done: ['Stop'], idle: ['StopFailure'] },
    idleWhen: (event, payload) => event === 'PostToolUseFailure' && payload.is_interrupt === true,
    source: 'help 1.0.48 (commands); official hooks documentation (2026-11-01)',
  },
  {
    id: 'shell',
    displayName: 'Shell',
    binary: '',
    launch: '',
    keep: {},
    events: noEvents,
    source: 'built-in',
  },
];

export function getAdapter(id: string): Adapter | undefined {
  return ADAPTERS.find((adapter) => adapter.id === id);
}

export function stateForEvent(adapter: Adapter, event: string): AgentState | undefined {
  if (adapter.events.working.includes(event)) return 'working';
  if (adapter.events.waiting.includes(event)) return 'waiting';
  if (adapter.events.done.includes(event)) return 'done';
  if (adapter.events.idle?.includes(event)) return '';
  return undefined;
}
