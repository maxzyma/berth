import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BerthError, ExitCode } from '../errors.js';

/** One managed session as recorded in a snapshot (implementation §2.1). */
export interface SnapshotSession {
  name: string;
  cwd: string;
  agent: string;
  argv: string;
  conversation: string;
  origin: string;
}

export interface Snapshot {
  version: 1;
  createdAt: string;
  sessions: SnapshotSession[];
}

export interface StoredSnapshot extends Snapshot {
  dir: string;
}

const SNAPSHOT_VERSION = 1;
const DIR_PATTERN = /^\d{8}T\d{6}(\d{3})?Z(-\d+)?$/;

function timestampDir(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

export class SnapshotStore {
  constructor(readonly root: string) {}

  /** Snapshot directories, newest first. */
  list(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((name) => DIR_PATTERN.test(name) && existsSync(join(this.root, name, 'sessions.json')))
      .sort()
      .reverse()
      .map((name) => join(this.root, name));
  }

  read(dir: string): StoredSnapshot {
    const file = join(dir, 'sessions.json');
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new BerthError(`cannot read snapshot ${file}: ${(error as Error).message}`);
    }
    const snapshot = data as Snapshot;
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new BerthError(`unsupported snapshot version ${String(snapshot.version)} in ${file}`);
    }
    if (!Array.isArray(snapshot.sessions)) throw new BerthError(`malformed snapshot ${file}`);
    return { ...snapshot, dir };
  }

  newest(): StoredSnapshot | undefined {
    const [dir] = this.list();
    return dir ? this.read(dir) : undefined;
  }

  /** Write atomically: build in a temporary directory, then rename into place. */
  write(sessions: SnapshotSession[], scrollback: Record<string, string>, now = new Date()): string {
    mkdirSync(this.root, { recursive: true });
    let name = timestampDir(now);
    for (let n = 2; existsSync(join(this.root, name)); n++) name = `${timestampDir(now)}-${n}`;
    const tmp = join(this.root, `.tmp-${process.pid}-${name}`);
    mkdirSync(join(tmp, 'scrollback'), { recursive: true });
    const snapshot: Snapshot = { version: SNAPSHOT_VERSION, createdAt: now.toISOString(), sessions };
    writeFileSync(join(tmp, 'sessions.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    for (const [session, text] of Object.entries(scrollback)) {
      writeFileSync(join(tmp, 'scrollback', `${session}.txt`), text);
    }
    const dir = join(this.root, name);
    renameSync(tmp, dir);
    return dir;
  }

  prune(keep: number): void {
    for (const dir of this.list().slice(keep)) rmSync(dir, { recursive: true, force: true });
  }

  scrollback(dir: string, session: string): string {
    const file = join(dir, 'scrollback', `${session}.txt`);
    if (!existsSync(file)) throw new BerthError(`no saved scrollback for ${session}`, ExitCode.notFound);
    return readFileSync(file, 'utf8');
  }
}
