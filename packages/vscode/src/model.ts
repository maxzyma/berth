import { activityTimeLines } from './activityTime.js';
import { terminalPersistenceSettings } from './terminalPersistence.js';
import { WORKING_ICON } from './view/iconSemantics.js';
import { profileRoot } from '@berthdev/berth';
/** Pure view logic for Berth for VS Code (spec §6); no `vscode` import, so it is unit-testable. */
import { basename } from 'node:path';
import { getAdapter, sanitizeName, type SessionRow } from '@berthdev/berth';

export type Connection = 'attached-here' | 'attached-unknown' | 'attached-elsewhere' | 'detached' | 'stopped';

/** One line of a hover card, led by a codicon (spec §6). */
export interface HoverLine {
  icon: string;
  hostApplication?: string;
  currentWindow?: boolean;
  text: string;
  kind?: 'title' | 'quote' | 'rule' | 'path' | 'warning';
  /** Secondary text on a title line (the agent's name). */
  sub?: string;
  /** A state chip on a title line; tone colours it like the card. */
  chip?: { icon: string; text: string; tone: Attention | 'muted' };
  /** Full text when `text` is shortened (paths). */
  full?: string;
  copyValue?: string;
  copyLabel?: string;
  checkRecoveryFor?: string;
}

/**
 * A session card (spec §6): the agent's icon, the name and a state badge on
 * line one with compact connection markers; the subtitle on line two; the
 * rest in the hover card.
 */
export interface RowView {
  name: string;
  label: string;
  /** Agent id, for the card's icon; '' for an unmanaged session. */
  agent: string;
  /** Line two: what a waiting or finished agent said, else the topic. */
  subtitle: string;
  subtitleKind: 'note' | 'topic' | '';
  /** Full connection label for accessibility. */
  details: string;
  location: { icon: string; additional: number; hostApplication?: string; currentWindow: boolean };
  hover: HoverLine[];
  /** Matched by the context menu's when clauses (`berthItem`). */
  contextValue: string;
  icon: 'working' | 'waiting' | 'done' | 'stopped' | 'idle' | 'unmanaged';
  /** One character beside the name: the state, else unread. */
  badge: string;
  /** Colour goes only to what needs the user; everything else stays grey. */
  attention: Attention;
  unread: boolean;
  active?: boolean;
}

/** Where a folder sits relative to this window's workspace (spec §6). */
export type Place = 'workspace' | 'inside' | 'outside';

/** What needs the user: someone waiting outranks something unread (spec §6). */
export type Attention = 'waiting' | 'unread' | '';

export interface GroupView {
  cwd: string;
  label: string;
  place: Place;
  branch?: string;
  /** The most urgent of its sessions, shown on the group row when collapsed. */
  attention: Attention;
  hover: HoverLine[];
  rows: RowView[];
}

export const PLACE_CODICON: Record<Place, string> = { workspace: 'root-folder', inside: 'file-directory', outside: 'folder-library' };

export const PLACE_TEXT: Record<Place, string> = {
  workspace: "This window's workspace folder",
  inside: "Inside this window's workspace",
  outside: "Outside this window's workspace",
};

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

export function connection(row: SessionRow, here: ReadonlySet<string>, terminalPids?: ReadonlySet<number>, pidsReady = true): Connection {
  if (!row.live) return 'stopped';
  const local = row.connections?.some((client) => client.ancestors.some((pid) => terminalPids?.has(pid)));
  if (local || (!terminalPids && here.has(row.name) && row.attachedClients > 0)) return 'attached-here';
  const connected = row.attachedClients > 0 || !!row.connections?.length;
  if (!connected) return 'detached';
  if (!pidsReady || !terminalPids || !row.connections?.length || row.connections.every(client => client.ancestors.length < 2)) return 'attached-unknown';
  return 'attached-elsewhere';
}

const CONNECTION_TEXT: Record<Connection, string> = {
  'attached-here': 'Shown in this window',
  'attached-elsewhere': 'Open in another terminal',
  'attached-unknown': 'Connected; its window has not yet been identified',
  detached: 'Not open in any terminal',
  stopped: 'Stopped; no running terminal',
};

const STATE_TEXT: Record<RowView['icon'], string> = {
  working: 'Working',
  waiting: 'Waiting for you',
  done: 'Finished, unread',
  idle: 'Idle',
  stopped: 'Stopped',
  unmanaged: '',
};

// A finished turn is only shown while unread; the renderer uses a circle check.
const BADGE: Partial<Record<RowView['icon'], string>> = { working: '⋯', waiting: '!', done: '•' };

