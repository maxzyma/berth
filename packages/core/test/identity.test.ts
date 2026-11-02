import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conversationTitle, titleLookup } from '../src/agents/titles.js';
import { processAncestry } from '../src/tmux/connections.js';
import { shellQuote } from '../src/shell.js';
import { sandbox } from './helpers.js';

test('client identity follows process ancestry, including manual shells', () => {
  const table = '10 1 /Applications/Visual Studio Code.app/Code Helper\n20 10 /bin/zsh\n30 20 tmux\n40 1 /Applications/iTerm.app/iTerm2\n50 40 tmux';
  assert.deepEqual(processAncestry(30, table), { ancestors: [30, 20, 10], application: 'VS Code' });
  assert.equal(processAncestry(50, table).application, 'iTerm2');
  assert.equal(processAncestry(60, table).application, '');
  assert.deepEqual(processAncestry(1, table).ancestors, []);
});

test('conversation title requires exact ID and uses latest rename', (t) => {
  const sb = sandbox(t);
  const root = sb.makeDir('codex');
  writeFileSync(join(root, 'session_index.jsonl'), [
    { id: 'a', thread_name: 'first' }, { id: 'b', thread_name: 'other' }, { id: 'a', thread_name: 'renamed' },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n{');
  const env = { ...sb.env, CODEX_HOME: root };
  assert.equal(conversationTitle('codex', '/workspace/product', 'a', env), 'renamed');
  assert.equal(conversationTitle('codex', '/workspace/product', 'missing', env), undefined);
  assert.equal(conversationTitle('codex', '/workspace/product', '', env), undefined);
  assert.equal(conversationTitle('codex', '/workspace/product', '../a', env), undefined);
});


test('Claude exact title survives long transcripts and later renames', (t) => {
  const sb = sandbox(t);
  const root = sb.makeDir('claude');
  const dir = sb.makeDir('claude/projects/-workspace-product');
  const file = join(dir, 'exact-id.jsonl');
  const initial = JSON.stringify({ type: 'custom-title', customTitle: 'job-2' }) + '\n';
  writeFileSync(file, initial + '{}\n'.repeat(200_000));
  const env = { ...sb.env, CLAUDE_CONFIG_DIR: root };
  assert.equal(conversationTitle('claude', '/workspace/product', 'exact-id', env), 'job-2');
  writeFileSync(file, initial + '{}\n'.repeat(200_000) + JSON.stringify({ type: 'custom-title', customTitle: 'renamed' }));
  assert.equal(conversationTitle('claude', '/workspace/product', 'exact-id', env), 'renamed');
});


test('Codex title inspection uses one read-only query per 5/20/100-row inventory', (t) => {
  const sb = sandbox(t);
  const root = sb.makeDir('codex-batch');
  const bin = sb.makeDir('bin');
  const calls = join(root, 'calls');
  const response = join(root, 'titles.json');
  const records = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, title: `Title ${i}` }));
  writeFileSync(join(root, 'state_5.sqlite'), 'fixture');
  writeFileSync(response, JSON.stringify(records));
  const script = join(bin, 'sqlite3');
  writeFileSync(script, `#!/bin/sh\n[ "$1" = '-readonly' ] || exit 7\nprintf 'query\n' >> ${shellQuote(calls)}\n/bin/cat ${shellQuote(response)}\n`);
  chmodSync(script, 0o755);
  // Newly written executables can spend over a second in OS startup before
  // executing any script code. Establish fixture readiness outside query checks.
  const ready = spawnSync(script, ['-readonly'], { env: sb.env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(ready.status, 0, `fixture startup: ${ready.error?.message ?? ready.stderr}`);
  for (const size of [5, 20, 100]) {
    writeFileSync(calls, '');
    const inputs = records.slice(0, size).map((row) => ({ agent: 'codex', conversation: row.id }));
    const started = performance.now();
    const title = titleLookup(inputs, { ...sb.env, CODEX_HOME: root, PATH: bin });
    for (const row of inputs) assert.equal(title('codex', '/workspace/project', row.conversation), records.find((r) => r.id === row.conversation)?.title);
    assert.equal(title('codex', '/workspace/project', 'not-requested'), undefined);
    assert.equal(readFileSync(calls, 'utf8').trim(), 'query');
    t.diagnostic(`${size} bound IDs: ${(performance.now() - started).toFixed(1)} ms; one read-only query (synthetic store)`);
  }
});
