import { spawnSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, basename, sep } from 'node:path';
import { processLifetime } from '../process-owner.js';

export interface CodexBinding { conversation: string; root: string }
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROLLOUT = new RegExp(`^rollout-.+-(${UUID})\\.jsonl$`, 'i');
const HEADER_LIMIT = 1024 * 1024;
const failures = new Map<string, number>();

/** Only numeric descriptors open for writing; never a filename mentioned in output. */
export function writableFiles(output: string, pid: number): string[] {
  let owner = false, descriptor = false, writable = false;
  const files: string[] = [];
  for (const field of output.split('\n')) {
    if (field.startsWith('p')) { owner = field === `p${pid}`; descriptor = false; writable = false; }
    else if (field.startsWith('f')) { descriptor = /^f\d+$/.test(field); writable = false; }
    else if (field.startsWith('a')) writable = field === 'aw' || field === 'au';
    else if (owner && descriptor && writable && field.startsWith('n/')) files.push(field.slice(1));
  }
  return [...new Set(files)];
}

/** Read metadata only, never transcript text or the newest file in a directory. */
export function rolloutBinding(file: string, expectedInode?: number): CodexBinding | undefined {
  let fd: number | undefined;
  try {
    const canonical = realpathSync(file);
    const match = ROLLOUT.exec(basename(canonical));
    if (!match) return undefined;
    const parts = canonical.split(sep);
    const index = parts.length - 5;
    if (parts[index] !== 'sessions' || !/^\d{4}$/.test(parts[index + 1]) || !/^\d{2}$/.test(parts[index + 2]) || !/^\d{2}$/.test(parts[index + 3])) return undefined;
    fd = openSync(canonical, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile() || (expectedInode !== undefined && stat.ino !== expectedInode)) return undefined;
    const bytes = Buffer.alloc(HEADER_LIMIT);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    const end = bytes.subarray(0, count).indexOf(10);
    if (end < 0) return undefined;
    const record = JSON.parse(bytes.subarray(0, end).toString('utf8'));
    const meta = record?.payload;
    if (record?.type !== 'session_meta' || meta?.source !== 'cli' || meta.parent_thread_id || meta.agent_role || meta.agent_path) return undefined;
    if (typeof meta.id !== 'string' || meta.id.toLowerCase() !== match[1].toLowerCase()) return undefined;
    return { conversation: meta.id, root: dirname(dirname(dirname(dirname(dirname(canonical))))) };
  } catch { return undefined; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** The same writer must still own the same file and process after inspection. */
export function codexProcessBinding(pid: number, lifetime: string): CodexBinding | undefined {
  const key = `${pid}:${lifetime}`, now = Date.now();
  if ((failures.get(key) ?? 0) > now) return undefined;
  for (const [entry, until] of failures) if (until <= now) failures.delete(entry);
  const readFiles = () => {
    const result = spawnSync('lsof', ['-n', '-P', '-a', '-p', String(pid), '-F', 'pfain'], {
      encoding: 'utf8', timeout: 750, killSignal: 'SIGKILL', maxBuffer: 256 * 1024,
    });
    if (result.status !== 0 || result.error) return [];
    const files = new Set(writableFiles(result.stdout, pid));
    return result.stdout.split(/(?=^f)/m).flatMap(block => {
      const file = /^n(.+)$/m.exec(block)?.[1];
      const inode = Number(/^i(\d+)$/m.exec(block)?.[1]);
      return file && files.has(file) && ROLLOUT.test(basename(file)) && Number.isSafeInteger(inode) && inode > 0 ? [{ file, inode }] : [];
    });
  };
  try {
    if (processLifetime(pid)?.key !== lifetime) return undefined;
    const files = readFiles();
    // Multiple writer files may represent concurrent threads, even when only one parses.
    if (files.length === 1) {
      const binding = rolloutBinding(files[0].file, files[0].inode);
      if (binding && JSON.stringify(readFiles()) === JSON.stringify(files) && processLifetime(pid)?.key === lifetime) return binding;
    }
  } catch { /* Optional native evidence must not interrupt discovery. */ }
  if (failures.size >= 256) failures.clear();
  failures.set(key, now + 30_000);
  return undefined;
}
