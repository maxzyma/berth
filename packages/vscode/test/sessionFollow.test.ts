import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionFollower } from '../src/sessionFollow.js';

test('folder follow returns to the triggering terminal and drops stale requests', async () => {
  let current: string | undefined = 'first';
  let release!: () => void;
  const focused: string[] = [];
  const follower = createSessionFollower({
    current: () => current, collapse: async () => {},
    reveal: async () => new Promise<void>(resolve => { release = resolve; }),
    focus: terminal => focused.push(terminal),
  });
  const first = follower.follow('folder');
  await Promise.resolve();
  current = 'second';
  release();
  await first;
  assert.deepEqual(focused, [], 'slow reveal must not pull focus back to first');
  const second = follower.follow('folder');
  await Promise.resolve(); release(); await second;
  assert.deepEqual(focused, ['second'], 'return to selected terminal, not an older main');
  const third = follower.follow('folder');
  await Promise.resolve(); follower.cancel(); release(); await third;
  assert.deepEqual(focused, ['second'], 'file/editor-group navigation cancels pending focus return');
});
