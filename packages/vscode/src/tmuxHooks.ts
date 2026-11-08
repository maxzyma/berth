import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { inspectTmuxHooks, type DependencyCheck } from '@berthdev/berth';
import { prepareHookRuntime } from './hookRuntime.js';

const run = promisify(execFile);

/** tmux hooks that run this extension's Berth-owned runtime, so upgrades reach them (spec §8). */
export class TmuxHooks {
  constructor(private readonly context: vscode.ExtensionContext, private readonly env: NodeJS.ProcessEnv) {}

  private runtime(): string {
    return prepareHookRuntime(this.context.asAbsolutePath('dist/cli.mjs'), this.context.globalStorageUri.fsPath);
  }

  inspect() {
    return inspectTmuxHooks(this.runtime(), this.env, { executable: process.execPath, electron: true });
  }

  /** Diagnose Problems row; optional because sessions work without tmux hooks. */
  check(): DependencyCheck {
    const base = { id: 'tmux-hooks', label: 'tmux hooks', required: false };
    try {
      const found = this.inspect();
      const detail = {
        current: 'Installed; they run this extension\'s Berth.',
        missing: 'Not installed. Sessions created, renamed or closed outside Berth are snapshotted only on Berth\'s next change. Select to install.',
        broken: 'Installed, but they point to a removed Berth installation and run nothing. Select to update.',
        other: `Installed for another Berth installation (${found.target}). Select to use this extension's Berth.`,
      }[found.state];
      return { ...base, ok: found.state === 'current', detail };
    } catch (error) {
      return { ...base, ok: false, detail: `Could not read the tmux configuration: ${(error as Error).message}` };
    }
  }

  async install(): Promise<void> {
    try {
      await run(process.execPath, [this.runtime(), 'tmux', 'install'], {
        env: { ...this.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
        timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      const failure = error as Error & { stderr?: string };
      throw new Error(`Berth could not update tmux hooks: ${failure.stderr?.trim() || failure.message}`);
    }
  }

  /** On activation: repair a block that runs nothing. Other states are offered by the setup reminder. */
  async maintain(): Promise<ReturnType<typeof inspectTmuxHooks>> {
    const found = this.inspect();
    if (found.state !== 'broken') return found;
    await this.install();
    void vscode.window.showInformationMessage('Berth updated its tmux hooks; they pointed to a removed Berth installation.');
    return { ...found, state: 'current' };
  }

  /** Remembered-answer key for an inspected block. */
  static key(found: ReturnType<typeof inspectTmuxHooks>): string {
    return found.state === 'other' && found.block ? `other:${createHash('sha256').update(found.block).digest('hex')}` : found.state;
  }
}
