import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { BerthError, ExitCode } from '../errors.js';
import type { Adapter, HookTarget } from './registry.js';

/**
 * Where and how each agent reads its hooks (spec §8). Every format marks
 * Berth's entries with MARKER so install is idempotent and uninstall removes
 * only Berth's own entries.
 */
export const MARKER = 'BERTH_HOOK=1';

type Env = Record<string, string | undefined>;
/** Builds the command an agent runs for one event. */
export type CommandFor = (event: string) => string;

interface HookFormat {
  file(env: Env): string;
  install(file: string, events: string[], commandFor: CommandFor, adapter: Adapter): void;
  uninstall(file: string): void;
}

const home = (env: Env) => env.HOME || homedir();

// ---- JSON files ---------------------------------------------------------

type Json = Record<string, unknown>;

function readJson(file: string): Json {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Json;
  } catch (error) {
    throw new BerthError(`cannot parse ${file}: ${(error as Error).message}`);
  }
}

function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const writeJson = (file: string, data: Json) => writeText(file, `${JSON.stringify(data, null, 2)}\n`);

/** Claude Code layout: `hooks.<Event>: [{ matcher?, hooks: [{ type, command }] }]`. */
interface NestedGroup { matcher?: string; hooks?: { type?: string; command?: string }[] }

function withoutBerthNested(groups: NestedGroup[] = []): NestedGroup[] {
  return groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !h.command?.includes(MARKER)) }))
    .filter((g) => g.hooks.length > 0);
}

function mapEvents<T>(data: Json, keep: (groups: T[]) => T[]): Record<string, T[]> {
  const hooks: Record<string, T[]> = {};
  for (const [event, groups] of Object.entries((data.hooks ?? {}) as Record<string, T[]>)) {
    const kept = keep(groups);
    if (kept.length > 0) hooks[event] = kept;
  }
  return hooks;
}

function nestedJson(file: (env: Env) => string): HookFormat {
  return {
    file,
    install(path, events, commandFor) {
      const data = readJson(path);
      const hooks = mapEvents<NestedGroup>(data, withoutBerthNested);
      for (const event of events) {
        hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: 'command', command: commandFor(event) }] }];
      }
      writeJson(path, { ...data, hooks });
    },
    uninstall(path) {
      if (!existsSync(path)) return;
      const data = readJson(path);
      writeJson(path, { ...data, hooks: mapEvents<NestedGroup>(data, withoutBerthNested) });
    },
  };
}

/** Cursor and Copilot layout: `{ version: 1, hooks: { <event>: [{ type?, command }] } }`. */
interface FlatEntry { type?: string; command?: string }

const withoutBerthFlat = (entries: FlatEntry[] = []) => entries.filter((e) => !e.command?.includes(MARKER));

function flatJson(file: (env: Env) => string, ownFile: boolean): HookFormat {
  return {
    file,
    install(path, events, commandFor) {
      const data = ownFile ? {} : readJson(path);
      const hooks = mapEvents<FlatEntry>(data, withoutBerthFlat);
      for (const event of events) hooks[event] = [...(hooks[event] ?? []), { type: 'command', command: commandFor(event) }];
      writeJson(path, { ...data, version: 1, hooks });
    },
    uninstall(path) {
      if (!existsSync(path)) return;
      if (ownFile) {
        rmSync(path, { force: true });
        return;
      }
      const data = readJson(path);
      writeJson(path, { ...data, hooks: mapEvents<FlatEntry>(data, withoutBerthFlat) });
    },
  };
}

// ---- Kimi Code: TOML array tables ---------------------------------------

const TOML_BEGIN = `# >>> berth hooks (${MARKER}; remove with: berth hooks uninstall kimi)`;
const TOML_END = '# <<< berth hooks';

function stripTomlBlock(text: string): string {
  const start = text.indexOf(TOML_BEGIN);
  if (start < 0) return text;
  const end = text.indexOf(TOML_END, start);
  const after = end < 0 ? text.length : end + TOML_END.length;
  return `${text.slice(0, start).replace(/\n+$/, '\n')}${text.slice(after).replace(/^\n+/, '')}`.replace(/^\n$/, '');
}

/**
 * Kimi Code rejects the whole config on an unknown field or event, so the
 * block holds only `event` and `command`. It goes last: `[[hooks]]` tables
 * at the end of the file cannot capture keys meant for another table.
 */
