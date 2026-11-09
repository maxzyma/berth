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
 * Settings the layout preset writes (spec §6). `${progress}` is added to the
 * tab description so agent state shows on native tabs.
 */
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
