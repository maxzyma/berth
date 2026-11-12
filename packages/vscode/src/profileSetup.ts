import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { withAsyncLock } from '@berthdev/berth';
import { layoutChanges, staleProgressDescription, tabDescriptionKey, withoutProgressDescription } from './layoutSettings.js';
import { missingTerminalPersistence } from './terminalPersistence.js';
import { installedVsix, localProfileStorage, nativeProfiles, nativeUserRoot, profileDirectory, readProfileSettings } from './profileFiles.js';
import { cliEnvironment, savePreparation, type Preparation } from './profileBootstrap.js';

interface Setup extends Preparation { started: number }

async function readSetup(file: string): Promise<Setup | undefined> {
  try {
    const state: Setup = JSON.parse(await readFile(file, 'utf8'));
    if (state.schema !== 1 || typeof state.token !== 'string' || typeof state.name !== 'string') {
      throw new Error('Berth layout preparation record is invalid.');
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Prepare before the native reload; the detached worker completes afterward. */
export async function usePreparedLayout(context: vscode.ExtensionContext): Promise<void> {
  if (!localProfileStorage(context.globalStorageUri.scheme, vscode.env.remoteName)) {
    throw new Error('Automatic Berth layout setup currently requires a local desktop window. Your layout was not changed.');
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  const target = vscode.workspace.workspaceFile ?? (folders.length === 1 ? folders[0].uri : undefined);
  if (!target) throw new Error('Open a folder or workspace before enabling the Berth layout.');
  const root = context.globalStorageUri.fsPath;
  const file = join(root, 'profile-preparation.json');
  const userRoot = nativeUserRoot(root);
  const commands = await vscode.commands.getCommands(false);
  if (!commands.includes('vscode.openFolder') || !commands.includes('_files.newWindow') || !commands.includes('workbench.profiles.actions.profileEntry.__default__profile__')) {
    throw new Error('This editor does not support automatic Berth Profile setup. Your layout was not changed.');
  }
  const cli = join(vscode.env.appRoot, 'out/cli.js');
  await access(cli);
  await mkdir(root, { recursive: true });
  const name = await withAsyncLock(join(root, 'profile-setup-lock'), async () => {
    const profiles = await nativeProfiles(userRoot);
    const previous = await readSetup(file);
    const owned = previous?.id ? profiles.find(p => p.id === previous.id) : undefined;
    if (owned && previous?.status === 'ready') {
      const settings = await readProfileSettings(join(await profileDirectory(userRoot, owned), 'settings.json'));
      if (settings['berth.layout.managedProfile'] !== previous.token) throw new Error('The prepared Profile identity changed. Its settings were left unchanged.');
      if (vscode.workspace.getConfiguration('berth').inspect<string>('layout.managedProfile')?.globalValue === previous.token) return undefined;
      return owned.name;
    }
    if (previous && ['waiting', 'installing'].includes(previous.status) && Date.now() - previous.started < 180000) {
      return owned?.name ?? previous.name;
    }
    const retry = previous && previous.status === 'failed' && (owned || !profiles.some(p => p.name === previous.name));
    let name = retry ? owned?.name ?? previous.name : 'Berth';
    if (!retry) for (let i = 2; profiles.some(p => p.name === name); i++) name = `Berth (${i})`;
    if (!owned && commands.includes(`workbench.action.openProfile.${name}`)) {
      throw new Error('The native Profile registry is still updating. Retry Use Berth Layout.');
    }
    const archive = join(root, 'profile-payload.vsix');
    await writeFile(archive, await installedVsix(context.extensionUri.fsPath), { mode: 0o600 });
    const worker = join(root, 'profile-bootstrap.cjs');
    await copyFile(context.asAbsolutePath('dist/profile-bootstrap.cjs'), worker);
    const state: Setup = {
      schema: 1, token: retry ? previous.token : randomUUID(), name,
      id: retry ? previous.id : undefined, status: 'waiting', started: Date.now(),
      userRoot, cli, executable: process.execPath, workspace: target.toString(),
      extensionsRoot: dirname(context.extensionUri.fsPath), archive,
      settings: retry ? withoutProgressDescription(previous.settings) : Object.fromEntries(layoutChanges(() => undefined,
        vscode.workspace.getConfiguration('berth').get<boolean>('layout.hideTerminalTabs', false)).map(x => [x.key, x.value])),
    };
    await savePreparation(file, state);
    try {
      const child = spawn(process.execPath, [worker, '--bootstrap', file], {
        detached: true, stdio: 'ignore', env: cliEnvironment(process.env),
      });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    } catch (error) {
      await savePreparation(file, { ...state, status: 'failed', error: (error as Error).message });
      throw error;
    }
    return name;
  });
  if (!name) return;
  const state = await readSetup(file);
  if (state?.id && commands.includes(`workbench.profiles.actions.profileEntry.${state.id}`)) {
    await vscode.commands.executeCommand(`workbench.profiles.actions.profileEntry.${state.id}`);
  } else {
    await vscode.commands.executeCommand('_files.newWindow', { forceReuseWindow: true, forceProfile: name });
  }
}

/** Reveal the newly prepared layout only in its destination Profile. */
export async function finishPreparedLayout(context: vscode.ExtensionContext): Promise<void> {
  const token = vscode.workspace.getConfiguration('berth').inspect<string>('layout.managedProfile')?.globalValue;
  if (!token || vscode.env.remoteName) return;
  const file = join(context.globalStorageUri.fsPath, 'profile-preparation.json');
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const state = await readSetup(file);
    if (!state || state.token !== token) return;
    await writeFile(`${file}.observed`, token, { mode: 0o600 });
    if (state.status === 'failed') throw new Error(state.error ?? 'Berth Profile setup failed. Choose Use Berth Layout to retry.');
    if (state.status === 'ready') {
      if (context.globalState.get('berth.terminalPersistenceMigrated') !== token) {
        const config = vscode.workspace.getConfiguration();
        for (const { key, value } of missingTerminalPersistence(key => config.inspect(key))) {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
        }
        await context.globalState.update('berth.terminalPersistenceMigrated', token);
      }
      if (context.globalState.get('berth.progressDescriptionRemoved') !== token) {
        const config = vscode.workspace.getConfiguration();
        if (staleProgressDescription(state.settings, config.inspect(tabDescriptionKey)?.globalValue)) {
          await config.update(tabDescriptionKey, undefined, vscode.ConfigurationTarget.Global);
        }
        await context.globalState.update('berth.progressDescriptionRemoved', token);
      }
      if (context.globalState.get('berth.profileRevealed') === token) return;
      const current = vscode.workspace.workspaceFile ?? vscode.workspace.workspaceFolders?.[0]?.uri;
      if (state.workspace && current?.toString() !== state.workspace) {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(state.workspace), { forceReuseWindow: true, forceProfile: state.name });
        return;
      }
      await vscode.commands.executeCommand('workbench.view.extension.berth');
      await context.globalState.update('berth.profileRevealed', token);
      return;
    }
    await delay(250);
  }
  throw new Error('Berth Profile setup has not finished. Choose Use Berth Layout to retry.');
}