/** One icon per tooltip line (spec §6). */
const CONNECTION_CODICON: Record<Connection, string> = {
  'attached-here': 'terminal',
  'attached-elsewhere': 'terminal',
  'attached-unknown': 'terminal',
  detached: 'debug-disconnect',
  stopped: 'debug-stop',
};

const STATE_CODICON: Record<RowView['icon'], string> = {
  working: WORKING_ICON,
  waiting: 'bell-dot',
  done: 'pass-filled',
  idle: 'circle-outline',
  stopped: 'debug-stop',
  unmanaged: 'terminal',
};

const CONNECTION_SHORT: Record<Connection, string> = {
  'attached-here': 'This window',
  'attached-elsewhere': 'Other terminal',
  'attached-unknown': 'Connected',
  detached: 'detached',
  stopped: 'stopped',
};

export interface ViewInput {
  here: ReadonlySet<string>;
  terminalPids?: ReadonlySet<number>;
  terminalPidsReady?: boolean;
  activeTerminalPid?: number;
  unread: ReadonlySet<string>;
  branch: (cwd: string) => string;
  workspaceFolders?: readonly string[];
  /** The user's home, to shorten paths as `~/…`. */
  home?: string;
  now?: number;
}

/** A folder as the user reads it: `<workspace>/rel` inside the workspace, `~/…` under home. */
export function shortPath(cwd: string, workspaceFolders: readonly string[], home = ''): string {
  const target = norm(cwd);
  for (const folder of [...workspaceFolders].sort((a, b) => b.length - a.length)) {
    const base = norm(folder);
    if (target === base || target.startsWith(`${base}/`)) return `${basename(base)}${target.slice(base.length)}`;
  }
  const h = norm(home);
  return h && (target === h || target.startsWith(`${h}/`)) ? `~${target.slice(h.length)}` : target;
}

const HOOKS_MISSING = "This agent's Berth hooks are not installed. State updates and future conversation binding may be unavailable. Right-click → Install Agent Hooks.";

