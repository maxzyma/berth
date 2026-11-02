import type { AgentProfile } from '../agents/profile.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecoveryStatus } from '../restore/status.js';
import { BerthError, ExitCode } from '../errors.js';

/** One managed session as recorded in a snapshot (implementation §2.1). */
export interface SnapshotSession extends RecoveryStatus {
  name: string;
  cwd: string;
  agent: string;
  argv: string;
  argvVerified?: boolean;
  conversation: string;
  origin: string;
  /** The tmux server lifetime the session was last seen in (absent in older snapshots). */
  serverStart?: string;
  sessionId?: string;
  retained?: boolean;
  profile?: AgentProfile;
  bindingIssue?: string;
  ownerWorkspace?: string;
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

/** Session names may contain '/' and other characters a file name cannot. */
function scrollbackFile(session: string): string {
  return `${encodeURIComponent(session)}.txt`;
}

export class SnapshotStore {
  constructor(readonly root: string) {}

  /** Snapshot directories, newest first. */
  list(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((name) => DIR_PATTERN.test(name) && existsSync(join(this.root, name, 'sessions.json')))
      .sort((a, b) => {
        const parse = (value: string) => {
          const parts = /^(\d{8}T\d{6})(\d{3})?Z(?:-(\d+))?$/.exec(value)!;
          return { time: parts[1] + (parts[2] ?? '000'), sequence: Number(parts[3] ?? 1) };
        };
        const x = parse(a), y = parse(b);
        return y.time.localeCompare(x.time) || y.sequence - x.sequence;
      })
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
    const latest = this.newest();
    const committedAt = latest && Date.parse(latest.createdAt) > now.getTime() ? new Date(latest.createdAt) : now;
    let name = timestampDir(committedAt);
    for (let n = 2; existsSync(join(this.root, name)); n++) name = `${timestampDir(committedAt)}-${n}`;
    const tmp = join(this.root, `.tmp-${process.pid}-${name}`);
    mkdirSync(join(tmp, 'scrollback'), { recursive: true });
    const snapshot: Snapshot = { version: SNAPSHOT_VERSION, createdAt: committedAt.toISOString(), sessions };
    writeFileSync(join(tmp, 'sessions.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    for (const [session, text] of Object.entries(scrollback)) {
      writeFileSync(join(tmp, 'scrollback', scrollbackFile(session)), text);
    }
    // Concurrent snapshots (tmux hooks run in the background) may pick the same name.
    for (let n = 2; ; n++) {
      const dir = join(this.root, name);
      try {
        renameSync(tmp, dir);
        return dir;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code !== 'ENOTEMPTY' && code !== 'EEXIST') || n > 50) {
          rmSync(tmp, { recursive: true, force: true });
          throw error;
        }
        name = `${timestampDir(committedAt)}-${n}`;
      }
    }
  }

  prune(keep: number): void {
    for (const dir of this.list().slice(keep)) rmSync(dir, { recursive: true, force: true });
  }

  /** Missing output is optional; unreadable output must not be silently discarded. */
  optionalScrollback(dir: string, session: string): string | undefined {
    try { return readFileSync(join(dir, 'scrollback', scrollbackFile(session)), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  scrollback(dir: string, session: string): string {
    const text = this.optionalScrollback(dir, session);
    if (text === undefined) throw new BerthError(`no saved scrollback for ${session}`, ExitCode.notFound);
    return text;
  }
}
