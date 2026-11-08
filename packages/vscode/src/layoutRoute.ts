/** VS Code 1.143 registers these commands for each non-internal profile. */
const DEFAULT_ENTRY = 'workbench.profiles.actions.profileEntry.__default__profile__';
const BERTH_ENTRY = 'workbench.action.openProfile.Berth';

export function layoutRoute(commands: readonly string[], local: boolean, hasWorkspace: boolean): 'reuse' | 'import' | 'pick' {
  if (!local || !commands.includes(DEFAULT_ENTRY)) return 'pick';
  if (!commands.includes(BERTH_ENTRY)) return 'import';
  return hasWorkspace && commands.includes('vscode.openFolder') ? 'reuse' : 'pick';
}
