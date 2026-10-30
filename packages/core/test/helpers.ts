/**
 * Test isolation (implementation §5): every test gets its own tmux server on a
 * `berth-test-*` socket, its own HOME / XDG dirs, and stand-in agents. The
 * user's tmux server, agent configuration and editor settings are never touched.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { createContext, type Context } from '../src/context.js';
import { ADAPTERS } from '../src/agents/registry.js';

export const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli/main.js');

// Short shared tmux socket directory: socket paths are limited to ~100 bytes.
const TMUX_DIR = mkdtempSync(join(tmpdir(), 'bt-'));
process.env.TMUX_TMPDIR = TMUX_DIR;
delete process.env.TMUX;
delete process.env.TMUX_PANE;

const STANDIN = `#!/bin/sh
# Stand-in agent: record arguments, then wait like an interactive CLI.
out="$1"; shift
printf '%s\\n' "$@" > "$out"
[ -n "$BERTH_STANDIN_EXIT" ] && exit 0
exec sleep 3600
`;

export interface Sandbox {
  root: string;
  env: Record<string, string>;
  socket: string;
  argvDir: string;
  ctx: () => Context;
  cli: (...args: string[]) => { status: number; stdout: string; stderr: string };
  cliAsync: (...args: string[]) => Promise<{ status: number; stdout: string }>;
  tmux: (...args: string[]) => string;
  argv: (session: string) => string[] | undefined;
  makeDir: (name: string) => string;
}

function agentConfig(standin: string, argvDir: string, overrides: Record<string, { launch?: string; resume?: string }>): string {
  const lines: string[] = [];
  for (const adapter of ADAPTERS) {
    if (adapter.id === 'shell') continue;
    const custom = overrides[adapter.id] ?? {};
    const launch = custom.launch ?? `${standin} ${argvDir}/{name} ${adapter.id} launch {args}`;
    const resume = custom.resume ?? `${standin} ${argvDir}/{name} ${adapter.id} resume {conversation} {args}`;
    lines.push(`[agents.${adapter.id}]`, `launch = ${JSON.stringify(launch)}`, `resume = ${JSON.stringify(resume)}`, '');
  }
  return lines.join('\n');
}

export function sandbox(t: TestContext, overrides: Record<string, { launch?: string; resume?: string }> = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'berth-test-'));
  const socket = `berth-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const argvDir = join(root, 'argv');
  mkdirSync(argvDir, { recursive: true });
  mkdirSync(join(root, 'config', 'berth'), { recursive: true });
  const standin = join(root, 'standin.sh');
  writeFileSync(standin, STANDIN);
  chmodSync(standin, 0o755);
  writeFileSync(join(root, 'config', 'berth', 'config.toml'), agentConfig(standin, argvDir, overrides));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_STATE_HOME: join(root, 'state'),
    BERTH_TMUX_SOCKET: socket,
    TMUX_TMPDIR: TMUX_DIR,
  };
  delete env.TMUX;
  delete env.TMUX_PANE;
  delete env.BERTH_CONFIG;
  delete env.BERTH_STATE_DIR;
  mkdirSync(env.HOME, { recursive: true });
  if (!socket.startsWith('berth-test-')) throw new Error('refusing to run outside a test socket');

  const sb: Sandbox = {
    root,
    env,
    socket,
    argvDir,
    ctx: () => createContext(env),
    cli: (...args) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
      return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
    },
    cliAsync: (...args) =>
      new Promise((done) => {
        const child = spawn(process.execPath, [CLI, ...args], { env });
        let stdout = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.on('close', (status) => done({ status: status ?? -1, stdout }));
      }),
    tmux: (...args) => {
      const r = spawnSync('tmux', ['-L', socket, ...args], { env, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`tmux ${args.join(' ')}: ${r.stderr}`);
      return r.stdout;
    },
    argv: (session) => {
      const file = join(argvDir, session);
      return existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n') : undefined;
    },
    makeDir: (name) => {
      const dir = join(root, 'work', name);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
  };

  t.after(() => {
    spawnSync('tmux', ['-L', socket, 'kill-server'], { env });
    if (process.env.BERTH_KEEP_SANDBOX) process.stderr.write(`kept sandbox: ${root}\n`);
    // A shell in a killed session may still be writing its history into HOME.
    else rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return sb;
}

/** Poll until `check` returns a value, or fail after `timeoutMs`. No fixed sleeps. */
export async function waitFor<T>(check: () => T | undefined | false, what: string, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Kill the sandbox's tmux server, as a reboot would. Only ever a test socket. */
export function killServer(sb: Sandbox): void {
  if (!sb.socket.startsWith('berth-test-')) throw new Error('not a test socket');
  spawnSync('tmux', ['-L', sb.socket, 'kill-server'], { env: sb.env });
}
