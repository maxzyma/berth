import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutRoute } from '../src/layoutRoute.js';

const defaultEntry = 'workbench.profiles.actions.profileEntry.__default__profile__';
const berthEntry = 'workbench.action.openProfile.Berth';
const openFolder = 'vscode.openFolder';

test('existing Berth profile reuses the current workspace instead of importing', () => {
  assert.equal(layoutRoute([defaultEntry, berthEntry, openFolder], true, true), 'reuse');
});

test('known profile capability permits first import only when Berth is absent', () => {
  assert.equal(layoutRoute([defaultEntry, openFolder], true, true), 'import');
  assert.equal(layoutRoute([defaultEntry, openFolder], true, false), 'import');
});

test('unknown capabilities never imply absence and never create a duplicate', () => {
  assert.equal(layoutRoute([], true, true), 'pick');
  assert.equal(layoutRoute([berthEntry, openFolder], true, true), 'pick');
  assert.equal(layoutRoute([defaultEntry, berthEntry], true, true), 'pick');
});

test('remote and empty existing-profile windows use the native picker', () => {
  assert.equal(layoutRoute([defaultEntry, berthEntry, openFolder], true, false), 'pick');
  assert.equal(layoutRoute([defaultEntry, berthEntry, openFolder], false, true), 'pick');
  assert.equal(layoutRoute([defaultEntry, openFolder], false, true), 'pick');
});
