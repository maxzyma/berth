/** Native fallback assets are cached locally; reviewed bundled product marks take precedence. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';

const run = promisify(execFile);
const HOSTS: ReadonlyArray<{ names: string[]; bundle: string }> = [
  { names: ['iTerm2'], bundle: 'com.googlecode.iterm2' },
  { names: ['Terminal'], bundle: 'com.apple.Terminal' },
  { names: ['Cursor'], bundle: 'com.todesktop.230313mzl4w4u92' },
  { names: ['WezTerm'], bundle: 'com.github.wez.wezterm' },
  { names: ['Ghostty'], bundle: 'com.mitchellh.ghostty' },
];
async function output(command: string, args: string[]): Promise<string> {
  return (await run(command, args, { timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 })).stdout.trim();
}
async function appIcon(bundle: string, directory: string): Promise<string | undefined> {
  try {
    const matches = await output('/usr/bin/mdfind', ['-0', `kMDItemCFBundleIdentifier == '${bundle}'`]);
    for (const app of matches.split('\0').filter(path => isAbsolute(path) && path.endsWith('.app'))) {
      const plist = join(app, 'Contents', 'Info.plist');
      try {
        if (await output('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist]) !== bundle) continue;
        const name = await output('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist]);
        if (!name || basename(name) !== name || name === '..') continue;
        const source = join(app, 'Contents', 'Resources', name.endsWith('.icns') ? name : `${name}.icns`);
        const info = await stat(source);
        if (!info.isFile()) continue;
        const key = createHash('sha256').update(`${bundle}:${source}:${info.size}:${info.mtimeMs}`).digest('hex').slice(0, 24);
        const file = `${key}.png`, target = join(directory, file);
        try { await access(target); return file; } catch { /* Populate the cache atomically. */ }
        const temporary = join(directory, `${key}-${randomUUID()}.png`);
        try {
          await output('/usr/bin/sips', ['-s', 'format', 'png', '-z', '32', '32', source, '--out', temporary]);
          await rename(temporary, target);
          return file;
        } finally { await rm(temporary, { force: true }); }
      } catch { /* Try another installation, otherwise retain the generic glyph. */ }
    }
  } catch { /* Missing platform tools or artwork never block the session list. */ }
  return undefined;
}
export async function resolveHostIcons(storage: string, platform = process.platform): Promise<Record<string, string>> {
  if (platform !== 'darwin') return {};
  const directory = join(storage, 'host-icons');
  try { await mkdir(directory, { recursive: true }); } catch { return {}; }
  let entries: [string, string][] = [];
  for (const host of HOSTS) {
    const file = await appIcon(host.bundle, directory);
    if (file) entries = [...entries, ...host.names.map(name => [name, file] as [string, string])];
  }
  return Object.fromEntries(entries);
}
