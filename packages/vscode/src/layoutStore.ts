import { readFileSync } from 'node:fs';

export interface LayoutState {
  schema: 1;
  backup: Record<string, unknown>;
  applied: Record<string, unknown>;
  version?: number;
}
export const emptyLayout = (): LayoutState => ({ schema: 1, backup: {}, applied: {} });
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const settings = new Set([
  'workbench.editor.autoLockGroups', 'workbench.sideBar.location',
  'workbench.secondarySideBar.defaultVisibility', 'terminal.integrated.tabs.title',
  'terminal.integrated.tabs.description', 'terminal.integrated.tabs.enabled',
]);
function validate(value: unknown): LayoutState {
  if (!object(value) || value.schema !== 1 || !object(value.backup) || !object(value.applied)
    || [...Object.keys(value.backup), ...Object.keys(value.applied)].some((key) => !settings.has(key))
    || (value.version !== undefined && !Number.isSafeInteger(value.version))) {
    throw new Error('Layout recovery data is invalid. Settings were not changed; preserve the journal for diagnosis.');
  }
  return value as unknown as LayoutState;
}

/** Read-only evidence from the retired in-place layout workflow. */
export class LayoutStore {
  constructor(private readonly file: string, private readonly legacy: () => LayoutState = emptyLayout) {}

  read(): LayoutState {
    try { return validate(JSON.parse(readFileSync(this.file, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return validate(this.legacy());
      throw error;
    }
  }

}
