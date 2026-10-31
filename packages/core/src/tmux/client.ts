import { spawnSync } from 'node:child_process';
import { BerthError, ExitCode } from '../errors.js';

/** Berth metadata stored on a tmux session as user options (spec §4). */
export const META_KEYS = ['agent', 'cwd', 'argv', 'conversation', 'origin', 'state', 'note', 'topic'] as const;
export type MetaKey = (typeof META_KEYS)[number];
export type SessionMeta = Partial<Record<MetaKey, string>>;

export interface LiveSession {
  name: string;
  attachedClients: number;
  path: string;
  meta: SessionMeta;
  /** The tmux server's start time and pid: names one server lifetime. */
  serverStart: string;
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
    // -u: UTF-8 output whatever the locale. Without it tmux replaces non-ASCII
    // bytes and the field separator with '_' (launchd-started editors and
    // iTerm2 AutoLaunch scripts often have no locale), breaking every row.
    if (this.target.socketPath) return ['-u', '-S', this.target.socketPath];
    return this.target.socket ? ['-u', '-L', this.target.socket] : ['-u'];
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
    const fields = ['#{session_name}', '#{session_attached}', '#{session_path}', '#{start_time}-#{pid}', ...META_KEYS.map((k) => `#{@berth_${k}}`)];
    const result = this.run(['list-sessions', '-F', fields.join(SEP)], true);
    if (!result.ok) return [];
    return result.stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, attached, path, serverStart, ...values] = line.split(SEP);
        const meta: SessionMeta = {};
        META_KEYS.forEach((key, i) => {
          if (values[i]) meta[key] = values[i];
        });
        return { name, attachedClients: Number(attached) || 0, path, meta, serverStart };
      });
  }

  /** Session that owns a pane, e.g. $TMUX_PANE inside an agent's hook. */
  sessionOfPane(pane: string): string | undefined {
    const result = this.run(['display-message', '-p', '-t', pane, '#{session_name}'], true);
    const name = result.stdout.trim();
    return result.ok && name ? name : undefined;
  }

  /** Working directory of the session's active pane, as the shell or agent left it. */
  paneCurrentPath(name: string): string | undefined {
    const result = this.run(['display-message', '-p', '-t', `=${name}:`, '#{pane_current_path}'], true);
    const path = result.stdout.trim();
    return result.ok && path ? path : undefined;
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
      // One line per session in list output: no newlines or separators in values.
      this.run(['set-option', '-t', `=${name}:`, `@berth_${key}`, value.replace(/[\r\n\x1f]+/g, ' ')]);
    }
  }

  /**
   * Make tmux send the session's name, prefixed by its agent state, as the
   * outer terminal's title (OSC 2). Per session, so switch-client updates it.
   */
  setTitle(name: string): void {
    const glyph = '#{?#{==:#{@berth_state},working},● ,}#{?#{==:#{@berth_state},waiting},◐ ,}#{?#{==:#{@berth_state},done},✓ ,}';
    this.run(['set-option', '-t', `=${name}:`, 'set-titles', 'on'], true);
    this.run(['set-option', '-t', `=${name}:`, 'set-titles-string', `${glyph}#S`], true);
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
