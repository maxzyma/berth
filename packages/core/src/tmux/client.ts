import { formatFields, readFields } from './fields.js';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BerthError, ExitCode } from '../errors.js';

/** Berth metadata stored on a tmux session as user options (spec §4). */
export const META_KEYS = ['agent', 'cwd', 'argv', 'argvVerified', 'conversation', 'origin', 'state', 'stateRevision', 'activityTiming', 'nativeCheckedAt', 'nativeTranscript', 'nativeCodexSelection', 'note', 'topic', 'producerPane', 'producerLifetime', 'bindingIssue', 'recovery', 'recoveryAt', 'recoveryDetail', 'ownerWorkspace', 'restoreSource', 'profile'] as const;
export type MetaKey = (typeof META_KEYS)[number];
export type SessionMeta = Partial<Record<MetaKey, string>>;

export interface LiveSession {
  name: string;
  attachedClients: number;
  path: string;
  meta: SessionMeta;
  /** The tmux server's start time and pid: names one server lifetime. */
  serverStart: string;
  sessionId: string;
}

const TEST_SOCKET_PREFIX = 'berth-test-';

export interface TmuxTarget {
  env?: Record<string, string | undefined>;
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
    const result = spawnSync(this.target.bin, [...this.baseArgs(), ...args], { env: this.target.env, encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
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
    const fields = ['session_name', 'session_attached', '?session_path,#{session_path},#{pane_current_path}', 'start_time', 'pid', 'session_id', ...META_KEYS.map((k) => `@berth_${k}`)];
    const result = this.run(['list-sessions', '-F', formatFields(fields)], true);
    if (!result.ok) {
      if (/no server running|No such file or directory|Connection refused/i.test(result.stderr)) return [];
      throw new BerthError(`Cannot read tmux sessions: ${result.stderr.trim()}`, ExitCode.failure);
    }
    return readFields(result.stdout, fields.length).map((fields) => {
        const [name, attached, path, start, pid, sessionId, ...values] = fields;
        const serverStart = `${start}-${pid}`;
        const meta: SessionMeta = {};
        META_KEYS.forEach((key, i) => {
          if (values[i]) {
            const value = values[i];
            if (key === 'argv' && value.startsWith('berth-json:')) {
              const decoded: unknown = JSON.parse(value.slice('berth-json:'.length));
              if (typeof decoded !== 'string') throw new BerthError('Invalid encoded launch arguments.');
              meta[key] = decoded;
            } else meta[key] = value;
          }
        });
        return { name, attachedClients: Number(attached) || 0, path, meta, serverStart, sessionId };
      });
  }

  /** Session that owns a pane, e.g. $TMUX_PANE inside an agent's hook. */
  sessionOfPane(pane: string): string | undefined {
    const result = this.run(['display-message', '-p', '-t', pane, formatFields(['session_name'])], true);
    const name = result.ok ? readFields(result.stdout, 1)[0]?.[0] : undefined;
    return result.ok && name ? name : undefined;
  }

  /** Working directory of the session's active pane, as the shell or agent left it. */
  paneCurrentPath(name: string): string | undefined {
    const result = this.run(['display-message', '-p', '-t', `=${name}:`, formatFields(['pane_current_path'])], true);
    const path = result.ok ? readFields(result.stdout, 1)[0]?.[0] : undefined;
    return result.ok && path ? path : undefined;
  }

  hasSession(name: string): boolean {
    return this.run(['has-session', '-t', `=${name}`], true).ok;
  }

  newSession(name: string, cwd: string, command: string): string {
    const args = ['new-session', '-d', '-P', '-F', '#{session_id}', '-s', name, '-c', cwd];
    return this.run(command ? [...args, command] : args).stdout.trim();
  }

  /** Explicit values/removals override a server's older global environment. */
  setEnvironment(name: string, values: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(values)) {
      this.run(value === undefined
        ? ['set-environment', '-r', '-t', `=${name}:`, key]
        : ['set-environment', '-t', `=${name}:`, key, value]);
    }
  }

  setMeta(name: string, meta: SessionMeta): void {
    const values = meta.state === undefined ? meta : { ...meta, activityTiming: meta.activityTiming ?? '', stateRevision: randomUUID() };
    const commands = Object.entries(values).flatMap(([key, value]) => {
      if (value === undefined) return [];
      // Argument values must survive the line-delimited tmux transport unchanged.
      const encoded = key === 'argv' && (/[\r\n\x1f]/.test(value) || value.startsWith('berth-json:'))
        ? `berth-json:${JSON.stringify(value)}` : value;
      // tmux reads an argument's final `;` as a command separator; `\;` keeps it literal.
      return [['set-option', '-t', `=${name}:`, `@berth_${key}`, encoded.endsWith(';') ? `${encoded.slice(0, -1)}\\;` : encoded]];
    });
    if (commands.length) this.run(commands.flatMap((args, index) => index ? [';', ...args] : args));
  }

  /**
   * Make tmux send the session's name, prefixed by its agent state, as the
   * outer terminal's title (OSC 2). Per session, so switch-client updates it.
   */
  setTitle(name: string): void {
    const glyph = '#{?#{==:#{@berth_state},working},● ,}#{?#{==:#{@berth_state},waiting},◐ ,}#{?#{==:#{@berth_state},done},✓ ,}';
    this.run(['set-option', '-t', `=${name}:`, 'set-titles', 'on', ';', 'set-option', '-t', `=${name}:`, 'set-titles-string', `${glyph}#S`], true);
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
    const endpoint = this.target.socketPath ? basename(this.target.socketPath) : this.target.socket;
    if (!endpoint?.startsWith(TEST_SOCKET_PREFIX)) {
      throw new BerthError('refusing to kill a tmux server that is not a Berth test server');
    }
    this.run(['kill-server'], true);
  }
}