export function rowView(row: SessionRow, input: ViewInput): RowView {
  const conn = connection(row, input.here, input.terminalPids, input.terminalPidsReady);
  const clients = row.live ? row.connections ?? [] : [];
  const locations = clients.map((client) => ({
    local: client.ancestors.some((pid) => input.terminalPids?.has(pid)),
    label: client.ancestors.some((pid) => input.terminalPids?.has(pid)) ? [client.application, 'This window'].filter(Boolean).join(' · ') : [client.application || 'Other terminal', client.workspace].filter(Boolean).join(' · '),
    terminal: client.terminal,
    application: client.application,
  })).sort((a, b) => Number(b.local) - Number(a.local));
  const count = row.live ? Math.max(row.attachedClients, clients.length) : 0;
  const location = locations[0]?.label ?? CONNECTION_SHORT[conn];
  const summary = `${location}${count > 1 ? ` +${count - 1}` : ''}`;
  const compactLocation = {
    icon: CONNECTION_CODICON[conn],
    hostApplication: locations[0]?.application,
    currentWindow: conn === 'attached-here',
    additional: Math.max(0, count - 1),
  };
  const connectionLines: HoverLine[] = locations.length
    ? locations.map((location) => ({ icon: 'terminal', hostApplication: location.application, currentWindow: location.local, text: `${location.label}${location.terminal ? ` · ${location.terminal}` : ''}`, copyValue: `${location.label}${location.terminal ? ` · ${location.terminal}` : ''}`, copyLabel: 'connection' }))
    : [{ icon: CONNECTION_CODICON[conn], text: CONNECTION_TEXT[conn], copyValue: CONNECTION_TEXT[conn], copyLabel: 'connection' }];
  if (conn === 'attached-unknown' && locations.length) connectionLines.push({ icon: 'info', text: CONNECTION_TEXT[conn] });
  if (locations.length && count > locations.length) connectionLines.push({ icon: 'terminal', text: `${count - locations.length} other terminal(s)` });
  const unread = input.unread.has(row.name);
  const active = !!input.activeTerminalPid && !!row.live
    && clients.some(client => client.ancestors.includes(input.activeTerminalPid!));
  if (!row.managed) {
    return {
      name: row.name,
      label: row.name,
      agent: '',
      active,
      subtitle: '',
      subtitleKind: '',
      details: summary,
      location: compactLocation,
      hover: [
        { icon: 'terminal', text: row.name, copyValue: row.name, copyLabel: 'session name', kind: 'title', sub: 'not an agent session' },
        { icon: row.bindingIssue ? 'warning' : 'info', text: row.bindingIssue || 'Adopt it to manage it', ...(row.bindingIssue ? { kind: 'warning' as const } : {}) },
        { icon: '', text: '', kind: 'rule' },
        ...connectionLines,
      ],
      contextValue: `session unmanaged live ${conn}`,
      icon: 'unmanaged',
      badge: '',
      attention: '',
      unread: false,
    };
  }
  const branch = input.branch(row.cwd);
  const hooksMissing = row.hooks === 'missing' || row.hooks === 'broken';
  // A finished turn matters until the user has seen it; after that it is idle (spec §6).
  const state = row.state === 'done' && !unread ? '' : row.state;
  const icon = !row.live ? 'stopped' : state === 'working' || state === 'waiting' || state === 'done' ? state : 'idle';
  const agentName = getAdapter(row.agent)?.displayName ?? row.agent;
  const note = (icon === 'waiting' || icon === 'done') && row.note ? row.note : '';
  // Idle says nothing; any other state is a chip on the title line.
  const chip = icon === 'idle' ? undefined : { icon: STATE_CODICON[icon], text: STATE_TEXT[icon], tone: icon === 'waiting' ? ('waiting' as const) : unread && icon !== 'working' ? ('unread' as const) : ('muted' as const) };
  const topic = row.topic !== row.name ? row.topic : '';
  const title = row.conversationTitle !== row.name ? row.conversationTitle : '';
  const preview = row.live && !note && !topic && !title && row.terminalPreview !== row.name ? row.terminalPreview : '';
  const supporting = note || topic || title || preview || '';
  const hover: HoverLine[] = [
    { icon: '', text: row.name, copyValue: row.name, copyLabel: 'session name', kind: 'title', sub: agentName, chip },
    ...(note ? [{ icon: 'comment', text: note, copyValue: note, copyLabel: 'notification', kind: 'quote' as const }] : []),
    ...(topic && topic !== note ? [{ icon: 'comment-discussion', text: row.topic, copyValue: row.topic, copyLabel: 'task text' }] : []),
    ...(preview ? [{ icon: 'comment-discussion', text: `Visible terminal prompt: ${preview}`, copyValue: preview, copyLabel: 'terminal prompt' }] : []),
    ...activityTimeLines(row, input.now),
    { icon: '', text: '', kind: 'rule' },
    ...connectionLines,
    ...(title && title !== topic && title !== note ? [{ icon: 'comment-discussion', text: `Conversation: ${row.conversationTitle}`, copyValue: row.conversationTitle, copyLabel: 'conversation title' }] : []),
    ...(branch ? [{ icon: 'git-branch', text: branch, copyValue: branch, copyLabel: 'branch' }] : []),
    { icon: 'folder', text: shortPath(row.cwd, input.workspaceFolders ?? [], input.home), full: row.cwd, copyValue: row.cwd, copyLabel: 'folder path', kind: 'path' },
    ...(row.recoveryOptionsRequired ? [{ icon: 'warning', text: 'Review Recovery Options before resuming: saved launch options need verification or use unsupported syntax.' }] : []),
    ...(row.profile ? [{ icon: 'folder', text: `Agent profile: ${profileRoot(row.agent, row.profile)}`, copyValue: profileRoot(row.agent, row.profile), copyLabel: 'agent profile' }] : !row.live && row.agent !== 'shell' ? [{ icon: 'info', text: 'Choose Recovery Profile before resuming this conversation.' }] : []),
    ...(row.conversation ? [{ icon: 'key', text: `Conversation ID: ${row.conversation}`, copyValue: row.conversation, copyLabel: 'conversation ID' }] : []),
    ...(row.recovery && row.recovery !== 'confirmed' ? [{ icon: 'warning', text: `Recovery ${row.recovery}: ${row.recoveryDetail ?? 'Inspect the terminal.'}`, kind: 'warning' as const }] : []),
    ...(!row.live && row.agent !== 'shell' ? [{ icon: 'history', text: `Recovery: ${row.bindingIssue ? 'binding needs verification' : row.conversation ? 'conversation recorded' : 'conversation not bound'}`, checkRecoveryFor: row.name }] : []),
    ...(!row.live && row.bindingIssue ? [{ icon: 'warning', text: row.bindingIssue, kind: 'warning' as const }] : []),
    ...(hooksMissing
      ? [{ icon: 'warning', text: row.hooks === 'broken' ? 'Agent hooks are incomplete or their runtime files are unavailable. Reinstall hooks to repair state updates and conversation binding.' : HOOKS_MISSING, kind: 'warning' as const }]
      : []),
    ...(row.hookSetup ? [{ icon: 'info', text: row.hookSetup }] : []),
    ...(!row.live && row.agent !== 'shell' && !row.conversation
      ? [{ icon: 'info', text: 'Conversation not bound: automatic recovery is unavailable. Use the agent conversation picker or start a new session explicitly.' }]
      : []),
  ];
  return {
    name: row.name,
    label: row.name,
    active,
    agent: row.agent,
    subtitle: supporting,
    subtitleKind: note ? 'note' : supporting ? 'topic' : '',
    details: summary,
    location: compactLocation,
    hover,
    contextValue: `session managed${row.agent !== 'shell' ? ' agent-session' : ''} ${row.live ? 'live' : 'stopped'} ${conn}${hooksMissing || row.hooks === 'unknown' ? ' hooks-missing' : ''}${unread ? ' unread' : ''}${row.recovery === 'failed' || row.recovery === 'unconfirmed' ? ' recovery-retry' : ''}`,
    icon,
    badge: BADGE[icon] ?? (unread ? '•' : ''),
    attention: icon === 'waiting' ? 'waiting' : unread && icon !== 'working' ? 'unread' : '',
    unread,
  };
}

