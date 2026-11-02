import { accessSync, constants, realpathSync, statSync } from 'node:fs';

export function usableDirectory(path: string): boolean {
  try { accessSync(path, constants.X_OK); return statSync(path).isDirectory(); }
  catch { return false; }
}
export function sameDirectory(left: string, right: string): boolean {
  try { return realpathSync(left) === realpathSync(right); }
  catch { return false; }
}
