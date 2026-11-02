import { layoutChanges } from './model.js';

/** A portable preset contains no settings, credentials or paths from the source profile. */
export function layoutProfileTemplate(hideTerminalTabs: boolean, version: string): string {
  const settings = Object.fromEntries(layoutChanges(() => undefined, hideTerminalTabs).map(({ key, value }) => [key, value]));
  return JSON.stringify({
    name: 'Berth',
    settings: JSON.stringify({ settings: JSON.stringify(settings, null, 2) }),
    extensions: JSON.stringify([{ identifier: { id: 'berthdev.berth' }, version, disabled: false }]),
  }, null, 2);
}
