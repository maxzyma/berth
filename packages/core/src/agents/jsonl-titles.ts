import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, type BigIntStats } from 'node:fs';
import { join } from 'node:path';

type Kind = 'custom-title' | 'codex';
export interface TitleRead { titles: Map<string, string>; bytesRead: number; cacheHit: boolean }
const CHUNK_SIZE = 64 * 1024;
const CACHE_LIMIT = 1024 * 1024;
const fingerprint = (stat: BigIntStats) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');

function cached(file: string | undefined, source: string, ids: string[]): Map<string, string> | undefined {
  if (!file) return undefined;
  try {
    if (statSync(file).size > CACHE_LIMIT) return undefined;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data.version !== 1 || data.source !== source || JSON.stringify(data.ids) !== JSON.stringify(ids)
      || !Array.isArray(data.titles) || !data.titles.every((entry: unknown) => Array.isArray(entry)
        && entry.length === 2 && ids.includes(entry[0]) && typeof entry[1] === 'string' && entry[1].trim())) return undefined;
    return new Map(data.titles);
  } catch { return undefined; }
}

function save(file: string | undefined, source: string, ids: string[], titles: Map<string, string>): void {
  if (!file) return;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const value = JSON.stringify({ version: 1, source, ids, titles: [...titles] });
    if (Buffer.byteLength(value) > CACHE_LIMIT) return;
    writeFileSync(temporary, value, { mode: 0o600 });
    renameSync(temporary, file);
  } catch { /* The cache is optional derived data. */ }
  finally { try { rmSync(temporary, { force: true }); } catch { /* Read-only cache directory. */ } }
}

/** Complete records in reverse order, including records split across UTF-8 chunks. */
function* reverseLines(fd: number, size: number, count: (bytes: number) => void): Generator<string> {
  let position = size;
  let fragments: Buffer[] = [];
  while (position > 0) {
    const length = Math.min(position, CHUNK_SIZE);
    position -= length;
    const buffer = Buffer.alloc(length);
    const bytes = readSync(fd, buffer, 0, length, position);
    count(bytes);
    if (bytes !== length) throw new Error('Title source changed during inspection');
    let end = length;
    for (let i = buffer.lastIndexOf(10); i >= 0; i = buffer.lastIndexOf(10, i - 1)) {
      yield Buffer.concat([buffer.subarray(i + 1, end), ...fragments]).toString('utf8');
      fragments = [];
      end = i;
      if (i === 0) break;
    }
    fragments = [buffer.subarray(0, end), ...fragments];
  }
  if (fragments.length) yield Buffer.concat(fragments).toString('utf8');
}

function titleEntry(line: string, kind: Kind, ids: string[]): [string, string] | undefined {
  try {
    // Most transcript records contain messages rather than names.
    if (!line.includes(kind === 'codex' ? 'thread_name' : 'custom-title') && !line.includes('\\u')) return undefined;
    const entry = JSON.parse(line);
    const id = kind === 'codex' ? entry.id : entry.type === 'custom-title' ? ids[0] : undefined;
    const value = kind === 'codex' ? entry.thread_name : entry.customTitle;
    return ids.includes(id) && typeof value === 'string' && value.trim() ? [id, value.trim()] : undefined;
  } catch { return undefined; } // An incomplete last record does not replace a title.
}

export function readJsonlTitles(file: string, requested: readonly string[], kind: Kind, cacheDir?: string): TitleRead {
  const ids = [...new Set(requested)].sort();
  let bytesRead = 0;
  const empty = (): TitleRead => ({ titles: new Map(), bytesRead, cacheHit: false });
  if (!ids.length) return empty();
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const before = fstatSync(fd, { bigint: true });
    const source = fingerprint(before);
    const cacheFile = cacheDir ? join(cacheDir, `${createHash('sha256').update(JSON.stringify([file, kind])).digest('hex')}.json`) : undefined;
    const prior = cached(cacheFile, source, ids);
    if (prior && fingerprint(statSync(file, { bigint: true })) === source) return { titles: prior, bytesRead, cacheHit: true };
    const titles = new Map<string, string>();
    for (const line of reverseLines(fd, Number(before.size), (bytes) => { bytesRead += bytes; })) {
      const entry = titleEntry(line, kind, ids);
      if (entry && !titles.has(entry[0])) titles.set(...entry);
      if (titles.size === ids.length) break;
    }
    if (fingerprint(fstatSync(fd, { bigint: true })) !== source || fingerprint(statSync(file, { bigint: true })) !== source) return empty();
    if (cacheDir) {
      try { mkdirSync(cacheDir, { recursive: true, mode: 0o700 }); } catch { /* Cache failure must not hide a title. */ }
    }
    save(cacheFile, source, ids, titles);
    return { titles, bytesRead, cacheHit: false };
  } catch { return empty(); }
  finally { if (fd !== undefined) closeSync(fd); }
}
