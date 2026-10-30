/**
 * Agent adapters (spec §8, implementation §3).
 *
 * `source` records where each row's commands and events come from:
 * - `help <version>`: checked against the CLI's own --help on that version;
 * - `cmux`: follows cmux's handling of that agent (reference commit in spec §8);
 * - `docs`: the CLI's official documentation (links in spec §8).
 * No code is taken from other projects; facts about the CLIs are restated here.
 */

export type AgentState = 'working' | 'waiting' | 'done';

export interface HookEvents {
  /** Events whose payload carries the conversation id. */
  start: string[];
  working: string[];
  waiting: string[];
  done: string[];
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

export interface Adapter {
  id: string;
  displayName: string;
  binary: string;
  launch: string;
  /** Absent when the agent cannot resume a conversation. */
  resume?: string;
  /** Options kept on resume; value says whether the option takes an argument. */
  keep: Record<string, boolean>;
  /** Where Berth writes hooks for this agent, when it supports them. */
  hookTarget?: HookTarget;
  events: HookEvents;
  /** For a waiting event that also fires for other reasons: whether this payload asks for the user. */
  waitingWhen?: (payload: Record<string, unknown>) => boolean;
  source: string;
}

const noEvents: HookEvents = { start: [], working: [], waiting: [], done: [] };

const claudeEvents: HookEvents = {
  start: ['SessionStart'],
  working: ['UserPromptSubmit'],
  waiting: ['Notification'],
  done: ['Stop'],
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
      '--add-dir': true,
      '--settings': true,
      '--mcp-config': true,
      '--agent': true,
    },
    hookTarget: 'claude-settings',
    events: claudeEvents,
    waitingWhen: (p) => /permission/i.test(String(p.message ?? '')),
    source: 'help 2.1.310',
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
    },
    hookTarget: 'codex-hooks',
    events: { start: ['SessionStart'], working: [], waiting: [], done: ['Stop'] },
    source: 'help 0.162.1 (commands); cmux (hook events)',
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    binary: 'gemini',
    launch: 'gemini {args}',
    resume: 'gemini --resume {conversation} {args}',
    keep: { '--model': true, '-m': true, '--yolo': false, '--approval-mode': true },
    hookTarget: 'gemini-settings',
    events: { start: ['SessionStart'], working: ['BeforeAgent'], waiting: ['Notification'], done: ['AfterAgent'] },
    waitingWhen: (p) => p.notification_type === 'ToolPermission',
    source: 'docs (hooks, hooks on by default since 0.27); cmux',
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    binary: 'opencode',
    launch: 'opencode {args}',
    resume: 'opencode --session {conversation} {args}',
    keep: { '--model': true, '-m': true, '--agent': true },
    hookTarget: 'opencode-plugin',
    events: { start: ['session.created'], working: [], waiting: [], done: ['session.idle'] },
    source: 'docs (plugins); cmux',
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    binary: 'copilot',
    launch: 'copilot {args}',
    resume: 'copilot --resume={conversation} {args}',
    keep: { '--model': true, '--allow-all-tools': false, '--add-dir': true },
    hookTarget: 'copilot-hooks',
    events: { start: ['sessionStart'], working: ['userPromptSubmitted'], waiting: ['notification'], done: ['agentStop'] },
    waitingWhen: (p) => /permission/i.test(String(p.notification_type ?? p.notificationType ?? '')),
    source: 'docs (hooks, CLI 1.0.21+); cmux',
  },
  {
    id: 'cursor',
    displayName: 'Cursor CLI',
    binary: 'cursor-agent',
    launch: 'cursor-agent {args}',
    resume: 'cursor-agent --resume {conversation} {args}',
    keep: { '--model': true, '--force': false },
    hookTarget: 'cursor-hooks',
    events: { start: ['sessionStart'], working: ['beforeSubmitPrompt'], waiting: [], done: ['stop'] },
    source: 'help 2025.09.12 (commands); docs (hooks, CLI 2026.01+); cmux',
  },
  {
    id: 'kimi',
    displayName: 'Kimi CLI',
    binary: 'kimi',
    launch: 'kimi {args}',
    resume: 'kimi --session {conversation} {args}',
    keep: { '--agent': true, '--add-dir': true, '--model': true, '-m': true },
    hookTarget: 'kimi-config',
    events: { start: ['SessionStart'], working: ['UserPromptSubmit'], waiting: ['PermissionRequest'], done: ['Stop'] },
    source: 'help 0.31.1 (commands); docs (hooks); cmux',
  },
  {
    id: 'qoder',
    displayName: 'Qoder CLI',
    binary: 'qodercli',
    launch: 'qodercli --name {name} {args}',
    resume: 'qodercli --resume {conversation} {args}',
    keep: { '--model': true, '--yolo': false },
    hookTarget: 'qoder-settings',
    events: { start: ['SessionStart'], working: ['UserPromptSubmit'], waiting: ['PermissionRequest'], done: ['Stop'] },
    source: 'help 1.0.48 (commands); docs (hooks); cmux',
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
  return undefined;
}
