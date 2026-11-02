import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';

const MAX_READ = 1024 * 1024;
const HEADER_BYTES = 8192;
const ANCHOR_BYTES = 256;
interface Cursor { path: string; dev: number; ino: number; offset: number; anchor: string; at: number }
function read(fd: number, start: number, length: number): Buffer {
  const result = Buffer.alloc(length);
  if (readSync(fd, result, 0, length, start) !== length) throw new Error('Transcript changed while reading.');
  return result;
}
function anchor(fd: number, offset: number): string {
  return createHash('sha256').update(read(fd, Math.max(0, offset - ANCHOR_BYTES), Math.min(offset, ANCHOR_BYTES))).digest('hex');
}
function headerMatches(fd: number, size: number, matches: HeaderMatch): boolean {
  const head = read(fd, 0, Math.min(size, HEADER_BYTES)).toString('utf8');
  const end = head.indexOf('\n');
  if (end < 0) return false;
  const data: unknown = JSON.parse(head.slice(0, end));
  return !!data && typeof data === 'object' && !Array.isArray(data) && matches(data as Record<string, unknown>);
}
function withinRoot(file: string, root: string): boolean {
  const path = relative(realpathSync(root), file);
  return !!path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

type HeaderMatch = (header: Record<string, unknown>) => boolean;

/** Cursor is captured by a verified producer hook, never recovered from a snapshot. */
export function transcriptCursor(file: unknown, root: string, matches: HeaderMatch): string {
  if (typeof file !== 'string' || !isAbsolute(file)) return '';
  let fd: number | undefined;
  try {
    const path = realpathSync(file);
    if (!withinRoot(path, root)) return '';
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile() || !headerMatches(fd, stat.size, matches)) return '';
    if (stat.size && read(fd, stat.size - 1, 1)[0] !== 10) return '';
    return JSON.stringify({ path, dev: stat.dev, ino: stat.ino, offset: stat.size,
      anchor: anchor(fd, stat.size), at: Date.now() } satisfies Cursor);
  } catch { return ''; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Read only complete appended records from the same profile-owned file. */
export function transcriptTail(value: string | undefined, root: string, matches: HeaderMatch): { lines: string[]; at: number } | undefined {
  if (!value) return undefined;
  let fd: number | undefined;
  try {
    const cursor: Cursor = JSON.parse(value);
    if (!cursor || typeof cursor.path !== 'string' || !isAbsolute(cursor.path)
      || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !Number.isFinite(cursor.at)
      || typeof cursor.anchor !== 'string' || !withinRoot(realpathSync(cursor.path), root)) return undefined;
    fd = openSync(cursor.path, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.dev !== cursor.dev || stat.ino !== cursor.ino || stat.size <= cursor.offset
      || !headerMatches(fd, stat.size, matches) || anchor(fd, cursor.offset) !== cursor.anchor) return undefined;
    const start = Math.max(cursor.offset, stat.size - MAX_READ);
    const bytes = read(fd, start, stat.size - start);
    if (bytes.at(-1) !== 10) return undefined;
    const lines = bytes.toString('utf8').split('\n').slice(0, -1);
    const complete = start > cursor.offset ? lines.slice(1) : lines;
    return { lines: complete, at: cursor.at };
  } catch { return undefined; }
  finally { if (fd !== undefined) closeSync(fd); }
}
