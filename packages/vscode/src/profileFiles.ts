import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { parse, type ParseError } from 'jsonc-parser';

export interface NativeProfile { id: string; name: string; location: string; useDefaultFlags?: Record<string, boolean> }

/** Read settings as VS Code JSONC without rewriting comments or formatting. */
export async function readProfileSettings(file: string): Promise<Record<string, unknown>> {
  const errors: ParseError[] = [];
  const value: unknown = parse(await readFile(file, 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The Profile settings contain invalid JSONC. Correct the settings before using the Berth layout.');
  }
  return value as Record<string, unknown>;
}

export function localProfileStorage(scheme: string, remoteName?: string): boolean {
  return !remoteName && ['file', 'vscode-userdata'].includes(scheme);
}

/** Read-only adapter for the native desktop profile registry (VS Code 1.143). */
export async function nativeProfiles(userRoot: string): Promise<NativeProfile[]> {
  const state = JSON.parse(await readFile(join(userRoot, 'globalStorage/storage.json'), 'utf8'));
  const profiles: unknown = state.userDataProfiles ?? [];
  if (!Array.isArray(profiles)) throw new Error('Unsupported native Profile registry.');
  return profiles.map((p: NativeProfile) => {
    if (!p || typeof p.name !== 'string' || typeof p.location !== 'string'
      || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(p.location)) {
      throw new Error('Unsupported native Profile location.');
    }
    return { ...p, id: basename(p.location) };
  });
}

export function nativeUserRoot(storage: string): string {
  if (basename(storage).toLowerCase() !== 'berthdev.berth' || basename(dirname(storage)) !== 'globalStorage'
    || basename(dirname(dirname(storage))) !== 'User') throw new Error('Unsupported Profile storage layout.');
  return dirname(dirname(storage));
}

export async function profileDirectory(userRoot: string, profile: NativeProfile): Promise<string> {
  const root = await realpath(join(userRoot, 'profiles'));
  const target = join(root, profile.location);
  if (await realpath(target) !== target || profile.useDefaultFlags?.settings || profile.useDefaultFlags?.extensions) {
    throw new Error('Profile does not have independent settings and extensions.');
  }
  return target;
}

/** Repack the already installed payload, without network or source files. */
export async function installedVsix(extensionRoot: string): Promise<Uint8Array> {
  const root = await realpath(extensionRoot);
  const manifest = await readFile(join(root, '.vsixmanifest'));
  const files: Record<string, Uint8Array> = {
    'extension.vsixmanifest': manifest,
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="mjs" ContentType="application/javascript"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="css" ContentType="text/css"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="ttf" ContentType="application/octet-stream"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="txt" ContentType="text/plain"/></Types>'),
  };
  let bytes = 0;
  const walk = async (relative: string): Promise<void> => {
    const path = resolve(root, relative);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('Installed extension contains an unexpected symbolic link.');
    if (stat.isDirectory()) {
      for (const name of await readdir(path)) await walk(`${relative}/${name}`);
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > 32 * 1024 * 1024) throw new Error('Installed extension payload exceeds the snapshot limit.');
      files[`extension/${relative}`] = await readFile(path);
    }
  };
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.publisher !== 'berthdev' || pkg.name !== 'berth') throw new Error('Unexpected extension identity.');
  const { __metadata: _metadata, ...portable } = pkg;
  files['extension/package.json'] = strToU8(JSON.stringify(portable, null, 2));
  for (const name of ['dist', 'media', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.md']) await walk(name);
  for (const name of ['readme.md', 'changelog.md']) {
    try { await walk(name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return zipSync(files, { level: 6 });
}
