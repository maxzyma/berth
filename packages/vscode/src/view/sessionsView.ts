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
  private error = '';
  private hostIcons: Record<string, string> = {};
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onMessage: (message: FromView) => void,
    private readonly hostIconRoot?: vscode.Uri,
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
    view.webview.options = { enableScripts: true, localResourceRoots: [root, vscode.Uri.joinPath(this.extensionUri, 'media', 'agents'), vscode.Uri.joinPath(this.extensionUri, 'media', 'hosts'), ...(this.hostIconRoot ? [this.hostIconRoot] : [])] };
    view.webview.html = this.html(view.webview, root);
    view.webview.onDidReceiveMessage((message: FromView) => {
      if (message.type === 'copy') {
        if (!Number.isSafeInteger(message.id) || typeof message.value !== 'string') return;
        void vscode.env.clipboard.writeText(message.value).then(
          () => this.post({ type: 'copyResult', id: message.id, success: true }),
          () => this.post({ type: 'copyResult', id: message.id, success: false }),
        );
        return;
      }
      if (message.type === 'ready') {
        this.sent = '';
        this.post({ type: 'settings', settings: this.settings() });
        this.push();
        this.post({ type: 'error', message: this.error });
      }
      this.onMessage(message);
    });
    view.onDidChangeVisibility(() => { if (!view.visible) this.dismissDetails(); });
    // A view the user hides is disposed; the next one starts over.
    view.onDidDispose(() => {
      this.onMessage({ type: 'detailsVisibility', visible: false });
      this.view = undefined;
    });
  }

  dismissDetails(): void {
    this.post({ type: 'dismissDetails' });
    this.onMessage({ type: 'detailsVisibility', visible: false });
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
    this.error = text ?? '';
    this.post({ type: 'error', message: this.error });
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

  setHostIcons(files: Record<string, string>): void {
    this.hostIcons = files;
    this.post({ type: 'settings', settings: this.settings() });
  }

  private settings(): ViewSettings {
    const config = vscode.workspace.getConfiguration();
    const guides = config.get<string>('workbench.tree.renderIndentGuides', 'onHover');
    return {
      indent: config.get<number>('workbench.tree.indent', 8),
      indentGuides: guides === 'none' || guides === 'always' ? guides : 'onHover',
      hoverDelay: config.get<number>('berth.hover.delay', 500),
      details: config.get<boolean>('berth.view.details', true),
      hostIcons: {
        ...(this.view && this.hostIconRoot ? Object.fromEntries(Object.entries(this.hostIcons).map(([name, file]) => [name, this.view!.webview.asWebviewUri(vscode.Uri.joinPath(this.hostIconRoot!, file)).toString()])) : {}),
        ...Object.fromEntries(['VS Code', 'Visual Studio Code'].map(name => [name,
          this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hosts', 'vscode.svg')).toString() ?? '',
        ])),
      },
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
