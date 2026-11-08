import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildTree } from '../../dist-test/src/model.js';

const palette = {
  dark: ['#181818', '#cccccc', '#202020', '#454545', '#9d9d9d', '#37373d', '#0000005c'],
  light: ['#f8f8f8', '#333333', '#f3f3f3', '#c8c8c8', '#616161', '#e4e6f1', '#00000040'],
  hclight: ['#ffffff', '#000000', '#ffffff', '#0f4a85', '#292929', '#d9e8ff', '#000000'],
  hc: ['#000000', '#ffffff', '#0c141f', '#6fc3df', '#ffffff', '#000000', '#000000'],
};
const base = { profile: { environment: { HOME: '/workspace/home' } }, managed: true, agent: 'codex', cwd: '/workspace/product', conversation: 'fixture', origin: 'vscode', state: '', note: '', topic: 'Review changes before merging', attachedClients: 1, live: true, hooks: 'installed' };
const rows = Array.from({ length: 14 }, (_, i) => ({ ...base, name: `${String(i + 1).padStart(2, '0')}-session`, ...(i === 3 ? { state: 'waiting', note: 'Allow the export command to write the report?' } : {}) }));
const model = buildTree(rows, { here: new Set(['03-session']), unread: new Set(), workspaceFolders: ['/workspace/product'], branch: () => 'feature/session-preview' });

const variants = Object.fromEntries(Object.entries({
  working: { state: 'working' },
  waiting: { state: 'waiting', note: 'Allow the export command to write the report?' },
  unread: { state: 'done', note: 'Export complete.' },
  stopped: { live: false },
  legacyOptions: { live: false, recoveryOptionsRequired: true },
  unknownProfile: { live: false, profile: undefined, hooks: 'unknown' },
  unboundLive: { conversation: '', profile: undefined, bindingIssue: 'Agent producer changed. Verify the conversation before restoring.' },
  missing: { hooks: 'missing', conversation: '' },
  broken: { hooks: 'broken' },
  codexTrust: { hookSetup: 'Codex manages hook trust in /hooks. Review new or changed Berth hooks there before they can run.' },
  shell: { profile: undefined, agent: 'shell', hooks: 'none', conversation: '', topic: '' },
  literal: { topic: '<img src=x onerror=alert(1)> 中文 & text', note: '' },
}).map(([name, change]) => [name, buildTree([{ ...base, name: '03-session', ...change }], {
  here: new Set(), unread: new Set(name === 'unread' ? ['03-session'] : []), workspaceFolders: ['/workspace/product'], branch: () => '',
})]));

const activeShellFixture = buildTree([
  { ...base, name: 'new-shell', managed: false, agent: '', topic: '', attachedClients: 1,
    connections: [{ pid: 101, ancestors: [101], terminal: 'tty', application: 'VS Code' }] },
], { here: new Set(), unread: new Set(), terminalPids: new Set([101]), activeTerminalPid: 101, branch: () => '' });

const iconFixture = buildTree([
  ...['claude', 'codex', 'gemini', 'cursor', 'copilot', 'kimi', 'opencode', 'qoder', 'shell', 'custom-agent'].map(agent => ({
    ...base, name: agent, agent, topic: '', hooks: 'none',
  })),
  { ...base, name: 'unmanaged', managed: false, agent: '', topic: '' },
], { here: new Set(), unread: new Set(), workspaceFolders: ['/workspace/product'], branch: () => '' });

const orderedSessions = ['job-13', 'job-2', 'job-3'].map((name, index) => ({ ...base, name, live: index !== 0 }));
const orderFixture = [orderedSessions, [...orderedSessions].reverse().map(row => ({ ...row, live: true }))].map(rows => buildTree(rows, {
  here: new Set(), unread: new Set(), workspaceFolders: ['/workspace/product'], branch: () => '',
}));

const identityFixture = buildTree([
  { ...base, name: 'job-2', conversationTitle: 'Repair saved search', conversation: '11111111-2222-3333-4444-555555555555', connections: [
    { pid: 30, ancestors: [30, 20], terminal: '/dev/ttys001', application: 'VS Code' },
    { pid: 50, ancestors: [50, 40], terminal: '/dev/ttys002', application: 'iTerm2' },
  ], attachedClients: 2 },
  { ...base, name: 'job-3', connections: [], attachedClients: 0, state: 'working' },
  { ...base, name: 'job-13', connections: [{ pid: 50, ancestors: [50, 40], terminal: '/dev/ttys002', application: 'iTerm2' }] },
], { here: new Set(), terminalPids: new Set([20]), unread: new Set(), workspaceFolders: ['/workspace/product'], branch: () => '' });

