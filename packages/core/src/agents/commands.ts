import { BerthError, ExitCode } from '../errors.js';
import type { AgentOverride } from '../config/index.js';
import { renderTemplate, shellQuote, shellSplit } from '../shell.js';
import { getAdapter, type Adapter } from './registry.js';

export function requireAdapter(id: string): Adapter {
  const adapter = getAdapter(id);
  if (!adapter) throw new BerthError(`unknown agent: ${id}`, ExitCode.usage);
  return adapter;
}

/**
 * Options from an original launch command that are kept on resume
 * (implementation §3.2). Anything not in the adapter's keep-set is dropped:
 * prompts, positional arguments, session selectors, one-shot modes.
 */
export function keptArgs(adapter: Adapter, argv: string): string[] {
  const words = argv ? shellSplit(argv).slice(1) : [];
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word.startsWith('-')) continue;
    const [flag] = word.split('=', 1);
    if (!(flag in adapter.keep)) continue;
    kept.push(word);
    const takesValue = adapter.keep[flag];
    if (takesValue && !word.includes('=') && i + 1 < words.length) kept.push(words[++i]);
  }
  return kept;
}

function template(adapter: Adapter, kind: 'launch' | 'resume', overrides: Record<string, AgentOverride>): string | undefined {
  return overrides[adapter.id]?.[kind] ?? adapter[kind];
}

export interface CommandInput {
  adapter: Adapter;
  name: string;
  cwd: string;
  /** Extra arguments for a fresh launch, already split. */
  extraArgs?: string[];
  overrides: Record<string, AgentOverride>;
}

export function launchCommand(input: CommandInput): string {
  const tpl = template(input.adapter, 'launch', input.overrides) ?? '';
  const args = (input.extraArgs ?? []).map(shellQuote).join(' ');
  return renderTemplate(tpl, { name: input.name, cwd: input.cwd, args });
}

/** Resume command, or undefined when the agent has no resume template. */
export function resumeCommand(input: CommandInput & { conversation: string; originalArgv: string }): string | undefined {
  const tpl = template(input.adapter, 'resume', input.overrides);
  if (!tpl) return undefined;
  const args = keptArgs(input.adapter, input.originalArgv).map(shellQuote).join(' ');
  return renderTemplate(tpl, { name: input.name, cwd: input.cwd, conversation: input.conversation, args });
}
