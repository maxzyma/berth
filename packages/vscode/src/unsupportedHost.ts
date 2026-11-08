import * as vscode from 'vscode';
import { SessionsView, VIEW_ID } from './view/sessionsView.js';

/** Keep the existing view and commands usable without starting a Unix backend. */
export function showUnsupportedHost(context: vscode.ExtensionContext): void {
  const message = 'Berth needs a macOS or Linux execution host. On Windows, open a WSL, Remote-SSH or Dev Container workspace and install Berth there.';
  const explain = async () => {
    const choice = await vscode.window.showInformationMessage(message, 'Remote Setup Guide');
    if (choice) await vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/remote/remote-overview'));
  };
  const view = new SessionsView(context.extensionUri, event => {
    if (event.type === 'new' || event.type === 'newIn' || event.type === 'retry') void explain();
  });
  view.update({ groups: [], unmanaged: [], waiting: 0 });
  view.message = message;
  context.subscriptions.push(view, vscode.window.registerWebviewViewProvider(VIEW_ID, view));
  const contributions = context.extension.packageJSON.contributes;
  for (const entry of contributions.commands ?? []) {
    context.subscriptions.push(vscode.commands.registerCommand(entry.command, explain));
  }
  for (const profile of contributions.terminal?.profiles ?? []) {
    context.subscriptions.push(vscode.window.registerTerminalProfileProvider(profile.id, {
      provideTerminalProfile: async () => { await explain(); return undefined; },
    }));
  }
}
