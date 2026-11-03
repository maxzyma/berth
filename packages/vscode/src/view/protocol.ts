/** Messages between the sessions view and the extension host (spec §6). */
import type { TreeView } from '../model.js';

/** VS Code settings the webview cannot read itself. */
export interface ViewSettings {
  /** `workbench.tree.indent`, px. */
  indent: number;
  /** `workbench.tree.renderIndentGuides`. */
  indentGuides: 'none' | 'onHover' | 'always';
  /** `berth.hover.delay`, ms. */
  hoverDelay: number;
  /** `berth.view.details`: compact connection markers. */
  details: boolean;
  /** Base URI of media/agents, for agent icons. */
  agentIcons: string;
  hostIcons?: Record<string, string>;
}

export type ToView =
  | { type: 'model'; model: TreeView; flatten: boolean }
  | { type: 'settings'; settings: ViewSettings }
  | { type: 'dismissDetails' }
  | { type: 'error'; message: string }
  | { type: 'copyResult'; id: number; success: boolean };

export type FromView = { type: 'checkRecovery'; session: string } | { type: 'copy'; id: number; value: string } | { type: 'ready' } | { type: 'retry' } | { type: 'new' } | { type: 'show'; session: string } | { type: 'newIn'; cwd: string } | { type: 'detailsVisibility'; visible: boolean };

/** What the view puts in `data-vscode-context`; context-menu commands receive it. */
export interface MenuContext {
  webviewSection?: 'session' | 'group';
  session?: string;
  groupCwd?: string;
  berthItem?: string;
}
