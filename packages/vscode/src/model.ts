/** Pure view logic for Berth for VS Code (spec §6); no `vscode` import, so it is unit-testable. */
import { basename } from 'node:path';
import { getAdapter, type SessionRow } from '@berthdev/berth';

export type Connection = 'attached-here' | 'attached-elsewhere' | 'detached' | 'stopped';

/**
 * A session row says as much as it can without words (spec §6): its icon is
 * the agent, its name's colour and badge the state; the rest is in the
 * tooltip. Words on a narrow row get cut off and crowd one another.
 */
export interface RowView {
  name: string;
  label: string;
  /** Agent id, for the row's icon; '' for an unmanaged session. */
  agent: string;
  /** The one thing worth reading at a glance: what a waiting or finished agent said. */
  description: string;
  tooltip: string;
  contextValue: string;
  icon: 'working' | 'waiting' | 'done' | 'stopped' | 'idle' | 'unmanaged';
  /** One character beside the name: the state, else unread. */
  badge: string;
  unread: boolean;
}

/** Where a folder sits relative to this window's workspace (spec §6). */
export type Place = 'workspace' | 'inside' | 'outside';

export interface GroupView {
  cwd: string;
  label: string;
  place: Place;
  rows: RowView[];
}

const norm = (p: string) => p.replace(/\/+$/, '');

export function placeOf(cwd: string, workspaceFolders: readonly string[]): Place {
  const target = norm(cwd);
  if (workspaceFolders.some((f) => norm(f) === target)) return 'workspace';
  return workspaceFolders.some((f) => target.startsWith(`${norm(f)}/`)) ? 'inside' : 'outside';
}

const PLACE_RANK: Record<Place, number> = { workspace: 0, inside: 1, outside: 2 };

/**
 * Agents for a new session: those named in `order` first, in that order,
 * then the rest in their usual order. Unknown ids are ignored.
 */
export function orderAgents<T extends { id: string }>(agents: readonly T[], order: readonly string[]): T[] {
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return agents.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a.id) - rank(y.a.id) || x.i - y.i).map(({ a }) => a);
}

export interface TreeView {
  groups: GroupView[];
  unmanaged: RowView[];
  waiting: number;
}

export function connection(row: SessionRow, here: ReadonlySet<string>): Connection {
  if (!row.live) return 'stopped';
  if (here.has(row.name)) return 'attached-here';
  return row.attachedClients > 0 ? 'attached-elsewhere' : 'detached';
}

const CONNECTION_TEXT: Record<Connection, string> = {
  'attached-here': 'Shown in this window',
  'attached-elsewhere': 'Open in another terminal',
  detached: 'Not open in any terminal',
  stopped: 'Stopped; comes back on the next restore',
};

const STATE_TEXT: Record<RowView['icon'], string> = {
  working: 'Working',
  waiting: 'Waiting for you',
  done: 'Finished its turn',
  idle: 'Idle',
  stopped: 'Stopped',
  unmanaged: '',
};

const BADGE: Partial<Record<RowView['icon'], string>> = { working: '⋯', waiting: '!', done: '✓' };

export interface ViewInput {
  here: ReadonlySet<string>;
  unread: ReadonlySet<string>;
  branch: (cwd: string) => string;
  workspaceFolders?: readonly string[];
}

const HOOKS_MISSING = "This agent's Berth hooks are not installed, so after a restart the session starts a new conversation. Right-click → Install Agent Hooks.";

