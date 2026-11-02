import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { executableOnPath, resolveBinary } from '../src/tools.js';
import { sandbox } from './helpers.js';

test('CR54 executable search skips unusable entries and preserves explicit paths', (t) => {
  const sb = sandbox(t), first = sb.makeDir('first'), second = sb.makeDir('second');
  const name = 'fixture-command';
  writeFileSync(join(first, name), 'not executable');
  const good = join(second, name);
  writeFileSync(good, '#!/bin/sh\nexit 0\n'); chmodSync(good, 0o755);
  const env = { ...sb.env, PATH: `${first}:${second}` };
  assert.equal(resolveBinary(name, env), good);
  mkdirSync(join(first, 'directory'));
  assert.equal(executableOnPath('directory', env), undefined);
  symlinkSync(good, join(first, 'linked'));
  assert.equal(executableOnPath('linked', env), join(first, 'linked'));
  symlinkSync(join(first, 'absent'), join(first, 'broken'));
  assert.equal(executableOnPath('broken', env), undefined);
  assert.equal(executableOnPath(join(first, name), env), undefined);
  assert.equal(executableOnPath(good, env), good);
  assert.equal(executableOnPath(relative(process.cwd(), good), env), good);
  assert.equal(executableOnPath('absent', env), undefined);
  assert.equal(resolveBinary('absent', env), 'absent');
});

test('CR55 relative executable paths and PATH entries use the supplied launch directory', (t) => {
  const sb = sandbox(t), one = sb.makeDir('one'), two = sb.makeDir('two');
  for (const cwd of [one, two]) {
    mkdirSync(join(cwd, 'bin'));
    writeFileSync(join(cwd, 'bin', 'fixture'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(cwd, 'fixture'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.equal(executableOnPath('./fixture', sb.env, cwd), join(cwd, 'fixture'));
    assert.equal(executableOnPath('fixture', { PATH: 'bin' }, cwd), join(cwd, 'bin', 'fixture'));
    assert.equal(executableOnPath('fixture', { PATH: '' }, cwd), join(cwd, 'fixture'));
    assert.equal(executableOnPath('./missing', sb.env, cwd), undefined);
  }
});
