// Builds the sessions view (spec §6) into dist/webview: the bundled script,
// its styles, and VS Code's codicon font, which the packaged extension must
// carry because node_modules is not shipped.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const out = 'dist/webview';
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ['webview/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile: join(out, 'main.js'),
  tsconfig: 'tsconfig.webview.json',
});
copyFileSync('webview/main.css', join(out, 'main.css'));
const codicons = dirname(createRequire(import.meta.url).resolve('@vscode/codicons/dist/codicon.css'));
for (const file of ['codicon.css', 'codicon.ttf']) copyFileSync(join(codicons, file), join(out, file));
