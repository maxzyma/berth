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
 * (implementation §3.2). Parse known option arity before selecting the keep-set. Unknown syntax
 * requires explicit review instead of interpreting its values as options.
 */
export function keptArgs(adapter: Adapter, argv: string): string[] {
  const words = argv ? shellSplit(argv).slice(1) : [];
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === '--') break;
    if (!word.startsWith('-') || word === '-') continue;
    const [flag] = word.split('=', 1);
    const retain = Object.hasOwn(adapter.keep, flag);
    const arity = retain ? adapter.keep[flag] : adapter.discard?.[flag];
    if (arity === undefined) throw new BerthError(`Review recovery options: unsupported option ${flag}.`);
    const values: string[] = [];
    if (word.includes('=')) {
      if (arity === false) throw new BerthError(`Unexpected value for ${flag}.`);
    } else if (arity === true) {
      if (i + 1 >= words.length || words[i + 1] === '--') throw new BerthError(`Missing value for ${flag}.`);
      values.push(words[++i]);
    } else if (arity === 'optional' && i + 1 < words.length && !words[i + 1].startsWith('-')) {
      values.push(words[++i]);
    }
    if (arity === 'many') {
      while (i + 1 < words.length && !words[i + 1].startsWith('-')) values.push(words[++i]);
      if (!word.includes('=') && values.length === 0) throw new BerthError(`Missing value for ${flag}.`);
    }
    if (retain) kept.push(word, ...values);
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


/** Unverified provenance or unsupported syntax requires explicit review. */
export function recoveryOptionsRequired(agent: string, argv: string, verified?: boolean): boolean {
  if (agent === 'shell') return false;
  try { return keptArgs(requireAdapter(agent), argv).length > 0 && verified !== true; }
  catch { return true; }
}
