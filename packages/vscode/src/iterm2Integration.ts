import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { inspectIterm2 } from '@berthdev/berth';
import { prepareHookRuntime } from './hookRuntime.js';

const run = promisify(execFile);

/** The optional iTerm2 AutoLaunch script, kept on this extension's Berth runtime (spec §7.5). */
export class Iterm2Integration {
  constructor(private readonly context: vscode.ExtensionContext, private readonly env: NodeJS.ProcessEnv) {}

  private runtime(): string {
    return prepareHookRuntime(this.context.asAbsolutePath('dist/cli.mjs'), this.context.globalStorageUri.fsPath);
  }

  inspect(): ReturnType<typeof inspectIterm2> {
    return process.platform === 'darwin' ? inspectIterm2(this.runtime(), this.env) : { state: 'missing' };
  }

  async install(): Promise<void> {
    try {
      await run(process.execPath, [this.runtime(), 'iterm2', 'install'], {
        env: { ...this.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
        timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      const failure = error as Error & { stderr?: string };
      throw new Error(`Berth could not update its iTerm2 integration: ${failure.stderr?.trim() || failure.message}`);
    }
  }

  /** Remembered-answer key: a decline holds until the script points somewhere else. */
  static key(found: ReturnType<typeof inspectIterm2>): string {
    return found.target ? `${found.state}:${createHash('sha256').update(found.target).digest('hex')}` : found.state;
  }
}
