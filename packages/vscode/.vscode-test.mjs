// Integration tests in a real VS Code instance (implementation §5.3).
// Opens a VS Code window; run deliberately with `npm run test:vscode`.
import { defineConfig } from '@vscode/test-cli';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'bv-'));

export default defineConfig({
  files: 'test/integration/**/*.test.cjs',
  workspaceFolder: root,
  launchArgs: ['--user-data-dir', join(root, 'user'), '--extensions-dir', join(root, 'ext'), '--disable-workspace-trust'],
  env: { BERTH_TMUX_SOCKET: `berth-test-vscode-${process.pid}`, TMUX_TMPDIR: root, XDG_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(root, 'config') },
  mocha: { ui: 'tdd', timeout: 30000 },
});
