import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveHostIcons } from '../src/hostIcons.js';

test('unsupported host-icon platform has no assets and needs no platform tools', async () => {
  assert.deepEqual(await resolveHostIcons('/unused', 'linux'), {});
});
test('native installed host icons remain distinct and are cached as PNG', {
  skip: process.env.BERTH_NATIVE_HOST_ICONS !== '1' || process.platform !== 'darwin',
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'berth-host-icons-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const assets = await resolveHostIcons(dir);
  assert.ok(assets.iTerm2 && assets.Terminal);
  assert.notEqual(assets.iTerm2, assets.Terminal);
  for (const name of ['iTerm2', 'Terminal']) {
    const png = await readFile(join(dir, 'host-icons', assets[name]));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  }
  assert.deepEqual(await resolveHostIcons(dir), assets);
});
