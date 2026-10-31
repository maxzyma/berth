/**
 * The sessions view (spec §6): a webview drawing session cards. It holds no
 * session logic; it renders the model the controller builds and reports what
 * the user did.
 */
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { TreeView } from '../model.js';
import type { FromView, ToView, ViewSettings } from './protocol.js';

export const VIEW_ID = 'berth.sessions';

/** Settings that change what the view draws (spec §6, *Looking native*). */
const WATCHED = ['workbench.tree.indent', 'workbench.tree.renderIndentGuides', 'berth.hover.delay', 'berth.view.details'];

export class SessionsView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private model?: TreeView;
  private sent = '';
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onMessage: (message: FromView) => void,
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (WATCHED.some((key) => e.affectsConfiguration(key))) this.post({ type: 'settings', settings: this.settings() });
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.sent = '';
    const root = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [root, vscode.Uri.joinPath(this.extensionUri, 'media', 'agents')] };
    view.webview.html = this.html(view.webview, root);
    view.webview.onDidReceiveMessage((message: FromView) => {
      if (message.type === 'ready') {
        this.sent = '';
        this.post({ type: 'settings', settings: this.settings() });
        this.push();
      }
      this.onMessage(message);
    });
    // A view the user hides is disposed; the next one starts over.
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  /** New model from a refresh; sent only when something shown changed. */
  update(model: TreeView): void {
    this.model = model;
    this.push();
  }

  set title(description: string | undefined) {
    if (this.view) this.view.description = description;
  }

  set badge(waiting: number) {
    if (this.view) this.view.badge = waiting ? { value: waiting, tooltip: `${waiting} waiting for you` } : undefined;
  }

  set message(text: string | undefined) {
    // A WebviewView has no message line; the title carries it.
    if (this.view && text) this.view.description = text;
  }

  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
  }

  private push(): void {
    if (!this.model || !this.view) return;
    const only = this.model.groups.length === 1 && this.model.groups[0].place === 'workspace';
    const message: ToView = { type: 'model', model: this.model, flatten: only };
    const text = JSON.stringify(message);
    if (text === this.sent) return;
    this.sent = text;
    this.post(message);
  }

  private post(message: ToView): void {
    void this.view?.webview.postMessage(message);
  }

  private settings(): ViewSettings {
    const config = vscode.workspace.getConfiguration();
    const guides = config.get<string>('workbench.tree.renderIndentGuides', 'onHover');
    return {
      indent: config.get<number>('workbench.tree.indent', 8),
      indentGuides: guides === 'none' || guides === 'always' ? guides : 'onHover',
      hoverDelay: config.get<number>('berth.hover.delay', 500),
      details: config.get<boolean>('berth.view.details', true),
      agentIcons: this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'agents')).toString() ?? '',
    };
  }

  private html(webview: vscode.Webview, root: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const uri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, file)).toString();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri('codicon.css')}">
<link rel="stylesheet" href="${uri('main.css')}">
</head>
<body data-vscode-context='{"preventDefaultContextMenuItems": true}'>
<berth-sessions></berth-sessions>
<script nonce="${nonce}" src="${uri('main.js')}"></script>
</body>
</html>`;
  }
}
