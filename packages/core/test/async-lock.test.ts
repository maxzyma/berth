import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withAsyncLock, withLock } from '../src/restore/lock.js';

test('async state ownership excludes another process and recovers after owner death', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'berth-test-async-lock-'));
  const module = new URL('../src/restore/lock.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { withAsyncLock } from ${JSON.stringify(module)};
    await withAsyncLock(process.argv[1], async () => {
      process.stdout.write('owned');
      await new Promise(resolve => { process.stdin.resume(); process.stdin.once('data', resolve); });
    });
  `, root], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; rmSync(root, { recursive: true, force: true }); });
  const ready = once(child.stdout, 'data');
  const outcome = await Promise.race([ready.then(([data]) => String(data)), exited.then(() => 'premature exit')]);
  assert.equal(outcome, 'owned');
  await assert.rejects(withAsyncLock(root, async () => assert.fail('must not enter'), 40), /Another operation/);
  assert.throws(() => withLock(root, () => assert.fail('sync must not enter'), 40), /another restore/);
  child.kill('SIGKILL');
  await exited;
  assert.equal(await withAsyncLock(root, async () => 'recovered'), 'recovered');
  await assert.rejects(withAsyncLock(root, async () => { throw new Error('fixture transaction failure'); }), /fixture transaction failure/);
  assert.equal(await withAsyncLock(root, async () => 'released'), 'released');
});
