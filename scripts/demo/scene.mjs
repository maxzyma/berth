// Synthetic demo scene: workspace files, an isolated home directory and the
// configuration that keeps Claude Code and VS Code from showing first-run
// prompts. Everything is written below one temporary root.

import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export const API_KEY = 'sk-ant-demo-0000000000000000000000000000';

export const SESSIONS = [
  { name: 'cart-tests', folder: 'shop-api', prompt: 'Suggest three focused test cases for cartTotal.' },
  { name: 'api-review', folder: 'shop-api', prompt: 'Review the cart API and note one validation edge case.' },
  { name: 'quickstart', folder: 'docs-site', prompt: 'Review the quickstart and suggest a clearer three-step flow.' },
];

/** The prompt typed live in the recording; its reply streams for several seconds. */
export const LIVE_PROMPT = { session: 'api-review', text: 'Write a test for the negative quantity case.' };

const FILES = {
  'shop-api/cart.ts': `export interface CartItem {
  sku: string;
  price: number;
  quantity: number;
}

/** Total price of the cart, in the smallest currency unit. */
export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function itemCount(items: CartItem[]): number {
  return items.reduce((count, item) => count + item.quantity, 0);
}
`,
  'shop-api/README.md': `# shop-api

Cart pricing for the demo storefront.

- \`cartTotal\` sums price × quantity for every item.
- Prices are integers in the smallest currency unit.
- Rounding happens only where totals are displayed.
`,
  'docs-site/README.md': `# docs-site

Documentation for the demo storefront.

## Quickstart

Install the dependencies, copy the example environment file,
set the API URL, then start the development server. If the
server cannot reach the API, check the URL and restart it.
`,
};

function write(path, content) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

/** Directory layout below the temporary root. */
export function layout(root) {
  const real = realpathSync(root);
  return {
    root: real,
    home: join(real, 'home'),
    projects: join(real, 'projects'),
    workspaceFile: join(real, 'projects', 'Berth-demo.code-workspace'),
    claudeConfig: join(real, 'claude'),
    tmuxDir: join(real, 'tmux'),
    bin: join(real, 'bin'),
    userData: join(real, 'vscode', 'user-data'),
    extensions: join(real, 'vscode', 'extensions'),
    logs: join(real, 'logs'),
    frames: join(real, 'frames'),
  };
}

export function writeWorkspace(dirs) {
  for (const [file, content] of Object.entries(FILES)) write(join(dirs.projects, file), content);
  write(dirs.workspaceFile, `${JSON.stringify({ folders: [{ path: 'shop-api' }, { path: 'docs-site' }], settings: {} }, null, 2)}\n`);
}

/** A neutral shell and tmux setup: no user or host name in prompts or status lines. */
export function writeHome(dirs, path) {
  write(join(dirs.home, '.zshenv'), `export PATH='${path}'\n`);
  write(join(dirs.home, '.zshrc'), "PROMPT='%1~ %# '\nunsetopt BEEP\n");
  write(join(dirs.home, '.tmux.conf'), 'set -g status off\nset -g mouse on\nset -g focus-events on\nset -g default-terminal "tmux-256color"\n');
  mkdirSync(dirs.tmuxDir, { recursive: true, mode: 0o700 });
  mkdirSync(dirs.logs, { recursive: true });
  mkdirSync(dirs.frames, { recursive: true });
}

/** Claude Code configuration that skips onboarding, trust and API key prompts. */
export function seedClaude(dirs, version) {
  const projects = Object.fromEntries(['shop-api', 'docs-site'].map(folder => [join(dirs.projects, folder), {
    allowedTools: [],
    hasTrustDialogAccepted: true,
    hasCompletedProjectOnboarding: true,
    hasClaudeMdExternalIncludesApproved: false,
    hasClaudeMdExternalIncludesWarningShown: true,
    projectOnboardingSeenCount: 1,
  }]));
  const global = {
    numStartups: 20,
    installMethod: 'native',
    autoUpdates: false,
    theme: 'dark',
    hasCompletedOnboarding: true,
    lastOnboardingVersion: version,
    lastReleaseNotesSeen: version,
    hasSeenTasksHint: true,
    hasIdeOnboardingBeenShown: { vscode: true },
    shiftEnterKeyBindingInstalled: true,
    officialMarketplaceAutoInstallAttempted: true,
    effortCalloutDismissed: true,
    effortCalloutV2Dismissed: true,
    hasSeenAutoDefaultNotice: true,
    customApiKeyResponses: { approved: [API_KEY.slice(-20)], rejected: [] },
    projects,
  };
  write(join(dirs.claudeConfig, '.claude.json'), `${JSON.stringify(global, null, 2)}\n`);
  write(join(dirs.claudeConfig, 'settings.json'), `${JSON.stringify({ spinnerTipsEnabled: false }, null, 2)}\n`);
}

/**
 * VS Code user settings. The layout keys are the ones Berth's own layout
 * preset writes (except as noted) (packages/vscode/src/layoutSettings.ts); writing them here
 * avoids the preset's profile switch, which opens another window.
 */
export function writeVsCodeSettings(dirs) {
  const settings = {
    'workbench.colorTheme': 'Default Dark Modern',
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'workbench.enableExperiments': false,
    'workbench.layoutControl.enabled': false,
    'window.titleBarStyle': 'native',
    'window.commandCenter': false,
    'window.restoreWindows': 'none',
    'security.workspace.trust.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
    'extensions.ignoreRecommendations': true,
    'chat.disableAIFeatures': true,
    'editor.minimap.enabled': false,
    'editor.fontSize': 13,
    'terminal.integrated.fontSize': 13,
    'terminal.integrated.cursorBlinking': false,
    'terminal.integrated.shellIntegration.enabled': false,
    'git.enabled': false,
    'workbench.editor.autoLockGroups': { terminalEditor: true },
    'workbench.sideBar.location': 'right',
    'workbench.secondarySideBar.defaultVisibility': 'visible',
    'terminal.integrated.enablePersistentSessions': true,
    'terminal.integrated.persistentSessionReviveProcess': 'onExitAndWindowClose',
    'terminal.integrated.tabs.title': '${sequence}',
    // The preset also prepends ${progress}; editor tabs render it as literal
    // "$(loading~spin)" text while an agent works, so the demo leaves it out.
    'terminal.integrated.tabs.description': '${task}${separator}${local}${separator}${cwdFolder}',
  };
  write(join(dirs.userData, 'User', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
}
