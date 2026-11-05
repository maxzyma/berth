import { eventTime, type ActivityTiming } from './activity-timing.js';
import { spawnSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { processLifetime } from '../process-owner.js';
import { rolloutBinding, writableFiles } from './codex-binding.js';

export const CODEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 1024 * 1024;
export interface CodexNativeRecord {
  id: string;
  root: string;
  file: string;
  topic?: string;
  state?: 'working' | 'done' | '';
  revision: string;
  activityTiming?: ActivityTiming;
}

/** The TUI's own log descriptors establish its profile, never its selected thread. */
export function codexNativeRoot(pid: number, lifetime: string): string | undefined {
  if (processLifetime(pid)?.key !== lifetime) return undefined;
  const result = spawnSync('lsof', ['-n', '-P', '-a', '-p', String(pid), '-F', 'pfan'], {
    encoding: 'utf8', timeout: 750, killSignal: 'SIGKILL', maxBuffer: 256 * 1024,
  });
  if (result.status !== 0 || result.error) return undefined;
  try {
    const roots = new Set(writableFiles(result.stdout, pid)
      .filter(file => /^logs_\d+\.sqlite$/.test(basename(file)))
      .map(file => dirname(realpathSync(file))));
    return roots.size === 1 && processLifetime(pid)?.key === lifetime ? [...roots][0] : undefined;
  } catch { return undefined; }
}

/** Typed rollout events only; text in assistant/tool messages cannot set state. */
export function codexEvents(lines: readonly string[], id?: string): Pick<CodexNativeRecord, 'topic' | 'state' | 'activityTiming'> {
  let topic: string | undefined, state: CodexNativeRecord['state'];
  let turnStartedAt: string | undefined, stateSince: string | undefined;
  for (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event?.type !== 'event_msg') continue;
    const payload = event.payload;
    if (payload?.thread_id && payload.thread_id !== id) continue;
    const item = payload?.type === 'item_completed' && payload.item?.type === 'UserMessage' ? payload.item : undefined;
    const message = payload?.type === 'user_message' && typeof payload.message === 'string' ? payload.message
      : item && Array.isArray(item.content) ? item.content.filter((part: { type?: string; text?: string }) => part?.type === 'text' && typeof part.text === 'string')
        .map((part: { text: string }) => part.text).join('') : undefined;
    const at = eventTime(event.timestamp);
    if (message !== undefined) {
      turnStartedAt = at; stateSince = at;
      topic = message.split(/\r?\n/, 1)[0].replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120);
      state = 'working';
    } else if (payload?.type === 'task_started') {
      turnStartedAt = at; stateSince = at;
      if (state === 'done' || state === '') topic = '';
      state = 'working';
    }
    else if (payload?.type === 'task_complete') { state = 'done'; stateSince = at; }
    else if (payload?.type === 'turn_aborted') { state = ''; turnStartedAt = undefined; stateSince = undefined; }
  }
  const activityTiming = state && (turnStartedAt || stateSince) ? { state, turnStartedAt, stateSince } : undefined;
  return { topic, state, ...(activityTiming ? { activityTiming } : {}) };
}

/** Bounded read of a complete, stable tail after exact-ID/root verification. */
export function codexRollout(root: string, id: string, file: string): CodexNativeRecord | undefined {
  if (!CODEX_UUID.test(id)) return undefined;
  let fd: number | undefined;
  try {
    const binding = rolloutBinding(file);
    if (!binding || binding.conversation !== id || binding.root !== realpathSync(root)) return undefined;
    fd = openSync(file, 'r');
    const before = fstatSync(fd, { bigint: true });
    const size = Number(before.size), start = Math.max(0, size - LIMIT);
    const bytes = Buffer.alloc(Math.min(size, LIMIT));
    if (readSync(fd, bytes, 0, bytes.length, start) !== bytes.length || bytes.at(-1) !== 10) return undefined;
    const text = bytes.subarray(start ? bytes.indexOf(10) + 1 : 0).toString('utf8');
    const events = codexEvents(text.split('\n'), id);
    const verified = rolloutBinding(file, Number(before.ino));
    if (verified?.conversation !== id || verified.root !== binding.root) return undefined;
    const after = fstatSync(fd, { bigint: true });
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs) return undefined;
    return { id, root: binding.root, file, ...events,
      revision: `${before.dev}:${before.ino}:${before.size}:${before.mtimeNs}` };
  } catch { return undefined; }
  finally { if (fd !== undefined) closeSync(fd); }
}


export function codexRevision(file: string): string | undefined {
  try {
    const stat = statSync(file, { bigint: true });
    return stat.isFile() ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}` : undefined;
  } catch { return undefined; }
}

/** No directory scan or recency heuristic: resolve only the selected UUID. */
export function codexNativeRecord(root: string, id: string): CodexNativeRecord | undefined {
  if (!CODEX_UUID.test(id)) return undefined;
  const result = spawnSync('sqlite3', ['-readonly', '-json', join(root, 'state_5.sqlite'),
    `SELECT id,rollout_path,source FROM threads WHERE id='${id}' AND archived=0;`], {
    encoding: 'utf8', timeout: 750, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
  });
  try {
    if (result.status !== 0 || result.error) return undefined;
    const rows = JSON.parse(result.stdout);
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== id
      || !['cli', 'vscode'].includes(rows[0].source) || typeof rows[0].rollout_path !== 'string') return undefined;
    return codexRollout(root, id, rows[0].rollout_path);
  } catch { return undefined; }
}
