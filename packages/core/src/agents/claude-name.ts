import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Name key (spec §4.2): a Claude Code session started with `--name X` records
 * X as a `custom-title` entry near the top of its transcript. The newest
 * transcript in the session's directory carrying that title is the session's
 * conversation. Claude keeps a directory's transcripts under
 * ~/.claude/projects/<cwd with every non-alphanumeric character as '-'>.
 */
const HEADER_LINES = 40;

function projectDirs(cwd: string, home: string): string[] {
  const encode = (p: string) => join(home, '.claude', 'projects', p.replace(/[^A-Za-z0-9]/g, '-'));
  const dirs = [encode(cwd)];
  try {
    const real = realpathSync(cwd);
    if (real !== cwd) dirs.push(encode(real));
  } catch {
    // The directory may be gone; the recorded path still names its transcripts.
  }
  return dirs.filter((d) => existsSync(d));
}

function titleOf(file: string): string | undefined {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    for (const line of buffer.subarray(0, read).toString('utf8').split('\n').slice(0, HEADER_LINES)) {
      try {
        const entry = JSON.parse(line) as { type?: string; customTitle?: string };
        if (entry.type === 'custom-title' && entry.customTitle) return entry.customTitle;
      } catch {
        // Partial or non-JSON line.
      }
    }
    return undefined;
  } finally {
    closeSync(fd);
  }
}

export function claudeConversationByName(cwd: string, name: string, home = process.env.HOME || homedir()): string | undefined {
  const files = projectDirs(cwd, home)
    .flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)))
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { file } of files) {
    if (titleOf(file) === name) return file.replace(/^.*\//, '').replace(/\.jsonl$/, '');
  }
  return undefined;
}
