import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { dependencyInstall, type EnvironmentOptions, type EnvironmentReport, type DependencyCheck } from '@berthdev/berth';
import { EnvironmentNotReady, sampleEnvironment } from './inventory.js';
import { prepareHookRuntime } from './hookRuntime.js';
import type { TmuxHooks } from './tmuxHooks.js';

/** Native presentation of the core's host-local dependency report. */
export class EnvironmentSetup {
  private installing = false;
  constructor(private readonly context: vscode.ExtensionContext, private readonly env: NodeJS.ProcessEnv,
    private readonly changed: (ready: boolean) => void, private readonly sessionDetails: () => Promise<void>,
    private readonly tmuxHooks?: TmuxHooks) {}

  async check(options: EnvironmentOptions = {}): Promise<EnvironmentReport> {
    const cli = this.context.asAbsolutePath('dist/cli.mjs');
    const report = await sampleEnvironment(cli, this.env, options);
    try { prepareHookRuntime(cli, this.context.globalStorageUri.fsPath); }
    catch (error) {
      return { ready: false, checks: [...report.checks, { id: 'hook-runtime', label: 'Berth hook runtime',
        required: true, ok: false, detail: `Could not repair Berth's runtime files: ${(error as Error).message}` }] };
    }
    return this.tmuxHooks && !options.externalNode ? { ...report, checks: [...report.checks, this.tmuxHooks.check()] } : report;
  }

  async startup(): Promise<void> {
    try {
      const report = await this.check();
      this.changed(report.ready);
      if (report.ready) return;
      const missing = report.checks.filter(c => c.required && !c.ok).map(c => c.label).join(', ');
      const choice = await vscode.window.showWarningMessage(`Berth needs setup on ${this.host()}: ${missing}.`, 'Review Setup');
      if (choice) await this.review();
    } catch (error) {
      this.changed(false);
      void vscode.window.showErrorMessage(`Berth could not check its environment: ${(error as Error).message}`);
    }
  }

  /**
   * Create a session whose launcher the core inspects in the same process.
   * Only when that inspection fails does setup review run, then creation retries once.
   */
  async createWhenReady(options: EnvironmentOptions, create: () => Promise<unknown>): Promise<boolean> {
    if (!this.runtimeReady()) {
      if (!await this.ensure(options)) return false;
    }
    try {
      await create();
    } catch (error) {
      if (!(error instanceof EnvironmentNotReady)) throw error;
      if (!await this.ensure(options)) return false;
      await create();
    }
    this.changed(true);
    return true;
  }

  private runtimeReady(): boolean {
    try {
      prepareHookRuntime(this.context.asAbsolutePath('dist/cli.mjs'), this.context.globalStorageUri.fsPath);
      return true;
    } catch {
      return false;
    }
  }

  async ensure(options: EnvironmentOptions): Promise<boolean> {
    const report = await this.check(options);
    if (report.ready) { this.changed(true); return true; }
    await this.review(options);
    const ready = (await this.check(options)).ready;
    if (ready) this.changed(true);
    return ready;
  }

  async review(options: EnvironmentOptions = {}): Promise<void> {
    try {
      const report = await this.check(options);
      if (!options.externalNode && !options.agent && !options.launcher) this.changed(report.ready);
      const checks = [...report.checks].sort((a, b) => Number(a.ok) - Number(b.ok));
      const choice = await vscode.window.showQuickPick([
        ...checks.map(check => ({ label: `${check.ok ? '$(check)' : check.required ? '$(warning)' : '$(info)'} ${check.label}`,
          detail: check.detail, check, action: '' })),
        ...(!options.externalNode ? [{ label: 'Check standalone CLI dependencies…', detail: 'Node.js and npm on this host PATH; optional for the VS Code extension.', action: 'external', check: undefined }] : []),
        { label: 'Session and hook diagnostics…', detail: 'Inspect existing agents, hooks and conversation recovery.', action: 'sessions', check: undefined },
      ], { title: `Berth Setup — ${this.host()}`, matchOnDetail: true, placeHolder: 'Select a failed check to review its repair' });
      if (choice?.action === 'external') return this.review({ ...options, externalNode: true });
      if (choice?.action === 'sessions') return this.sessionDetails();
      if (choice?.check && !choice.check.ok) await this.repair(choice.check, options);
    } catch (error) { void vscode.window.showErrorMessage(`Berth setup: ${(error as Error).message}`); }
  }

  private host(): string { return vscode.env.remoteName ? `remote host (${vscode.env.remoteName})` : 'this computer'; }

  private async repair(check: DependencyCheck, options: EnvironmentOptions): Promise<void> {
    if (check.id === 'tmux-hooks' && this.tmuxHooks) {
      await this.tmuxHooks.install();
      void vscode.window.showInformationMessage('Berth tmux hooks now run this extension\'s Berth.');
      return;
    }
    if (!check.repair || !vscode.workspace.isTrusted) {
      void vscode.window.showInformationMessage(check.detail);
      return;
    }
    const plan = dependencyInstall(check.repair, this.env);
    if (!plan) {
      const choice = await vscode.window.showInformationMessage(`${check.detail} No supported package manager is available on ${this.host()}.`, 'Installation Instructions');
      if (choice) await vscode.env.openExternal(vscode.Uri.parse(check.repair === 'node'
        ? 'https://nodejs.org/en/download' : 'https://github.com/tmux/tmux/wiki/Installing'));
      return;
    }
    if (this.installing || vscode.tasks.taskExecutions.some(e => e.task.definition.type === 'berth-dependency')) { void vscode.window.showInformationMessage('A Berth dependency installation is already running.'); return; }
    const choice = await vscode.window.showInformationMessage(`Install on ${this.host()}?`, {
      modal: true, detail: `${plan.display}\nUses your existing package manager and may request administrator access. Berth will recheck the dependency afterward.`,
    }, 'Install');
    if (choice !== 'Install' || this.installing) return;
    this.installing = true;
    try {
      const taskEnv = Object.fromEntries(Object.entries(this.env).filter(([k, v]) => typeof v === 'string'
        && k !== 'ELECTRON_RUN_AS_NODE' && !k.startsWith('VSCODE_'))) as Record<string, string>;
      const task = new vscode.Task({ type: 'berth-dependency', dependency: check.repair, setupToken: randomUUID() },
        vscode.TaskScope.Workspace, `Install ${check.repair}`, 'Berth',
        new vscode.ProcessExecution(plan.executable, plan.args, { env: taskEnv }));
      task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
      await this.runTask(task);
      const fresh = await this.check(options);
      if (!options.externalNode && !options.agent && !options.launcher) this.changed(fresh.ready);
      const repaired = fresh.checks.find(c => c.id === check.id);
      if (repaired?.ok) void vscode.window.showInformationMessage(`Berth: ${check.label} is ready.`);
      else void vscode.window.showWarningMessage(`Installation finished, but ${repaired?.detail ?? check.detail} Check the task output and this host's PATH.`);
    } finally { this.installing = false; }
  }

  private async runTask(task: vscode.Task): Promise<void> {
    // Subscribe before execution so a fast task cannot finish before its listener exists.
    await new Promise<void>((resolve, reject) => {
      const listener = vscode.tasks.onDidEndTask(event => {
        if (event.execution.task.definition.setupToken !== task.definition.setupToken) return;
        listener.dispose();
        resolve(); // A fresh dependency check, not the exit code, determines success.
      });
      this.context.subscriptions.push(listener);
      void Promise.resolve(vscode.tasks.executeTask(task)).catch(error => { listener.dispose(); reject(error); });
    });
  }
}
