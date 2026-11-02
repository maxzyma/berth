import { profileEnvironment, profileKey, readProfile, type AgentProfile } from './profile.js';
import { agentRoot } from './roots.js';
import { existsSync } from 'node:fs';
import { readJsonlTitles } from './jsonl-titles.js';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Bound metadata only: never select a conversation by directory recency. */
export function conversationTitle(agent: string, cwd: string, id: string, env = process.env, cacheDir?: string): string | undefined {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return undefined;
  try {
    if (agent === 'codex') {
      const root = agentRoot('codex', env);
      const index = join(root, 'session_index.jsonl');
      const named = readJsonlTitles(index, [id], 'codex', cacheDir).titles.get(id);
      if (named) return named;
      const database = join(root, 'state_5.sqlite');
      if (existsSync(database)) {
        const result = spawnSync('sqlite3', ['-readonly', database, `SELECT title FROM threads WHERE id='${id}' LIMIT 1;`], { env, encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 });
        if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
      }
      return undefined;
    }
    if (agent === 'claude' || agent === 'qoder') {
      const root = agentRoot(agent, env);
      for (const encoded of new Set([cwd.replace(/[^A-Za-z0-9]/g, '-'), cwd.replace(/\//g, '-')])) {
        const file = join(root, 'projects', encoded, `${id}.jsonl`);
        if (!existsSync(file)) continue;
        const title = readJsonlTitles(file, [id], 'custom-title', cacheDir).titles.get(id);
        if (title) return title;
      }
    }
  } catch {
    // Agent stores are optional and may rotate while being read.
  }
  return undefined;
}

/** Batch the shared Codex stores once for an inventory refresh. */
export function titleLookup(records: readonly { agent: string; conversation: string }[], env = process.env, cacheDir?: string): (agent: string, cwd: string, id: string) => string | undefined {
  const ids = new Set(records.filter((row) => row.agent === 'codex' && /^[a-zA-Z0-9_-]+$/.test(row.conversation)).map((row) => row.conversation));
  const titles = new Map<string, string>();
  if (ids.size) {
    const root = agentRoot('codex', env);
    try {
      const index = join(root, 'session_index.jsonl');
      for (const [id, title] of readJsonlTitles(index, [...ids], 'codex', cacheDir).titles) titles.set(id, title);
      const missing = [...ids].filter((id) => !titles.has(id));
      const database = join(root, 'state_5.sqlite');
      if (missing.length && existsSync(database)) {
        const result = spawnSync('sqlite3', ['-readonly', '-json', database, `SELECT id,title FROM threads WHERE id IN (${missing.map((id) => `'${id}'`).join(',')});`], { env, encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
        if (result.status === 0 && result.stdout.trim()) for (const row of JSON.parse(result.stdout) as { id: string; title: string }[]) {
          if (ids.has(row.id) && typeof row.title === 'string' && row.title.trim()) titles.set(row.id, row.title.trim());
        }
      }
    } catch { /* Missing, rotating or unreadable optional stores leave titles unknown. */ }
  }
  return (agent, cwd, id) => agent === 'codex' ? titles.get(id) : conversationTitle(agent, cwd, id, env, cacheDir);
}

/** Profile-aware batching: a host's environment is not a session's store identity. */
export function profiledTitleLookup(records: readonly { agent: string; conversation: string; profile?: AgentProfile }[], env = process.env, cacheDir?: string): (agent: string, cwd: string, id: string, profile?: AgentProfile) => string | undefined {
  const groups = new Map<string, { profile: AgentProfile; agent: string; rows: { agent: string; conversation: string }[] }>();
  for (const row of records) {
    const profile = readProfile(row.agent, row.profile);
    if (!profile) continue;
    const key = profileKey(row.agent, profile);
    const prior = groups.get(key);
    groups.set(key, { profile, agent: row.agent, rows: [...(prior?.rows ?? []), row] });
  }
  const lookups = new Map([...groups].map(([key, group]) => [key, titleLookup(group.rows, profileEnvironment(group.agent, group.profile, env), cacheDir)]));
  return (agent, cwd, id, profile) => profile ? lookups.get(profileKey(agent, profile))?.(agent, cwd, id) : undefined;
}
