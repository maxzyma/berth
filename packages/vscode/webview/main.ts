/**
 * The sessions view in the webview (spec §6). Renders the model the
 * extension sends; reports clicks. Rendered into light DOM: VS Code's native
 * context menu reads `data-vscode-context` by walking the document, which
 * does not enter shadow roots.
 */
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import type { GroupView, RowView, TreeView } from '../src/model.js';
import type { FromView, MenuContext, ToView, ViewSettings } from '../src/view/protocol.js';
import { HoverCard } from './hover.js';

interface VsCodeApi {
  postMessage(message: FromView): void;
  getState(): SavedState | undefined;
  setState(state: SavedState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface SavedState {
  collapsed: string[];
  scrollTop: number;
}

const vscode = acquireVsCodeApi();
const OTHER = '\u0000other';
const PLACE_ICON = { workspace: 'root-folder', inside: 'file-directory', outside: 'folder-library' } as const;
const STATE_WORDS: Record<RowView['icon'], string> = {
  working: 'working',
  waiting: 'waiting for you',
  done: 'finished, unread',
  idle: 'idle',
  stopped: 'stopped',
  unmanaged: 'not an agent session',
};

/** One focusable line: a group header or a session card. */
type Item = { id: string; kind: 'group'; group: GroupView | Other } | { id: string; kind: 'card'; row: RowView; level: number };
type Other = { cwd: string; label: string; rows: RowView[]; other: true };

class BerthSessions extends LitElement {
  static properties = { model: { state: true }, settings: { state: true }, focusId: { state: true } };
  declare model: { tree: TreeView; flatten: boolean } | undefined;
  declare settings: ViewSettings | undefined;
  declare focusId: string | undefined;
  private collapsed: Set<string>;
  private readonly hover = new HoverCard();

  constructor() {
    super();
    const saved = vscode.getState();
    this.collapsed = new Set(saved?.collapsed ?? [OTHER]);
    window.addEventListener('message', (e: MessageEvent<ToView>) => this.receive(e.data));
    window.addEventListener('scroll', () => this.save(), { passive: true });
    vscode.postMessage({ type: 'ready' });
  }

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  private receive(message: ToView): void {
    if (message.type === 'model') {
      const first = !this.model;
      this.model = { tree: message.model, flatten: message.flatten };
      if (first) requestAnimationFrame(() => window.scrollTo(0, vscode.getState()?.scrollTop ?? 0));
    } else {
      this.settings = message.settings;
      document.body.style.setProperty('--berth-indent', `${message.settings.indent}px`);
      document.body.dataset.guides = message.settings.indentGuides;
      this.hover.delay = message.settings.hoverDelay;
    }
  }

  private save(): void {
    vscode.setState({ collapsed: [...this.collapsed], scrollTop: window.scrollY });
  }

  /** Visible items in display order, for keyboard navigation. */
  private items(): Item[] {
    if (!this.model) return [];
    const { tree, flatten } = this.model;
    const out: Item[] = [];
    const groups: (GroupView | Other)[] = flatten ? [] : [...tree.groups];
    if (flatten) for (const row of tree.groups[0].rows) out.push({ id: `s:${row.name}`, kind: 'card', row, level: 1 });
    if (tree.unmanaged.length) groups.push({ cwd: OTHER, label: 'Other tmux sessions', rows: tree.unmanaged, other: true });
    for (const group of groups) {
      out.push({ id: `g:${group.cwd}`, kind: 'group', group });
      if (!this.collapsed.has(group.cwd)) for (const row of group.rows) out.push({ id: `s:${row.name}`, kind: 'card', row, level: 2 });
    }
    return out;
  }

  render(): TemplateResult {
    const items = this.items();
    const focus = this.focusId && items.some((i) => i.id === this.focusId) ? this.focusId : items[0]?.id;
    return html`<div class="list" role="tree" aria-label="Agent sessions" @keydown=${(e: KeyboardEvent) => this.key(e, items)}>
      ${items.map((item) => (item.kind === 'group' ? this.groupRow(item.group, item.id === focus) : this.card(item.row, item.level, item.id === focus)))}
      ${items.length === 0 && this.model ? html`<p class="empty">No sessions yet. Start one with + above.</p>` : nothing}
    </div>`;
  }

  private groupRow(group: GroupView | Other, focused: boolean): TemplateResult {
    const open = !this.collapsed.has(group.cwd);
    const other = 'other' in group;
    const attention = !open && !other ? group.attention : '';
    const context: MenuContext = other ? {} : { webviewSection: 'group', groupCwd: group.cwd };
    const icon = other ? 'terminal' : PLACE_ICON[group.place];
    return html`<div
      class="row group ${other ? '' : group.place} ${attention ? `attention-${attention}` : ''}"
      id=${`g:${group.cwd}`}
      role="treeitem"
      aria-level="1"
      aria-expanded=${open ? 'true' : 'false'}
      aria-label=${`${group.label}${attention ? `, ${attention === 'waiting' ? 'a session is waiting for you' : 'unread'}` : ''}`}
      tabindex=${focused ? 0 : -1}
      data-vscode-context=${JSON.stringify(context)}
      @click=${() => this.toggle(group.cwd)}
      @focus=${() => (this.focusId = `g:${group.cwd}`)}
      @mouseenter=${(e: MouseEvent) => !other && this.hover.schedule(e.currentTarget as HTMLElement, group.hover, this.settings)}
      @mouseleave=${() => this.hover.hide()}
    >
      <span class="twistie codicon codicon-chevron-${open ? 'down' : 'right'}"></span>
      <span class="icon codicon codicon-${icon}"></span>
      <span class="name">${group.label}</span>
      ${attention ? html`<span class="badge">${attention === 'waiting' ? '!' : '•'}</span>` : nothing}
      ${other
        ? nothing
        : html`<span
            class="action codicon codicon-add"
            role="button"
            title="New Session Here"
            aria-label=${`New session in ${group.label}`}
            @click=${(e: MouseEvent) => {
              e.stopPropagation();
              vscode.postMessage({ type: 'newIn', cwd: group.cwd });
            }}
          ></span>`}
    </div>`;
  }

  private card(row: RowView, level: number, focused: boolean): TemplateResult {
    const context: MenuContext = { webviewSection: 'session', session: row.name, berthItem: row.contextValue };
    const here = row.contextValue.includes('attached-here');
    const words = [row.name, row.agent ? `${STATE_WORDS[row.icon]}` : STATE_WORDS.unmanaged, row.subtitle].filter(Boolean).join(', ');
    return html`<div
      class="row card level-${level} state-${row.icon} ${row.attention ? `attention-${row.attention}` : ''} ${here ? 'selected' : ''}"
      id=${`s:${row.name}`}
      role="treeitem"
      aria-level=${level}
      aria-selected=${here ? 'true' : 'false'}
      aria-label=${words}
      tabindex=${focused ? 0 : -1}
      data-vscode-context=${JSON.stringify(context)}
      @click=${() => this.show(row.name)}
      @focus=${() => (this.focusId = `s:${row.name}`)}
      @mouseenter=${(e: MouseEvent) => this.hover.schedule(e.currentTarget as HTMLElement, row.hover, this.settings, row.agent)}
      @mouseleave=${() => this.hover.hide()}
    >
      <div class="line title">
        ${this.agentIcon(row.agent)}
        <span class="name">${row.label}</span>
        ${row.badge ? html`<span class="badge">${row.badge}</span>` : nothing}
      </div>
      ${row.subtitle ? html`<div class="line subtitle ${row.subtitleKind}">${row.subtitle}</div>` : nothing}
      ${this.settings?.details && row.details ? html`<div class="line details">${row.details}</div>` : nothing}
    </div>`;
  }

  private agentIcon(agent: string): TemplateResult {
    if (agent && agent !== 'shell' && this.settings?.agentIcons) {
      return html`<img class="icon agent" alt="" src=${`${this.settings.agentIcons}/${agent}.svg`} />`;
    }
    return html`<span class="icon codicon codicon-${agent === 'shell' ? 'terminal' : 'circle-outline'}"></span>`;
  }

  private toggle(cwd: string, open?: boolean): void {
    const isOpen = !this.collapsed.has(cwd);
    if (open === isOpen) return;
    if (isOpen) this.collapsed.add(cwd);
    else this.collapsed.delete(cwd);
    this.save();
    this.requestUpdate();
  }

  private show(session: string): void {
    this.hover.hide();
    vscode.postMessage({ type: 'show', session });
  }

  private key(e: KeyboardEvent, items: Item[]): void {
    this.hover.hide();
    const index = Math.max(0, items.findIndex((i) => i.id === this.focusId));
    const item = items[index];
    const move = (to: number) => {
      const target = items[Math.min(items.length - 1, Math.max(0, to))];
      if (!target) return;
      this.focusId = target.id;
      void this.updateComplete.then(() => document.getElementById(target.id)?.focus());
    };
    switch (e.key) {
      case 'ArrowDown': move(index + 1); break;
      case 'ArrowUp': move(index - 1); break;
      case 'Home': move(0); break;
      case 'End': move(items.length - 1); break;
      case 'Enter':
      case ' ':
        if (item?.kind === 'card') this.show(item.row.name);
        else if (item) this.toggle(item.group.cwd);
        break;
      case 'ArrowRight':
        if (item?.kind === 'group') this.toggle(item.group.cwd, true);
        break;
      case 'ArrowLeft':
        if (item?.kind === 'group') this.toggle(item.group.cwd, false);
        else if (item?.kind === 'card' && item.level === 2) move(items.slice(0, index).map((i) => i.kind).lastIndexOf('group'));
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}

customElements.define('berth-sessions', BerthSessions);
