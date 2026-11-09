import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, captureProfile, profileRoot } from '@berthdev/berth';

test('CR47 test-electron environment merging cannot restore parent routing or credentials', async (t) => {
  const { integrationEnvironment } = await import(new URL('../../test/integration/environment.mjs', import.meta.url).href);
  const root = mkdtempSync(join(tmpdir(), 'berth-test-editor-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const inherited = { ...process.env, HOME: '/fixture/daily-home', BERTH_TMUX_SOCKET_PATH: '/fixture/daily-socket',
    BERTH_CONFIG: '/fixture/daily-config', BERTH_STATE_DIR: '/fixture/daily-state', BERTH_TMUX: '/fixture/tmux',
    CLAUDE_CONFIG_DIR: '/fixture/claude', CODEX_HOME: '/fixture/codex', QODER_CONFIG_DIR: '/fixture/qoder',
    COPILOT_HOME: '/fixture/copilot', KIMI_CODE_HOME: '/fixture/kimi',
    ANTHROPIC_API_KEY: 'fixture-secret', VSCODE_IPC_HOOK_CLI: '/fixture/editor-ipc', NODE_OPTIONS: '--invalid-fixture' };
  const env = { ...inherited, ...integrationEnvironment(root, inherited) };
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const actual = JSON.parse(child.stdout);
  for (const key of ['ANTHROPIC_API_KEY', 'VSCODE_IPC_HOOK_CLI', 'NODE_OPTIONS', 'BERTH_TMUX_SOCKET_PATH', 'BERTH_TMUX']) assert.equal(actual[key], undefined, key);
  const config = loadConfig(actual);
  assert.match(config.tmuxSocket ?? '', /^berth-test-vscode-/);
  assert.equal(config.tmuxSocketPath, undefined);
  t.after(() => rmSync(actual.TMUX_TMPDIR, { recursive: true, force: true }));
  const socketPath = join(actual.TMUX_TMPDIR, `tmux-${process.getuid?.() ?? 0}`, config.tmuxSocket ?? '');
  assert.ok(Buffer.byteLength(socketPath) < 104, `tmux socket path fits the macOS limit: ${socketPath}`);
  assert.ok(config.stateDir.startsWith(root));
  for (const agent of ['claude', 'codex', 'qoder', 'copilot', 'kimi', 'opencode']) assert.ok(profileRoot(agent, captureProfile(agent, actual)).startsWith(root), agent);
});