function documentHtml(theme) {
  const [background, foreground, hover, border, muted, selected, shadow] = palette[theme] ?? palette.dark;
  const colors = {
    'button-background': '#0e639c', 'button-foreground': '#ffffff', 'button-hoverBackground': '#1177bb',
    'sideBar-background': background, 'sideBar-foreground': foreground, foreground,
    'list-hoverBackground': selected, 'list-activeSelectionBackground': '#04395e',
    'list-activeSelectionForeground': '#ffffff', 'list-inactiveSelectionBackground': selected,
    'list-focusOutline': '#0078d4', focusBorder: '#0078d4', 'list-warningForeground': (theme === 'light' || theme === 'hclight') ? '#855f00' : '#cca700',
    'charts-blue': '#3794ff', descriptionForeground: muted, disabledForeground: muted,
    'editorHoverWidget-background': hover, 'editorHoverWidget-foreground': foreground,
    'editorHoverWidget-border': border, 'widget-shadow': shadow, 'tree-indentGuidesStroke': border,
    'textBlockQuote-background': background, 'textBlockQuote-border': border, 'toolbar-hoverBackground': selected,
    'font-family': 'system-ui,sans-serif', 'font-size': '13px', 'editor-font-family': 'monospace',
  };
  const style = Object.entries(colors).map(([key, value]) => `--vscode-${key}:${value}`).join(';');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/assets/codicon.css">
<link rel="stylesheet" href="/assets/main.css">
<style>html{${style}}body{background:var(--vscode-sideBar-background)}</style>
</head>
<body data-vscode-context='{"preventDefaultContextMenuItems":true}' class="${theme === 'hc' ? 'vscode-high-contrast' : theme === 'hclight' ? 'vscode-high-contrast-light' : `vscode-${theme}`} vscode-reduce-motion">
<script>
    let saved; window.messages=[]; window.fixture=${JSON.stringify(model)}; window.variants=${JSON.stringify(variants)}; window.iconFixture=${JSON.stringify(iconFixture)}; window.orderFixture=${JSON.stringify(orderFixture)}; window.identityFixture=${JSON.stringify(identityFixture)}; window.activeShellFixture=${JSON.stringify(activeShellFixture)};
    window.sendModel=(model=fixture,flatten=true)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,flatten}}));
    window.acquireVsCodeApi=()=>({postMessage(m){messages.push(m);if(m.type==='copy'&&!window.deferCopy)queueMicrotask(()=>{window.dispatchEvent(new MessageEvent('message',{data:{type:'copyResult',id:m.id,success:!window.copyFailure}}));});if(m.type==='ready')queueMicrotask(()=>{window.dispatchEvent(new MessageEvent('message',{data:{type:'settings',settings:{indent:8,indentGuides:'always',hoverDelay:80,details:true,agentIcons:'/agents'}}}));sendModel();});},getState(){return saved},setState(s){saved=s}});
    
</script>
<berth-sessions></berth-sessions><script src="/assets/main.js">
</script>
</body>
</html>`;
}

export async function serveFixture() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/frame') {
        const width = Math.max(140, Math.min(800, Number(url.searchParams.get('width')) || 300));
        const height = Math.max(180, Math.min(1000, Number(url.searchParams.get('height')) || 560));
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html>
<html>
<body style="margin:0;background:#444"><iframe title="Sessions" src="/view?theme=${url.searchParams.get('theme') ?? 'dark'}" style="width:${width}px;height:${height}px;border:0;display:block"></iframe><button style="position:fixed;left:850px;top:700px">Outside</button>
</body>
</html>`);
      } else if (url.pathname === '/view') {
        res.setHeader('Content-Type', 'text/html');
        res.end(documentHtml(url.searchParams.get('theme')));
      } else if (/^\/assets\/(main\.(js|css)|codicon\.(css|ttf))$/.test(url.pathname) || /^\/(agents|hosts)\/[a-z-]+\.(svg|png)$/.test(url.pathname)) {
        const relative = url.pathname.startsWith('/assets/') ? `../../dist/webview/${url.pathname.split('/').pop()}` : `../../media${url.pathname}`;
        const file = fileURLToPath(new URL(relative, import.meta.url));
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'font/ttf');
        res.end(await readFile(file));
      } else { res.statusCode = 404; res.end(); }
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
