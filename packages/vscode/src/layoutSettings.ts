/** The settings the Berth layout preset writes (spec §6). */
import { terminalPersistenceSettings } from './terminalPersistence.js';

export interface SettingChange {
  key: string;
  value: unknown;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Settings the layout preset writes (spec §6). State shows through the tab
 * title alone: `${progress}` resolves to codicon syntax that terminal editor
 * tabs, where sessions open, print as literal text.
 */
export function layoutChanges(current: (key: string) => unknown, hideTerminalTabs: boolean): SettingChange[] {
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
  ];
  if (hideTerminalTabs) changes.push({ key: 'terminal.integrated.tabs.enabled', value: false });
  return changes;
}

export const tabDescriptionKey = 'terminal.integrated.tabs.description';

function progressDescription(settings: Record<string, unknown> | undefined): string | undefined {
  const value = settings?.[tabDescriptionKey];
  return typeof value === 'string' && value.includes('${progress}') ? value : undefined;
}

/**
 * Earlier presets added `${progress}` to the tab description (spec §6). The
 * managed Profile drops it only while it still equals the recorded value.
 */
export function staleProgressDescription(recorded: Record<string, unknown> | undefined, current: unknown): boolean {
  const written = progressDescription(recorded);
  return written !== undefined && current === written;
}

/** Recorded preset settings without the earlier `${progress}` description. */
export function withoutProgressDescription(settings: Record<string, unknown>): Record<string, unknown> {
  if (progressDescription(settings) === undefined) return settings;
  const { [tabDescriptionKey]: _dropped, ...rest } = settings;
  return rest;
}
