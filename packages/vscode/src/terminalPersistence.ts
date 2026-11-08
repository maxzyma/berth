/** Profile defaults: closing a macOS window is distinct from quitting the app. */
export const terminalPersistenceSettings = [
  { key: 'terminal.integrated.enablePersistentSessions', value: true },
  { key: 'terminal.integrated.persistentSessionReviveProcess', value: 'onExitAndWindowClose' },
] as const;

export interface ExplicitSetting {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

/** Fill only absent settings; explicit opt-outs at any scope remain authoritative. */
export function missingTerminalPersistence(inspect: (key: string) => ExplicitSetting | undefined) {
  return terminalPersistenceSettings.filter(({ key }) => {
    const value = inspect(key);
    return value?.globalValue === undefined && value?.workspaceValue === undefined
      && value?.workspaceFolderValue === undefined;
  });
}
