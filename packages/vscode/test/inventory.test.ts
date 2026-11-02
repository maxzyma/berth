import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleDoctor, sampleInventory, sampleSessions } from '../src/inventory.js';

test('Slow core inspection leaves the host event loop available', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'berth-inventory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(dir, 'fixture.cjs');
  writeFileSync(cli, "setTimeout(() => process.stdout.write('[]'), 300);\n");
  const sample = sampleInventory(cli, process.env);
  const first = await Promise.race([sample.then(() => 'sample'), new Promise<string>((resolve) => setTimeout(() => resolve('host-event'), 10))]);
  assert.equal(first, 'host-event');
  assert.deepEqual((await sample).rows, []);
});

test('Malformed inventory rejects rather than masquerading as an empty list', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'berth-inventory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(dir, 'fixture.cjs');
  writeFileSync(cli, "process.stdout.write('{}');\n");
  await assert.rejects(sampleInventory(cli, process.env), /Invalid session inventory/);
});


test('CR51 setup diagnosis runs outside the host event loop and validates its result', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'berth-test-doctor-worker-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(dir, 'fixture.cjs');
  writeFileSync(cli, "if(process.argv.slice(2).join(' ')!=='doctor --json')process.exit(7);setTimeout(()=>process.stdout.write('[{\"problem\":\"fixture\",\"severity\":\"info\"}]'),300);\n");
  const pending = sampleDoctor(cli, process.env);
  const first = await Promise.race([pending.then(() => 'diagnosis'), new Promise<string>((resolve) => setTimeout(() => resolve('host-event'), 10))]);
  assert.equal(first, 'host-event');
  assert.deepEqual(await pending, [{ problem: 'fixture', severity: 'info' }]);
  writeFileSync(cli, "process.stdout.write('[{\"problem\":42}]');\n");
  await assert.rejects(sampleDoctor(cli, process.env), /Invalid setup diagnosis/);
});

test('CR63 inspection deadlines terminate children that ignore SIGTERM', { timeout: 18_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'berth-test-deadline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(dir, 'fixture.cjs');
  const ignoredTermination = "process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),15000);";
  writeFileSync(cli, ignoredTermination);
  const started = performance.now();
  await assert.rejects(sampleInventory(cli, process.env));
  assert.ok(performance.now() - started < 13_000, 'inventory deadline must release the single-flight queue');
  writeFileSync(cli, `process.stdout.write(JSON.stringify([{name:'fixture',cwd:${JSON.stringify(dir)},agent:'shell',live:true,managed:true}]));`);
  writeFileSync(join(dir, 'git'), `#!${process.execPath}\n${ignoredTermination}`, { mode: 0o700 });
  const branchStarted = performance.now();
  const result = await sampleInventory(cli, { ...process.env, PATH: dir });
  assert.equal(result.rows.length, 1, 'branch failure preserves the session inventory');
  assert.equal(result.branches.get(dir), '');
  assert.ok(performance.now() - branchStarted < 4000, 'branch deadline must not depend on graceful exit');
});


test('CR80 find-session inventory stays asynchronous and does not probe git', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'berth-test-find-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(dir, 'fixture.cjs');
  writeFileSync(cli, "setTimeout(()=>process.stdout.write(JSON.stringify([{name:'session',cwd:'missing-folder',agent:'shell',live:true,managed:true}])),200);");
  const pending = sampleSessions(cli, { ...process.env, PATH: '' });
  const first = await Promise.race([pending.then(() => 'inventory'), new Promise(resolve => setImmediate(() => resolve('host-event')))]);
  assert.equal(first, 'host-event');
  assert.equal((await pending)[0].name, 'session');
  writeFileSync(cli, "process.stdout.write('[null]');");
  await assert.rejects(sampleSessions(cli, process.env), /Invalid session inventory/);
});
