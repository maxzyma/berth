/** Explicit test discovery works on the declared Node 20 baseline. */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--live')) {
  throw new Error('Usage: node scripts/test.mjs [--live]');
}
const live = args[0] === '--live';
const directories = live ? ['packages/core/dist/test/live']
  : ['packages/core/dist/test', 'packages/vscode/dist-test/test'];

function tests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return tests(file);
    return entry.isFile() && entry.name.endsWith('.test.js') ? [file] : [];
  });
}

const files = directories.flatMap((directory) => tests(join(root, directory))).sort();
if (files.length === 0) throw new Error('No compiled tests found. Run npm run build first.');
const result = spawnSync(process.execPath, ['--test', ...(live ? [] : ['--test-concurrency=1']), ...files], {
  cwd: root, stdio: 'inherit', env: live ? { ...process.env, BERTH_LIVE: '1' } : process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
