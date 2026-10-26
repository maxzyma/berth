import { spawnSync } from 'node:child_process';
import { BerthError, ExitCode } from '../errors.js';

/** Berth metadata stored on a tmux session as user options (spec §4). */
export const META_KEYS = ['agent', 'cwd', 'argv', 'conversation', 'origin', 'state', 'note'] as const;
export type MetaKey = (typeof META_KEYS)[number];
export type SessionMeta = Partial<Record<MetaKey, string>>;

export interface LiveSession {
  name: string;
  attachedClients: number;
  path: string;
  meta: SessionMeta;
}

const SEP = '\x1f';
const TEST_SOCKET_PREFIX = 'berth-test-';

export interface TmuxTarget {
  bin: string;
  /** `-L` socket name; undefined addresses the default server (or $TMUX inside a pane). */
  socket?: string;
  /** `-S` socket path; takes precedence over `socket`. Used by hooks running inside a pane. */
  socketPath?: string;
}

export class Tmux {
  constructor(readonly target: TmuxTarget) {}

  private baseArgs(): string[] {
    if (this.target.socketPath) return ['-S', this.target.socketPath];
    return this.target.socket ? ['-L', this.target.socket] : [];
  }

  /** Run tmux; returns stdout. Throws BerthError on failure unless `allowFail`. */
  run(args: string[], allowFail = false): { ok: boolean; stdout: string; stderr: string } {
    const result = spawnSync(this.target.bin, [...this.baseArgs(), ...args], { encoding: 'utf8' });
    if (result.error) {
      throw new BerthError(`tmux unavailable (${this.target.bin}): ${result.error.message}`, ExitCode.tmuxUnavailable);
    }
    const ok = result.status === 0;
    if (!ok && !allowFail) {
      throw new BerthError(`tmux ${args[0]} failed: ${result.stderr.trim()}`, ExitCode.failure);
    }
    return { ok, stdout: result.stdout, stderr: result.stderr };
  }

  serverRunning(): boolean {
    return this.run(['list-sessions', '-F', '#{session_name}'], true).ok;
  }

  listSessions(): LiveSession[] {
    const fields = ['#{session_name}', '#{session_attached}', '#{session_path}', ...META_KEYS.map((k) => `#{@berth_${k}}`)];
    const result = this.run(['list-sessions', '-F', fields.join(SEP)], true);
    if (!result.ok) return [];
    return result.stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, attached, path, ...values] = line.split(SEP);
        const meta: SessionMeta = {};
        META_KEYS.forEach((key, i) => {
          if (values[i]) meta[key] = values[i];
        });
        return { name, attachedClients: Number(attached) || 0, path, meta };
      });
  }

  /** Session that owns a pane, e.g. $TMUX_PANE inside an agent's hook. */
  sessionOfPane(pane: string): string | undefined {
    const result = this.run(['display-message', '-p', '-t', pane, '#{session_name}'], true);
    const name = result.stdout.trim();
    return result.ok && name ? name : undefined;
  }

  hasSession(name: string): boolean {
    return this.run(['has-session', '-t', `=${name}`], true).ok;
  }

  newSession(name: string, cwd: string, command: string): void {
    const args = ['new-session', '-d', '-s', name, '-c', cwd];
    this.run(command ? [...args, command] : args);
  }

  setMeta(name: string, meta: SessionMeta): void {
    for (const [key, value] of Object.entries(meta)) {
      if (value === undefined) continue;
      this.run(['set-option', '-t', `=${name}:`, `@berth_${key}`, value]);
    }
  }

  renameSession(from: string, to: string): void {
    this.run(['rename-session', '-t', `=${from}`, to]);
  }

  killSession(name: string): void {
    this.run(['kill-session', '-t', `=${name}`]);
  }

  capturePane(name: string, lines: number): string {
    const result = this.run(['capture-pane', '-p', '-S', `-${lines}`, '-t', `=${name}:`], true);
    return result.ok ? result.stdout : '';
  }

  /** Command that attaches a terminal to a session. */
  attachArgv(name: string): string[] {
    return [this.target.bin, ...this.baseArgs(), 'attach-session', '-t', `=${name}`];
  }

  /** Server-wide kill, allowed only on Berth test sockets (implementation §5.1). */
  killServer(): void {
    if (!this.target.socket?.startsWith(TEST_SOCKET_PREFIX)) {
      throw new BerthError('refusing to kill a tmux server that is not a Berth test server');
    }
    this.run(['kill-server'], true);
  }
}