export function rowView(row: SessionRow, input: ViewInput): RowView {
  const conn = connection(row, input.here);
  const unread = input.unread.has(row.name);
  if (!row.managed) {
    return {
      name: row.name,
      label: row.name,
      agent: '',
      description: '',
      tooltip: `${row.name} — not an agent session (adopt to manage it)\n${CONNECTION_TEXT[conn]}`,
      contextValue: `session unmanaged live ${conn}`,
      icon: 'unmanaged',
      badge: '',
      unread: false,
    };
  }
  const branch = input.branch(row.cwd);
  const hooksMissing = row.hooks === 'missing';
  const icon = !row.live ? 'stopped' : row.state === 'working' || row.state === 'waiting' || row.state === 'done' ? row.state : 'idle';
  const agentName = getAdapter(row.agent)?.displayName ?? row.agent;
  const note = (row.state === 'waiting' || row.state === 'done') && row.note ? `: ${row.note}` : '';
  const tooltip = [
    `${row.name} — ${agentName}`,
    `${STATE_TEXT[icon]}${note}`,
    CONNECTION_TEXT[conn],
    branch ? `Branch ${branch}` : '',
    row.cwd,
    hooksMissing ? HOOKS_MISSING : !row.conversation ? 'Conversation not bound yet: a restore would start a new one.' : '',
  ];
  return {
    name: row.name,
    label: row.name,
    agent: row.agent,
    description: note ? row.note : '',
    tooltip: tooltip.filter(Boolean).join('\n'),
    contextValue: `session managed ${row.live ? 'live' : 'stopped'} ${conn}${hooksMissing ? ' hooks-missing' : ''}`,
    icon,
    badge: BADGE[icon] ?? (unread ? '•' : ''),
    unread,
  };
}

export function buildTree(rows: SessionRow[], input: ViewInput): TreeView {
  const groups = new Map<string, RowView[]>();
  const unmanaged: RowView[] = [];
  for (const row of rows) {
    if (!row.managed) {
      unmanaged.push(rowView(row, input));
      continue;
    }
    const list = groups.get(row.cwd) ?? [];
    list.push(rowView(row, input));
    groups.set(row.cwd, list);
  }
  const folders = input.workspaceFolders ?? [];
  const ordered = [...groups.entries()]
    .map(([cwd, list]) => ({ cwd, label: basename(cwd) || cwd, place: placeOf(cwd, folders), rows: list.sort((x, y) => x.name.localeCompare(y.name)) }))
    .sort((a, b) => PLACE_RANK[a.place] - PLACE_RANK[b.place] || a.cwd.localeCompare(b.cwd));
  return {
    groups: ordered,
    unmanaged: unmanaged.sort((x, y) => x.name.localeCompare(y.name)),
    waiting: rows.filter((r) => r.live && r.state === 'waiting').length,
  };
}

export interface Transition {
  name: string;
  state: 'waiting' | 'done';
  note: string;
}

/** Sessions that just started waiting or finished, comparing two refreshes. */
export function transitions(previous: SessionRow[], next: SessionRow[]): Transition[] {
  const before = new Map(previous.map((r) => [r.name, r.state]));
  return next
    .filter((r) => r.live && (r.state === 'waiting' || r.state === 'done') && before.has(r.name) && before.get(r.name) !== r.state)
    .map((r) => ({ name: r.name, state: r.state as 'waiting' | 'done', note: r.note }));
}

export interface SettingChange {
  key: string;
  value: unknown;
}

/**
 * Settings the layout preset writes (spec §6). `${progress}` is added to the
 * tab description so agent state shows on native tabs.
 */
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function layoutChanges(current: (key: string) => unknown, hideTerminalTabs: boolean): SettingChange[] {
  const description = String(current('terminal.integrated.tabs.description') ?? '${task}${separator}${local}${separator}${cwdFolder}');
  const title = String(current('terminal.integrated.tabs.title') ?? '${process}');
  const changes: SettingChange[] = [
    // Session terminals open as editors in the first group, which locks so files open beside it.
    { key: 'workbench.editor.autoLockGroups', value: { ...(asObject(current('workbench.editor.autoLockGroups'))), terminalEditor: true } },
    { key: 'workbench.sideBar.location', value: 'right' },
    { key: 'workbench.secondarySideBar.defaultVisibility', value: 'visible' },
    {
      // Tabs show the title tmux sends: the session name with its state.
      key: 'terminal.integrated.tabs.title',
      value: title.includes('${sequence}') ? title : '${sequence}',
    },
    {
      key: 'terminal.integrated.tabs.description',
      value: description.includes('${progress}') ? description : `\${progress}\${separator}${description}`,
    },
  ];
  if (hideTerminalTabs) changes.push({ key: 'terminal.integrated.tabs.enabled', value: false });
  return changes;
}

