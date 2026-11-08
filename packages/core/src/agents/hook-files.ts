import { agentRoot } from './roots.js';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { writeConfigFile } from '../config/write.js';
import { join } from 'node:path';
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

const writeJson = (file: string, data: Json) => writeConfigFile(file, `${JSON.stringify(data, null, 2)}\n`);

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
    return join(agentRoot('kimi', env), 'config.toml');
  },
  install(path, events, commandFor) {
    const base = stripTomlBlock(existsSync(path) ? readFileSync(path, 'utf8') : '');
    const tables = events.map((event) => `[[hooks]]\nevent = ${JSON.stringify(event)}\ncommand = ${JSON.stringify(commandFor(event))}\n`);
    const sep = base && !base.endsWith('\n') ? '\n\n' : base ? '\n' : '';
    writeConfigFile(path, `${base}${sep}${TOML_BEGIN}\n${tables.join('\n')}${TOML_END}\n`);
  },
  uninstall(path) {
    if (existsSync(path)) writeConfigFile(path, stripTomlBlock(readFileSync(path, 'utf8')));
  },
};

// ---- OpenCode: a plugin module ------------------------------------------

/** OpenCode loads every module in its plugins folder; this one forwards session events to `berth hook`. */
export function opencodePlugin(node: string, cli: string, events: string[], electron = process.env.ELECTRON_RUN_AS_NODE === '1'): string {
  return `// ${MARKER}: written by \`berth hooks install opencode\`; remove with \`berth hooks uninstall opencode\`.
import { spawn } from 'node:child_process';

const EVENTS = new Set(${JSON.stringify(events)});
const roots = new Set();
const failed = new Set();
let pending = Promise.resolve();
let client;

function send(event, id, payload = {}) {
  if (!process.env.TMUX_PANE) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const child = spawn(${JSON.stringify(node)}, [${JSON.stringify(cli)}, 'hook', 'opencode', event], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, BERTH_HOOK: '1', ...${JSON.stringify(electron ? { ELECTRON_RUN_AS_NODE: '1' } : {})} },
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      const finish = () => { clearTimeout(timer); resolve(); };
      child.on('error', finish);
      // A renamed Berth session returns its name; the bound SDK client applies it.
      child.on('close', () => {
        let title;
        try { title = JSON.parse(output).hookSpecificOutput?.sessionTitle; } catch {}
        if (typeof title !== 'string' || !title || !client?.session?.update) return finish();
        Promise.resolve(client.session.update({ path: { id }, body: { title } })).catch(() => {}).finally(finish);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ ...payload, session_id: id }));
    } catch {
      resolve();
    }
  });
}

async function forward(event) {
  if (!EVENTS.has(event.type)) return;
  const props = event.properties ?? event.data ?? {};
  const identity = event.type === 'session.created' || event.type === 'session.updated';
  const id = props.sessionID ?? (identity ? props.info?.id : undefined);
  if (typeof id !== 'string' || !id) return;
  if (identity) {
    if (!props.info || props.info.id !== id || props.info.parentID) {
      roots.delete(id);
      return;
    }
    roots.add(id);
    return send(event.type, id);
  }
  if (!roots.has(id)) return;
  if (event.type === 'session.status') {
    if (!['busy', 'retry'].includes(props.status?.type)) return;
    failed.delete(id);
  }
  const rejected = event.type === 'permission.replied' && props.reply === 'reject';
  if (event.type === 'permission.replied' && !['once', 'always', 'reject'].includes(props.reply)) return;
  if (event.type === 'session.error' || rejected) failed.add(id);
  const type = rejected || (event.type === 'session.idle' && failed.has(id)) ? 'session.error' : event.type;
  const payload = event.type === 'permission.asked' && typeof props.permission === 'string'
    ? { message: 'Approval requested: ' + props.permission } : {};
  return send(type, id, payload);
}

export const BerthPlugin = async (input) => {
  client = input?.client;
  return {
  event: ({ event }) => {
    // Native publishers need not await plugin callbacks; keep child processes ordered.
    pending = pending.then(() => forward(event)).catch(() => {});
    return pending;
  },
  };
};
`;
}

function opencodeFormat(node: string, cli: string): HookFormat {
  return {
    file(env) {
      return join(agentRoot('opencode', env), 'plugins', 'berth.js');
    },
    install(path, events) {
      writeConfigFile(path, opencodePlugin(node, cli, events));
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
      return nestedJson((env) => join(agentRoot('claude', env), 'settings.json'));
    case 'codex-hooks':
      return nestedJson((env) => join(agentRoot('codex', env), 'hooks.json'));
    case 'gemini-settings':
      return nestedJson((env) => join(agentRoot('gemini', env), 'settings.json'));
    case 'qoder-settings':
      return nestedJson((env) => join(agentRoot('qoder', env), 'settings.json'));
    case 'cursor-hooks':
      return flatJson((env) => join(agentRoot('cursor', env), 'hooks.json'), false);
    case 'copilot-hooks':
      return flatJson((env) => join(agentRoot('copilot', env), 'hooks', 'berth.json'), true);
    case 'kimi-config':
      return tomlConfig;
    case 'opencode-plugin':
      return opencodeFormat(process.execPath, cli);
    default:
      throw new BerthError(`unknown hook target ${String(target)}`, ExitCode.usage);
  }
}
