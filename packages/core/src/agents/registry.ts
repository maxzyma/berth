/**
 * Agent adapters (spec §8, implementation §3).
 *
 * `source` records where each row's commands and events come from:
 * - `help <version>`: checked against the CLI's own --help on that version;
 * - `cmux`: follows cmux's handling of that agent (reference commit in spec §8).
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
  hookTarget?: 'claude-settings' | 'codex-hooks';
  events: HookEvents;
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
    events: noEvents,
    source: 'cmux',
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    binary: 'opencode',
    launch: 'opencode {args}',
    resume: 'opencode --session {conversation} {args}',
    keep: { '--model': true, '-m': true, '--agent': true },
    events: { start: ['session.created'], working: [], waiting: [], done: ['session.idle'] },
    source: 'cmux',
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    binary: 'copilot',
    launch: 'copilot {args}',
    resume: 'copilot --resume {conversation} {args}',
    keep: { '--model': true, '--allow-all-tools': false, '--add-dir': true },
    events: { start: [], working: [], waiting: [], done: ['Notification'] },
    source: 'cmux',
  },
  {
    id: 'cursor',
    displayName: 'Cursor CLI',
    binary: 'cursor-agent',
    launch: 'cursor-agent {args}',
    resume: 'cursor-agent --resume {conversation} {args}',
    keep: { '--model': true, '--force': false },
    events: noEvents,
    source: 'help 2025.09.12 (commands); cmux',
  },
  {
    id: 'kimi',
    displayName: 'Kimi CLI',
    binary: 'kimi',
    launch: 'kimi {args}',
    resume: 'kimi --session {conversation} {args}',
    keep: { '--agent': true, '--add-dir': true, '--model': true, '-m': true },
    events: noEvents,
    source: 'help 0.31.1',
  },
  {
    id: 'qoder',
    displayName: 'Qoder CLI',
    binary: 'qodercli',
    launch: 'qodercli --name {name} {args}',
    resume: 'qodercli --resume {conversation} {args}',
    keep: { '--model': true, '--yolo': false },
    events: noEvents,
    source: 'help 1.0.48 (commands); cmux',
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
