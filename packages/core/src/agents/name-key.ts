import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Name key (spec §4.2): an agent started with `--name X` records X as a
 * `custom-title` entry near the top of its transcript. The newest transcript
 * in the session's directory carrying that title is the session's
 * conversation. Claude Code and Qoder CLI keep a directory's transcripts as
 * <root>/projects/<encoded cwd>/<id>.jsonl; Claude encodes every
 * non-alphanumeric character as '-', Qoder documents '/' as '-'.
 */
const HEADER_LINES = 40;

const ROOTS: Record<string, (env: Record<string, string | undefined>) => string> = {
  claude: (env) => join(env.HOME || homedir(), '.claude'),
  qoder: (env) => env.QODER_CONFIG_DIR || join(env.HOME || homedir(), '.qoder'),
};

const ENCODINGS = [(p: string) => p.replace(/[^A-Za-z0-9]/g, '-'), (p: string) => p.replace(/\//g, '-')];

function projectDirs(root: string, cwd: string): string[] {
  const paths = [cwd];
  try {
    const real = realpathSync(cwd);
    if (real !== cwd) paths.push(real);
  } catch {
    // The directory may be gone; the recorded path still names its transcripts.
  }
  const dirs = paths.flatMap((p) => ENCODINGS.map((encode) => join(root, 'projects', encode(p))));
  return [...new Set(dirs)].filter((d) => existsSync(d));
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

export function conversationByName(agent: string, cwd: string, name: string, env = process.env): string | undefined {
  const root = ROOTS[agent];
  if (!root) return undefined;
  const files = projectDirs(root(env), cwd)
    .flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)))
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { file } of files) {
    if (titleOf(file) === name) return file.replace(/^.*\//, '').replace(/\.jsonl$/, '');
  }
  return undefined;
}
