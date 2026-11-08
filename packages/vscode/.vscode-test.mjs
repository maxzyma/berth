// Integration tests in a real VS Code instance (implementation §5.3).
// Opens a VS Code window; run deliberately with `npm run test:vscode`.
import { integrationEnvironment } from './test/integration/environment.mjs';
import { defineConfig } from '@vscode/test-cli';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'berth-test-vscode-'));

export default defineConfig({
  files: 'test/integration/**/*.test.cjs',
  workspaceFolder: root,
  launchArgs: ['--user-data-dir', join(root, 'user'), '--extensions-dir', join(root, 'ext'),
    '--disable-workspace-trust', '--use-inmemory-secretstorage',
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])],
  env: integrationEnvironment(root),
  mocha: { ui: 'tdd', timeout: 30000 },
});
