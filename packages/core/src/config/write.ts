import { randomUUID } from 'node:crypto';
import { accessSync, chmodSync, constants, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Publish a whole configuration file; failures before rename leave the old file intact. */
export function writeConfigFile(file: string, text: string): void {
  let target = file;
  let mode = 0o600;
  try {
    const entry = lstatSync(file);
    target = entry.isSymbolicLink() ? realpathSync(file) : file;
    const current = statSync(target);
    if (!current.isFile()) throw new Error('Hook configuration target is not a regular file.');
    accessSync(target, constants.W_OK);
    mode = current.mode & 0o777;
  } catch (error) {
    // A dangling symlink is an existing entry, not a new configuration path.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try { lstatSync(file); throw new Error('Hook configuration symlink target is missing.'); }
    catch (entryError) { if ((entryError as NodeJS.ErrnoException).code !== 'ENOENT') throw entryError; }
  }
  mkdirSync(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    chmodSync(temporary, mode);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
