import { readFile, writeFile, rename, open, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { withAsyncLock } from '@berthdev/berth';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeProfiles, profileDirectory, readProfileSettings } from './profileFiles.js';

export interface Preparation {
  schema: 1;
  token: string;
  name: string;
  id?: string;
  status: 'waiting' | 'installing' | 'ready' | 'failed';
  error?: string;
  userRoot: string;
  cli: string;
  executable: string;
  extensionsRoot: string;
  archive: string;
  workspace?: string;
  settings: Record<string, unknown>;
}

export async function savePreparation(file: string, state: Preparation): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temp, file);
}

export function cliEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('VSCODE_'))), ELECTRON_RUN_AS_NODE: '1' };
}

/** Continues after the source extension host is stopped by Profile switching. */
async function installPayload(state: Preparation): Promise<void> {
  await promisify(execFile)(state.executable, [state.cli, '--user-data-dir', join(state.userRoot, '..'),
    '--extensions-dir', state.extensionsRoot, '--profile', state.name, '--install-extension', state.archive, '--force'],
  { env: cliEnvironment(process.env), timeout: 90000, maxBuffer: 1024 * 1024 });
}

async function confirmSettings(file: string, settingsFile: string, token: string): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if (await readFile(`${file}.observed`, 'utf8') === token) return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const now = new Date();
    await utimes(settingsFile, now, now);
    await delay(500);
  }
  throw new Error('The destination window did not load its prepared settings.');
}

export async function bootstrap(file: string, install = installPayload, confirm = confirmSettings): Promise<void> {
  await withAsyncLock(join(dirname(file), 'profile-setup-lock'), () => prepare(file, install, confirm), 180000);
}

async function prepare(file: string, install: (state: Preparation) => Promise<void>,
  confirm: (file: string, settingsFile: string, token: string) => Promise<void>): Promise<void> {
  let state: Preparation = JSON.parse(await readFile(file, 'utf8'));
  try {
    const deadline = Date.now() + 60000;
    let profile;
    while (Date.now() < deadline) {
      const profiles = await nativeProfiles(state.userRoot);
      profile = state.id ? profiles.find(p => p.id === state.id) : profiles.find(p => p.name === state.name);
      if (profile) break;
      await delay(250);
    }
    if (!profile) throw new Error('Profile creation was cancelled or did not finish. Choose Use Berth Layout to retry.');
    const directory = await profileDirectory(state.userRoot, profile);
    const settingsFile = join(directory, 'settings.json');
    const settings = { ...state.settings, 'berth.layout.managedProfile': state.token };
    try {
      const handle = await open(settingsFile, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(settings, null, 2)); } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = await readProfileSettings(settingsFile);
      if (current['berth.layout.managedProfile'] !== state.token) {
        throw new Error('The destination Profile already has settings. They were left unchanged.');
      }
    }
    state = { ...state, id: profile.id, name: profile.name, status: 'installing', error: undefined };
    await savePreparation(file, state);
    await install(state);
    await confirm(file, settingsFile, state.token);
    await savePreparation(file, { ...state, status: 'ready' });
  } catch (error) {
    await savePreparation(file, { ...state, status: 'failed', error: (error as Error).message });
    throw error;
  }
}

if (process.argv[2] === '--bootstrap' && process.argv[3]) {
  void bootstrap(process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
