import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** test-electron merges with process.env: explicit undefined removes inherited keys. */
export function integrationEnvironment(root, inherited = process.env) {
  const cleared = Object.fromEntries(Object.keys(inherited).map((key) => [key, undefined]));
  const retained = Object.fromEntries(['PATH', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
    'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'SystemRoot', 'WINDIR']
    .filter((key) => inherited[key] !== undefined).map((key) => [key, inherited[key]]));
  const paths = {
    HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'),
    XDG_STATE_HOME: join(root, 'state'), XDG_DATA_HOME: join(root, 'data'),
    XDG_CACHE_HOME: join(root, 'cache'),
  };
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true });
  return { ...cleared, ...retained, ...paths, SHELL: '/bin/sh',
    // A short directory: macOS limits a tmux socket path to 104 bytes.
    BERTH_TMUX_SOCKET: `berth-test-vscode-${process.pid}`, TMUX_TMPDIR: mkdtempSync(join(tmpdir(), 'bt-')),
    BERTH_CONFIG: join(paths.XDG_CONFIG_HOME, 'berth', 'config.toml'),
    BERTH_STATE_DIR: join(paths.XDG_STATE_HOME, 'berth'),
  };
}
