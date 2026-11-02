import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { sandbox } from './helpers.js';
import { readJsonlTitles } from '../src/agents/jsonl-titles.js';
import { conversationTitle, titleLookup } from '../src/agents/titles.js';

const title = (value: string) => `${JSON.stringify({ type: 'custom-title', customTitle: value })}\n`;

test('CR46 Claude and Qoder retain the latest rename between former sampling windows', (t) => {
  const sb = sandbox(t);
  for (const agent of ['claude', 'qoder']) {
    const root = sb.makeDir(agent), dir = sb.makeDir(`${agent}/projects/-workspace-product`);
    writeFileSync(join(dir, 'exact.jsonl'), title('old') + '{}\n'.repeat(30000) + title('new') + '{}\n'.repeat(200000));
    const env = { ...sb.env, [agent === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'QODER_CONFIG_DIR']: root };
    assert.equal(conversationTitle(agent, '/workspace/product', 'exact', env), 'new');
  }
});

test('CR46 Codex single and batched lookups find names outside the old index tail', (t) => {
  const sb = sandbox(t), root = sb.makeDir('codex');
  writeFileSync(join(root, 'session_index.jsonl'), [
    JSON.stringify({ id: 'exact', thread_name: 'old' }),
    JSON.stringify({ id: 'exact', thread_name: 'new' }), '{}\n'.repeat(200000),
    JSON.stringify({ id: 'other', thread_name: 'other-name' }), '{',
  ].join('\n'));
  const env = { ...sb.env, CODEX_HOME: root };
  assert.equal(conversationTitle('codex', '/workspace/product', 'exact', env), 'new');
  const lookup = titleLookup([{ agent: 'codex', conversation: 'exact' }, { agent: 'codex', conversation: 'other' }], env);
  assert.equal(lookup('codex', '', 'exact'), 'new');
  assert.equal(lookup('codex', '', 'other'), 'other-name');
});

test('CR46 reverse records preserve UTF-8, large records and escaped property names', (t) => {
  const sb = sandbox(t), file = join(sb.root, 'records.jsonl');
  const value = '名称🙂'.repeat(20000);
  writeFileSync(file, title('old') + title(value) + '{}\n'.repeat(40000) + '{');
  assert.equal(readJsonlTitles(file, ['exact'], 'custom-title').titles.get('exact'), value);
  writeFileSync(file, '{"type":"\\u0063ustom-title","customTitle":"escaped"}\n');
  assert.equal(readJsonlTitles(file, ['exact'], 'custom-title').titles.get('exact'), 'escaped');
});

test('CR46 unchanged title cache survives a new inventory process without transcript reads', (t) => {
  const sb = sandbox(t), file = join(sb.root, 'records.jsonl'), cache = join(sb.root, 'cache');
  writeFileSync(file, title('cached') + '{}\n'.repeat(200000));
  const cold = readJsonlTitles(file, ['exact'], 'custom-title', cache);
  assert.equal(cold.titles.get('exact'), 'cached');
  assert.ok(cold.bytesRead > 512 * 1024);
  const module = new URL('../src/agents/jsonl-titles.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {readJsonlTitles} from ${JSON.stringify(module)};const r=readJsonlTitles(...JSON.parse(process.argv[1]));process.stdout.write(JSON.stringify({title:r.titles.get('exact'),bytes:r.bytesRead,hit:r.cacheHit}));`,
    JSON.stringify([file, ['exact'], 'custom-title', cache])], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { title: 'cached', bytes: 0, hit: true });
  const payload = readFileSync(join(cache, readdirSync(cache)[0]), 'utf8');
  assert.equal(payload.includes('{}'), false, 'cache must not retain transcript messages');
});

test('CR46 append, rewrite, truncation and replacement invalidate cached names', (t) => {
  const sb = sandbox(t), file = join(sb.root, 'records.jsonl'), cache = join(sb.root, 'cache');
  const read = () => readJsonlTitles(file, ['exact'], 'custom-title', cache);
  writeFileSync(file, title('first')); assert.equal(read().titles.get('exact'), 'first');
  appendFileSync(file, title('second')); assert.equal(read().titles.get('exact'), 'second');
  // Growth must not be mistaken for append: the title at the front changed too.
  writeFileSync(file, title('rewritten') + '{}\n'.repeat(300000));
  assert.equal(read().titles.get('exact'), 'rewritten');
  writeFileSync(file, '{}\n'); assert.equal(read().titles.size, 0);
  const replacement = join(sb.root, 'replacement');
  writeFileSync(replacement, title('replacement')); renameSync(replacement, file);
  assert.equal(read().titles.get('exact'), 'replacement');
});

test('CR46 unusable or corrupt caches do not hide valid titles or share IDs', (t) => {
  const sb = sandbox(t), file = join(sb.root, 'records.jsonl'), cache = join(sb.root, 'cache');
  writeFileSync(file, title('valid'));
  readJsonlTitles(file, ['exact'], 'custom-title', cache);
  writeFileSync(join(cache, readdirSync(cache)[0]), '{');
  assert.equal(readJsonlTitles(file, ['exact'], 'custom-title', cache).titles.get('exact'), 'valid');
  const blocked = join(sb.root, 'not-a-directory'); writeFileSync(blocked, 'fixture');
  assert.equal(readJsonlTitles(file, ['exact'], 'custom-title', blocked).titles.get('exact'), 'valid');
  const other = readJsonlTitles(file, ['other'], 'custom-title', cache);
  assert.equal(other.cacheHit, false); assert.equal(other.titles.has('exact'), false);
});


test('CR46 a source rewritten during scanning cannot publish or cache an older name', (t) => {
  const sb = sandbox(t), file = join(sb.root, 'records.jsonl'), cache = join(sb.root, 'cache');
  writeFileSync(file, title('before'));
  const original = fs.readSync;
  let rewritten = false;
  t.mock.method(fs, 'readSync', (...args: Parameters<typeof fs.readSync>) => {
    const bytes = original(...args);
    if (!rewritten) { rewritten = true; writeFileSync(file, title('after-rewrite')); }
    return bytes;
  });
  syncBuiltinESMExports();
  try {
    assert.equal(readJsonlTitles(file, ['exact'], 'custom-title', cache).titles.size, 0);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(readJsonlTitles(file, ['exact'], 'custom-title', cache).titles.get('exact'), 'after-rewrite');
});
