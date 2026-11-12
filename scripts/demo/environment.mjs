// Isolated demo environment: one temporary root holding HOME, the tmux socket
// directory, the Claude Code profile and a VS Code user-data and extensions
// directory. VS Code is launched in the background with a loopback-only
// debugging port; nothing outside the root is written.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { startModelServer } from './model-server.mjs';
import * as scene from './scene.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Resolve an executable on the caller's PATH to its real file. */
export function which(name) {
  const found = spawnSync('/usr/bin/which', [name], { encoding: 'utf8' });
  if (found.status !== 0) throw new Error(`${name} was not found on PATH.`);
  return realpathSync(found.stdout.trim());
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** VS Code's CLI script inside the app bundle (Contents/Resources/app/bin/code). */
function vscodeCli(app) {
  const cli = join(app, 'Contents', 'Resources', 'app', 'bin', 'code');
  if (!existsSync(cli)) throw new Error(`No VS Code CLI at ${cli}; pass --vscode-app.`);
  return cli;
}

function claudeVersion(claude) {
  const out = execFileSync(claude, ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  const version = out.match(/\d+\.\d+\.\d+/)?.[0];
  if (!version) throw new Error(`Cannot read the Claude Code version from: ${out}`);
  return version;
}

export class DemoEnvironment {
  /**
   * @param {{ tmpBase: string, vsix: string, vscodeApp: string, log: (line: string) => void }} options
   */
  constructor(options) {
    this.options = options;
    this.log = options.log;
  }

  async create() {
    const { tmpBase, vsix, vscodeApp } = this.options;
    mkdirSync(tmpBase, { recursive: true });
    this.dirs = scene.layout(mkdtempSync(join(tmpBase, 'berth-demo-')));
    const { dirs } = this;
    this.log(`root ${dirs.root}`);
    mkdirSync(dirs.bin, { recursive: true });
    const claude = which('claude');
    const tmux = which('tmux');
    symlinkSync(claude, join(dirs.bin, 'claude'));
    symlinkSync(tmux, join(dirs.bin, 'tmux'));
    const path = [dirs.bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
    scene.writeWorkspace(dirs);
    scene.writeHome(dirs, path);
    scene.seedClaude(dirs, claudeVersion(claude));
    scene.writeVsCodeSettings(dirs);

    this.model = await startModelServer({ log: join(dirs.logs, 'model.jsonl') });
    this.debugPort = await freePort();
    this.env = {
      HOME: dirs.home,
      PATH: path,
      SHELL: '/bin/zsh',
      LANG: 'en_US.UTF-8',
      TZ: 'UTC',
      TMUX_TMPDIR: dirs.tmuxDir,
      // Pin Berth to the demo server even if a TMUX variable leaks in.
      BERTH_TMUX_SOCKET_PATH: join(dirs.tmuxDir, `tmux-${process.getuid()}`, 'default'),
      XDG_CONFIG_HOME: join(dirs.home, '.config'),
      XDG_STATE_HOME: join(dirs.home, '.local', 'state'),
      CLAUDE_CONFIG_DIR: dirs.claudeConfig,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${this.model.port}`,
      ANTHROPIC_API_KEY: scene.API_KEY,
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };
    this.cli = vscodeCli(vscodeApp);
    this.run(this.cli, [...this.vscodeDirs(), '--install-extension', vsix, '--force']);
    this.log(`installed ${vsix.split('/').pop()}`);
  }

  vscodeDirs() {
    return ['--user-data-dir', this.dirs.userData, '--extensions-dir', this.dirs.extensions];
  }

  /** Run a command with only the isolated environment (no TMUX from the caller). */
  run(file, args, extra = {}) {
    return execFileSync(file, args, { env: { ...this.env, TERM: 'xterm-256color', ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  tmux(...args) {
    return this.run(join(this.dirs.bin, 'tmux'), args);
  }

  /** Start a Claude Code session in tmux the way a terminal user would. */
  startSession({ name, folder, prompt }) {
    const cwd = join(this.dirs.projects, folder);
    const command = prompt ? `claude ${JSON.stringify(prompt)}` : 'claude';
    this.tmux('new-session', '-d', '-x', '110', '-y', '40', '-s', name, '-c', cwd, command);
  }

  /** Restart a session's agent so it loads newly installed hooks. */
  restartSession({ name, folder, prompt }) {
    const cwd = join(this.dirs.projects, folder);
    this.tmux('respawn-pane', '-k', '-t', name, '-c', cwd, `claude ${JSON.stringify(prompt)}`);
  }

  pane(name) {
    return this.tmux('capture-pane', '-p', '-t', name);
  }

  /** Launch VS Code without activating it (open -g) on the demo workspace. */
  launchVsCode() {
    const { dirs } = this;
    const envArgs = Object.entries(this.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
    // `open` forwards the caller's environment to the app, so it runs with
    // only a minimal one: an inherited TMUX would point Berth at the caller's server.
    const launchEnv = { PATH: '/usr/bin:/bin', HOME: dirs.home };
    // The workspace is passed as a document: VS Code ignores positional
    // arguments when LaunchServices starts it.
    execFileSync('/usr/bin/open', ['-g', '-n', ...envArgs, '-a', this.options.vscodeApp, dirs.workspaceFile, '--args',
      ...this.vscodeDirs(),
      `--remote-debugging-port=${this.debugPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--use-inmemory-secretstorage',
      '--disable-telemetry',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling'], { env: launchEnv });
    this.log(`launched VS Code (debugging on 127.0.0.1:${this.debugPort})`);
  }

  /**
   * Fail unless every process of the demo VS Code runs with the demo tmux
   * directory and without TMUX (ps -E shows the environment of own processes).
   */
  verifyVsCodeEnvironment() {
    const pids = this.vscodePids();
    if (!pids.length) throw new Error('The demo VS Code is not running.');
    for (const pid of pids) {
      const out = spawnSync('/bin/ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout;
      if (!out) continue;
      if (/(^|\s)TMUX=/.test(out)) throw new Error(`VS Code process ${pid} inherited TMUX; stopping before it reaches another tmux server.`);
      if (!out.includes(`TMUX_TMPDIR=${this.dirs.tmuxDir}`)) throw new Error(`VS Code process ${pid} does not use the demo TMUX_TMPDIR.`);
    }
    this.log(`verified the environment of ${pids.length} VS Code processes`);
  }

  /** PIDs of the VS Code instance that uses this environment's user-data directory. */
  vscodePids() {
    const out = spawnSync('/usr/bin/pgrep', ['-f', '--', `--user-data-dir[= ]${this.dirs.userData}`], { encoding: 'utf8' }).stdout;
    return out.split('\n').filter(Boolean).map(Number);
  }

  async stopVsCode() {
    const main = this.vscodePids();
    for (const pid of main) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
    for (let i = 0; i < 50 && this.vscodePids().length; i++) await sleep(200);
    for (const pid of this.vscodePids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  }

  async shutdown({ keepRoot = false } = {}) {
    if (!this.dirs) return;
    await this.stopVsCode().catch(error => this.log(`stopping VS Code: ${error.message}`));
    try { this.tmux('kill-server'); } catch { /* no server running */ }
    await this.model?.close();
    if (!keepRoot) rmSync(this.dirs.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    this.log(keepRoot ? `kept ${this.dirs.root}` : 'removed the temporary root');
  }
}

/**
 * Fingerprint of the caller's own default tmux server's global hooks and
 * Berth options, read-only. The capture compares it before and after each phase to
 * prove the demo never changed that server.
 */
export function callerTmuxFingerprint(tmuxBin = which('tmux')) {
  const socket = process.env.TMUX?.split(',')[0]
    || join(process.env.TMUX_TMPDIR || '/tmp', `tmux-${process.getuid()}`, 'default');
  if (!existsSync(socket)) return 'no caller tmux server';
  const env = { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '' };
  const read = args => spawnSync(tmuxBin, ['-S', socket, ...args], { env, encoding: 'utf8' }).stdout ?? '';
  const hooks = read(['show-hooks', '-g']);
  const options = read(['show-options', '-g']).split('\n').filter(line => line.startsWith('@berth')).join('\n');
  return createHash('sha256').update(hooks).update('\0').update(options).digest('hex');
}
