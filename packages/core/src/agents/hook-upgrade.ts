/** Add events to the recognizable two-event Codex integration without rewriting trusted definitions. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { writeConfigFile } from '../config/write.js';
import { hookFormat, MARKER } from './hook-files.js';
import { hookCommand } from './hooks.js';
import { requireAdapter } from './commands.js';

type Group = { matcher?: string; hooks?: { type?: string; command?: string }[] };
export function upgradeCodexHooks(cliPath: string, env = process.env): { changed: boolean; file: string } {
  const adapter = requireAdapter('codex');
  const file = hookFormat('codex-hooks').file(env);
  const unchanged = { changed: false, file };
  if (!existsSync(file)) return unchanged;
  const text = readFileSync(file, 'utf8');
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || data.disableAllHooks === true || !data.hooks || Array.isArray(data.hooks)) return unchanged;
  const config = join(dirname(file), 'config.toml');
  if (existsSync(config)) {
    const settings = parseToml(readFileSync(config, 'utf8'));
    const features = settings.features as Record<string, unknown> | undefined;
    if (features?.hooks === false || features?.codex_hooks === false || settings.allow_managed_hooks_only === true) return unchanged;
  }
  const events = Object.entries(data.hooks).filter(([, groups]) => Array.isArray(groups)
    && groups.some((g: Group) => g.hooks?.some(h => h.command?.includes(MARKER)))).map(([event]) => event);
  if (events.length !== 2 || !events.includes('SessionStart') || !events.includes('Stop')) return unchanged;
  for (const event of events) {
    const owned = (data.hooks[event] as Group[]).filter(g => g.hooks?.some(h => h.command?.includes(MARKER)));
    if (owned.length !== 1 || (owned[0].matcher && owned[0].matcher !== '*') || owned[0].hooks?.length !== 1
      || owned[0].hooks[0].type !== 'command' || owned[0].hooks[0].command !== hookCommand(cliPath, 'codex', event)) return unchanged;
  }
  const additions = [...new Set(Object.values(adapter.events).flat())].filter(event => !events.includes(event));
  if (additions.some(event => data.hooks[event] !== undefined && !Array.isArray(data.hooks[event]))) return unchanged;
  const hooks = { ...data.hooks, ...Object.fromEntries(additions.map(event => [event,
    [...(data.hooks[event] ?? []), { hooks: [{ type: 'command', command: hookCommand(cliPath, 'codex', event) }] }],
  ])) };
  // Refuse to overwrite a concurrent editor's change.
  if (readFileSync(file, 'utf8') !== text) throw new Error('Hook configuration changed during upgrade; retry explicitly.');
  writeConfigFile(file, `${JSON.stringify({ ...data, hooks }, null, 2)}\n`);
  return { changed: true, file };
}
