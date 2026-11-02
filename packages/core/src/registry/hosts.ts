import { processLifetime, processOwnerAlive } from '../process-owner.js';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withLock } from '../restore/lock.js';

export interface WorkspaceIdentity { key: string; label: string }
export interface HostRecord {
  lifetime?: string;
  id: string; pid: number; seenAt: number; application: string;
  workspace?: WorkspaceIdentity; terminalPids: number[];
}

export function workspaceIdentity(folders: readonly string[], workspaceFile = '', label = ''): WorkspaceIdentity | undefined {
  if (!folders.length && !workspaceFile) return undefined;
  const roots = [...new Set(folders)].sort();
  return { key: createHash('sha256').update(JSON.stringify([workspaceFile, roots])).digest('hex'), label: label || roots.join(', ') || workspaceFile };
}

function read(file: string): HostRecord | undefined {
  try {
    const record = JSON.parse(readFileSync(file, 'utf8')) as HostRecord;
    return typeof record.id === 'string' && processOwnerAlive(record.pid, record.lifetime, statSync(file).mtimeMs) ? record : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function registeredHosts(stateDir: string): HostRecord[] {
  const dir = join(stateDir, 'hosts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).flatMap((name) => {
    const record = read(join(dir, name));
    return record && Date.now() - record.seenAt < 45_000 && Array.isArray(record.terminalPids) ? [record] : [];
  });
}

/** One window's runtime evidence and exclusive startup claim, scoped to one tmux server. */
export class HostRegistration {
  readonly id = randomUUID();
  private readonly dir: string;
  private claimed?: string;
  constructor(private readonly stateDir: string, private readonly application: string, readonly workspace?: WorkspaceIdentity) {
    this.dir = join(stateDir, 'hosts');
  }

  update(terminalPids: readonly number[]): void {
    mkdirSync(this.dir, { recursive: true });
    const record: HostRecord = { id: this.id, pid: process.pid, lifetime: processLifetime(process.pid)!.key, seenAt: Date.now(), application: this.application, workspace: this.workspace, terminalPids: [...terminalPids] };
    const file = join(this.dir, `${this.id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  claimStartup(): boolean {
    if (!this.workspace) return false;
    const dir = join(this.stateDir, 'host-claims');
    return withLock(dir, () => {
      const file = join(dir, `${this.workspace!.key}.json`);
      const owner = read(file);
      if (owner && owner.id !== this.id) return false;
      writeFileSync(file, JSON.stringify({ id: this.id, pid: process.pid, lifetime: processLifetime(process.pid)!.key }), { mode: 0o600 });
      this.claimed = file;
      return true;
    }, 1000);
  }

  dispose(): void {
    rmSync(join(this.dir, `${this.id}.json`), { force: true });
    if (this.claimed && read(this.claimed)?.id === this.id) rmSync(this.claimed, { force: true });
  }
}