const tomlConfig: HookFormat = {
  file(env) {
    if (env.KIMI_CODE_HOME) return join(env.KIMI_CODE_HOME, 'config.toml');
    const legacy = join(home(env), '.kimi');
    const current = join(home(env), '.kimi-code');
    return existsSync(legacy) && !existsSync(current) ? join(legacy, 'config.toml') : join(current, 'config.toml');
  },
  install(path, events, commandFor) {
    const base = stripTomlBlock(existsSync(path) ? readFileSync(path, 'utf8') : '');
    const tables = events.map((event) => `[[hooks]]\nevent = ${JSON.stringify(event)}\ncommand = ${JSON.stringify(commandFor(event))}\n`);
    const sep = base && !base.endsWith('\n') ? '\n\n' : base ? '\n' : '';
    writeText(path, `${base}${sep}${TOML_BEGIN}\n${tables.join('\n')}${TOML_END}\n`);
  },
  uninstall(path) {
    if (existsSync(path)) writeText(path, stripTomlBlock(readFileSync(path, 'utf8')));
  },
};

// ---- OpenCode: a plugin module ------------------------------------------

/** OpenCode loads every module in its plugins folder; this one forwards session events to `berth hook`. */
export function opencodePlugin(node: string, cli: string, events: string[]): string {
  return `// ${MARKER}: written by \`berth hooks install opencode\`; remove with \`berth hooks uninstall opencode\`.
import { spawn } from 'node:child_process';

const EVENTS = new Set(${JSON.stringify(events)});
const children = new Set();

function send(event, id) {
  if (!process.env.TMUX_PANE) return;
  try {
    const child = spawn(${JSON.stringify(node)}, [${JSON.stringify(cli)}, 'hook', 'opencode', event], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env, BERTH_HOOK: '1' },
    });
    child.on('error', () => {});
    child.stdin.end(JSON.stringify({ session_id: id ?? '' }));
  } catch {
    // Never disturb the agent.
  }
}

export const BerthPlugin = async () => ({
  event: async ({ event }) => {
    if (!EVENTS.has(event.type)) return;
    const props = event.properties ?? event.data ?? {};
    const id = props.sessionID ?? props.info?.id;
    // Subagent sessions are children of the conversation the user resumes.
    if (props.info?.parentID) {
      if (id) children.add(id);
      return;
    }
    if (id && children.has(id)) return;
    send(event.type, id);
  },
});
`;
}

function opencodeFormat(node: string, cli: string): HookFormat {
  return {
    file(env) {
      const config = env.XDG_CONFIG_HOME || join(home(env), '.config');
      return join(config, 'opencode', 'plugins', 'berth.js');
    },
    install(path, events) {
      writeText(path, opencodePlugin(node, cli, events));
    },
    uninstall(path) {
      if (existsSync(path) && readFileSync(path, 'utf8').includes(MARKER)) rmSync(path, { force: true });
    },
  };
}

// ---- Registry -----------------------------------------------------------

export function hookFormat(target: HookTarget, cli = ''): HookFormat {
  switch (target) {
    case 'claude-settings':
      return nestedJson((env) => join(home(env), '.claude', 'settings.json'));
    case 'codex-hooks':
      return nestedJson((env) => join(home(env), '.codex', 'hooks.json'));
    case 'gemini-settings':
      return nestedJson((env) => join(home(env), '.gemini', 'settings.json'));
    case 'qoder-settings':
      return nestedJson((env) => join(env.QODER_CONFIG_DIR || join(home(env), '.qoder'), 'settings.json'));
    case 'cursor-hooks':
      return flatJson((env) => join(home(env), '.cursor', 'hooks.json'), false);
    case 'copilot-hooks':
      return flatJson((env) => join(env.COPILOT_HOME || join(home(env), '.copilot'), 'hooks', 'berth.json'), true);
    case 'kimi-config':
      return tomlConfig;
    case 'opencode-plugin':
      return opencodeFormat(process.execPath, cli);
    default:
      throw new BerthError(`unknown hook target ${String(target)}`, ExitCode.usage);
  }
}

/** Whether the target file holds Berth's entries. */
export function containsBerth(file: string): boolean {
  return existsSync(file) && readFileSync(file, 'utf8').includes(MARKER);
}
