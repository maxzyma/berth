import { defineConfig } from '@vscode/test-cli';
import { basename, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { integrationEnvironment } from './test/integration/environment.mjs';

const root = process.env.BERTH_TEST_HOST_ROOT;
const phase = process.env.BERTH_TEST_HOST_PHASE;
if (!root || !isAbsolute(root) || !basename(root).startsWith('berth-test-') || !['leader', 'follower', 'other', 'restart'].includes(phase)) {
  throw new Error('Use an isolated absolute berth-test-* root and a leader, follower, other or restart phase.');
}
const profile = join(root, phase);
const workspace = phase === 'other' ? join(root, 'other', 'workspace') : join(root, 'workspace');
mkdirSync(workspace, { recursive: true });
export default defineConfig({
  files: 'test/integration/hosts.test.cjs',
  workspaceFolder: workspace,
  launchArgs: ['--user-data-dir', join(profile, 'user'), '--extensions-dir', join(profile, 'ext'), '--disable-workspace-trust'],
  env: { ...integrationEnvironment(profile), BERTH_TEST_HOST_ROOT: root, BERTH_TEST_HOST_PHASE: phase,
    BERTH_STATE_DIR: join(root, 'state'), BERTH_CONFIG: join(root, 'config.toml'), TMUX_TMPDIR: root,
    BERTH_TMUX_SOCKET: `berth-test-${createHash('sha256').update(root).digest('hex').slice(0, 10)}` },
  ...(process.env.BERTH_TEST_VSCODE_PATH ? { useInstallation: { fromPath: process.env.BERTH_TEST_VSCODE_PATH } } : {}),
  mocha: { ui: 'tdd', timeout: 60000 },
});