/**
 * Values to restore on revert. Settings saved by an earlier apply keep their
 * saved value: applying again must not record Berth's own values as the
 * user's. Settings new in this apply are saved as they are now.
 */
export function layoutBackup(saved: Record<string, unknown> | undefined, now: Record<string, unknown>): Record<string, unknown> {
  return { ...now, ...(saved ?? {}) };
}

/**
 * The folder the explorer should follow for a session: its cwd, when that is
 * inside one of the workspace folders. Outside them the explorer cannot show
 * it without changing the workspace, which would reload the window.
 */
export function explorerTarget(cwd: string, workspaceFolders: string[]): string | undefined {
  const norm = (p: string) => p.replace(/\/+$/, '');
  const target = norm(cwd);
  return workspaceFolders.some((f) => target === norm(f) || target.startsWith(`${norm(f)}/`)) ? target : undefined;
}

/**
 * The next session needing the user, after `current`: sessions waiting for
 * them first, then unread ones, each in name order, wrapping around.
 */
export function nextAttention(rows: SessionRow[], unread: ReadonlySet<string>, current?: string): string | undefined {
  const live = rows.filter((r) => r.live && r.managed);
  const waiting = live.filter((r) => r.state === 'waiting').map((r) => r.name).sort();
  const others = live.filter((r) => r.state !== 'waiting' && unread.has(r.name)).map((r) => r.name).sort();
  const order = [...waiting, ...others];
  if (order.length === 0) return undefined;
  const at = current ? order.indexOf(current) : -1;
  return order[(at + 1) % order.length];
}

export interface LauncherValues {
  agent: string;
  /** Absolute folder the session runs in. */
  cwd: string;
  /** `cwd` relative to the workspace folder containing it; empty at that folder or outside all. */
  relative: string;
  /** The folder's base name. */
  name: string;
}

/**
 * Fill a custom launcher command's placeholders (spec §6). Works word by word:
 * a placeholder's value is shell-quoted as one word (spaces kept), and a word
 * that is only an empty placeholder is dropped.
 */
export function renderLauncher(template: string, values: LauncherValues): string {
  const quote = (v: string) => (/^[A-Za-z0-9_@%+:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);
  return template
    .trim()
    .split(/\s+/)
    .map((word) => {
      const only = /^\{(agent|cwd|relative|name)\}$/.exec(word);
      if (only) return values[only[1] as keyof LauncherValues] === '' ? '' : quote(values[only[1] as keyof LauncherValues]);
      return word.replace(/\{(agent|cwd|relative|name)\}/g, (_, key: keyof LauncherValues) => quote(values[key]));
    })
    .filter((word) => word !== '')
    .join(' ');
}

/** A launcher without `{agent}` chooses the agent itself (spec §6). */
export function launcherPicksAgent(template: string): boolean {
  return template.trim() !== '' && !template.includes('{agent}');
}

/**
 * Folder for a new session when the user did not name one: the folder of the
 * session shown in the main terminal, else the only workspace folder.
 */
export function defaultFolder(shownCwd: string | undefined, workspaceFolders: string[]): string | undefined {
  if (shownCwd) return shownCwd;
  return workspaceFolders.length === 1 ? workspaceFolders[0] : undefined;
}

/** `cwd` relative to the workspace folder that contains it, or '' (spec §6). */
export function relativeToWorkspace(cwd: string, workspaceFolders: string[]): string {
  const target = cwd.replace(/\/+$/, '');
  for (const folder of [...workspaceFolders].sort((a, b) => b.length - a.length)) {
    const base = folder.replace(/\/+$/, '');
    if (target === base) return '';
    if (target.startsWith(`${base}/`)) return target.slice(base.length + 1);
  }
  return '';
}
