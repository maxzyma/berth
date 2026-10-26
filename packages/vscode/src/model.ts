/** Pure view logic for Berth for VS Code (spec §6); no `vscode` import, so it is unit-testable. */
import { basename } from 'node:path';
import type { SessionRow } from '@berthdev/berth';

export type Connection = 'attached-here' | 'attached-elsewhere' | 'detached' | 'stopped';

export interface RowView {
  name: string;
  label: string;
  description: string;
  tooltip: string;
  contextValue: string;
  icon: 'working' | 'waiting' | 'done' | 'stopped' | 'idle' | 'unmanaged';
  unread: boolean;
}

export interface GroupView {
  cwd: string;
  label: string;
  rows: RowView[];
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
  'attached-here': 'here',
  'attached-elsewhere': 'elsewhere',
  detached: 'detached',
  stopped: 'stopped',
};

export interface ViewInput {
  here: ReadonlySet<string>;
  unread: ReadonlySet<string>;
  branch: (cwd: string) => string;
}

export function rowView(row: SessionRow, input: ViewInput): RowView {
  const conn = connection(row, input.here);
  const unread = input.unread.has(row.name);
  if (!row.managed) {
    return {
      name: row.name,
      label: row.name,
      description: CONNECTION_TEXT[conn],
      tooltip: `${row.name} — not an agent session (adopt to manage it)`,
      contextValue: `session unmanaged live ${conn}`,
      icon: 'unmanaged',
      unread: false,
    };
  }
  const branch = input.branch(row.cwd);
  const parts = [row.agent, row.state || 'idle', CONNECTION_TEXT[conn]];
  if (branch) parts.push(branch);
  if (!row.conversation) parts.push('unbound');
  const icon = !row.live ? 'stopped' : row.state === 'working' || row.state === 'waiting' || row.state === 'done' ? row.state : 'idle';
  return {
    name: row.name,
    label: `${unread ? '● ' : ''}${row.name}`,
    description: parts.join(' · '),
    tooltip: [row.name, row.cwd, row.note].filter(Boolean).join('\n'),
    contextValue: `session managed ${row.live ? 'live' : 'stopped'} ${conn}`,
    icon,
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
  const ordered = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cwd, list]) => ({ cwd, label: basename(cwd) || cwd, rows: list.sort((x, y) => x.name.localeCompare(y.name)) }));
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
export function layoutChanges(current: (key: string) => unknown, hideTerminalTabs: boolean): SettingChange[] {
  const description = String(current('terminal.integrated.tabs.description') ?? '${task}${separator}${local}${separator}${cwdFolder}');
  const changes: SettingChange[] = [
    { key: 'terminal.integrated.tabs.location', value: 'left' },
    { key: 'workbench.sideBar.location', value: 'right' },
    { key: 'workbench.secondarySideBar.defaultVisibility', value: 'visible' },
    {
      key: 'terminal.integrated.tabs.description',
      value: description.includes('${progress}') ? description : `\${progress}\${separator}${description}`,
    },
  ];
  if (hideTerminalTabs) changes.push({ key: 'terminal.integrated.tabs.enabled', value: false });
  return changes;
}
