import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryCheckItems } from '../src/recoveryCheck.js';
import type { SessionRow } from '@berthdev/berth';

const base: SessionRow = { name: 'job', managed: true, agent: 'claude', cwd: '/project', conversation: 'exact', origin: 'vscode', state: '', note: '', topic: '', attachedClients: 1, live: true, hooks: 'installed', profile: { environment: { HOME: '/home/test', CLAUDE_CONFIG_DIR: '/profile' } } };

test('unverified binding survives checks and offers inspection only while live', () => {
  const row = { ...base, bindingIssue: 'Producer identity needs verification.' };
  const before = structuredClone(row);
  const live = recoveryCheckItems(row, []);
  assert.equal(live[0].action, 'inspect');
  assert.match(live[0].detail, /checking alone cannot clear/);
  assert.deepEqual(row, before);
  assert.equal(recoveryCheckItems({ ...row, live: false }, [])[0].action, undefined);
});

test('hook repair requires known profile and stopped-only repair actions stay scoped', () => {
  assert.ok(recoveryCheckItems({ ...base, hooks: 'broken' }, []).some(item => item.action === 'hooks'));
  const unknown = recoveryCheckItems({ ...base, profile: undefined, hooks: 'missing', recoveryOptionsRequired: true }, []);
  assert.ok(unknown.every(item => !item.action));
  const stopped = recoveryCheckItems({ ...base, live: false, profile: undefined, recoveryOptionsRequired: true }, []);
  assert.deepEqual(stopped.map(item => item.action), ['profile', 'options']);
});

test('check retains setup failures and does not claim a successful resume', () => {
  const clear = recoveryCheckItems(base, []);
  assert.equal(clear[0].label, 'No known recovery blockers');
  assert.match(clear[0].detail, /only when the agent resumes/);
  const failed = recoveryCheckItems(base, [{ session: 'job', problem: 'executable unavailable: agent' }, { session: 'other', problem: 'foreign' }]);
  assert.equal(failed.length, 1);
  assert.match(failed[0].detail, /executable unavailable/);
});
