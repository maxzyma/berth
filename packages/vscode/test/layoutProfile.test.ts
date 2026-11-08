import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutProfileTemplate } from '../src/layoutProfile.js';

test('Native layout template isolates settings and pins the installed extension', () => {
  const template = JSON.parse(layoutProfileTemplate(false, '0.3.6'));
  assert.deepEqual(Object.keys(template).sort(), ['extensions', 'name', 'settings']);
  assert.equal(template.name, 'Berth');
  const settings = JSON.parse(JSON.parse(template.settings).settings);
  assert.equal(settings['workbench.sideBar.location'], 'right');
  assert.equal(settings['terminal.integrated.tabs.title'], '${sequence}');
  assert.equal(settings['terminal.integrated.enablePersistentSessions'], true);
  assert.equal(settings['terminal.integrated.persistentSessionReviveProcess'], 'onExitAndWindowClose');
  assert.deepEqual(settings['workbench.editor.autoLockGroups'], { terminalEditor: true });
  assert.equal(settings['terminal.integrated.tabs.enabled'], undefined);
  assert.equal(settings['workbench.settings.applyToAllProfiles'], undefined);
  assert.deepEqual(JSON.parse(template.extensions), [{ identifier: { id: 'berthdev.berth' }, version: '0.3.6', disabled: false }]);
  const hidden = JSON.parse(JSON.parse(JSON.parse(layoutProfileTemplate(true, '0.3.6')).settings).settings);
  assert.deepEqual(hidden, { ...settings, 'terminal.integrated.tabs.enabled': false });
});
