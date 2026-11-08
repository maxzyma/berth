import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, waitFor, killServer } from './helpers.js';

test('Known inventory removes exited sessions but preserves detached sessions and crash recovery', async t => {
  const sb = sandbox(t);
  const cwd = sb.makeDir('project');
  for (const name of ['exited', 'survivor']) {
    const result = sb.cli('new', 'claude', '--cwd', cwd, '--name', name);
    assert.equal(result.status, 0, result.stderr);
  }
  const read = () => {
    const result = sb.cli('ls', '--json', '--known-only');
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as { name: string; live: boolean }[];
  };
  assert.equal(read().length, 2);
  sb.tmux('kill-session', '-t', '=exited');
  await waitFor(() => !read().some(row => row.name === 'exited'), 'closure evidence removes exited session');
  assert.ok(read().some(row => row.name === 'survivor' && row.live), 'unattached live session stays listed');
  killServer(sb);
  assert.ok(read().some(row => row.name === 'survivor' && !row.live), 'server crash keeps recovery row');
});