const sessionNames = new Intl.Collator('en', { numeric: true });

/** Stable natural ordering, including a tie-break for names such as job-2/job-02. */
export function compareSessionNames(a: string, b: string): number {
  return sessionNames.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
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
    .map(([cwd, list]) => ({
      cwd,
      label: basename(cwd) || cwd,
      place: placeOf(cwd, folders),
      branch: input.branch(cwd),
      hover: [
        { icon: '', text: basename(cwd) || cwd, copyValue: basename(cwd) || cwd, copyLabel: 'folder name', kind: 'title' as const },
        { icon: 'folder', text: shortPath(cwd, folders, input.home), full: cwd, copyValue: cwd, copyLabel: 'folder path', kind: 'path' as const },
        ...(input.branch(cwd) ? [{ icon: 'git-branch', text: `Current worktree branch: ${input.branch(cwd)}`, copyValue: input.branch(cwd), copyLabel: 'branch' }] : []),
        { icon: PLACE_CODICON[placeOf(cwd, folders)], text: PLACE_TEXT[placeOf(cwd, folders)] },
      ],
      attention: (list.some((r) => r.attention === 'waiting') ? 'waiting' : list.some((r) => r.attention === 'unread') ? 'unread' : '') as Attention,
      rows: [...list].sort((x, y) => compareSessionNames(x.name, y.name)),
    }))
    .sort((a, b) => PLACE_RANK[a.place] - PLACE_RANK[b.place] || a.cwd.localeCompare(b.cwd));
  return {
    groups: ordered,
    unmanaged: [...unmanaged].sort((x, y) => compareSessionNames(x.name, y.name)),
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
    ...terminalPersistenceSettings,
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
  const waiting = live.filter((r) => r.state === 'waiting').map((r) => r.name).sort(compareSessionNames);
  const others = live.filter((r) => r.state !== 'waiting' && unread.has(r.name)).map((r) => r.name).sort(compareSessionNames);
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


/** Native quick-pick data; names remain exact identity keys even with duplicate titles. */
export function sessionChoices(rows: readonly SessionRow[]): { label: string; description: string; detail: string; session: string }[] {
  return [...rows].sort((a, b) => compareSessionNames(a.name, b.name)).map((row) => ({
    label: row.name,
    description: [getAdapter(row.agent)?.displayName ?? row.agent, row.live ? 'Running' : 'Stopped', row.recovery && row.recovery !== 'confirmed' ? `Recovery ${row.recovery}` : ''].filter(Boolean).join(' · '),
    detail: [row.conversationTitle || row.topic, row.cwd].filter(Boolean).join(' · '),
    session: row.name,
  }));
}

/** Rename input check, shown while typing: the core accepts letters, digits, `-` and `_`. */
export function sessionNameProblem(value: string): string | undefined {
  if (!value) return 'Enter a name.';
  if (sanitizeName(value) === value) return undefined;
  const suggested = sanitizeName(value);
  return `Use letters, digits, - or _ only${suggested !== 'session' || /session/.test(value) ? `, for example ${suggested}` : ''}.`;
}
