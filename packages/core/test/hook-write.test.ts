import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { chmodSync, closeSync, existsSync, lstatSync, openSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { hookFormat } from '../src/agents/hook-files.js';
import { getAdapter } from '../src/agents/registry.js';
import { sandbox } from './helpers.js';

const format = hookFormat('claude-settings');
const install = (file: string) => format.install(file, ['SessionStart'], () => 'BERTH_HOOK=1 fixture', getAdapter('claude')!);

test('CR57 a partial hook configuration write preserves the original file', (t) => {
  const sb = sandbox(t), dir = sb.makeDir('config'), file = join(dir, 'settings.json');
  const original = '{"permissions":{"allow":["fixture"]}}\n';
  writeFileSync(file, original);
  const realWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (target: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
    if (String(target).startsWith(dir)) {
      realWrite(target, 'partial', options);
      throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
    }
    return realWrite(target, data, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => install(file), /fixture disk full/);
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.deepEqual(readdirSync(dir), ['settings.json']);
});

test('CR57 atomic hook replacement preserves symlinks, permissions and open readers', (t) => {
  const sb = sandbox(t), dir = sb.makeDir('config'), target = join(dir, 'actual.json'), link = join(dir, 'settings.json');
  const original = '{"custom":"kept"}\n';
  writeFileSync(target, original); chmodSync(target, 0o640); symlinkSync('actual.json', link);
  const reader = openSync(target, 'r');
  try {
    install(link);
    assert.equal(readFileSync(reader, 'utf8'), original);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(statSync(target).mode & 0o777, 0o640);
    assert.equal(JSON.parse(readFileSync(target, 'utf8')).custom, 'kept');
    format.uninstall(link);
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { custom: 'kept', hooks: {} });
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally { closeSync(reader); }
  const missing = join(dir, 'new.json'); install(missing);
  assert.equal(statSync(missing).mode & 0o777, 0o600);
  symlinkSync('missing.json', join(dir, 'dangling.json'));
  assert.throws(() => install(join(dir, 'dangling.json')));
  assert.equal(existsSync(join(dir, 'missing.json')), false);
});

test('CR57 publication failure keeps original configuration and removes staged data', (t) => {
  const sb = sandbox(t), dir = sb.makeDir('config'), file = join(dir, 'settings.json');
  const original = '{"custom":"kept"}\n'; writeFileSync(file, original);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === file) throw Object.assign(new Error('fixture rename denied'), { code: 'EACCES' });
    return rename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => install(file), /fixture rename denied/);
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.deepEqual(readdirSync(dir), ['settings.json']);
});
