import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexScreen } from '../src/agents/codex-screen.js';
import { withCodexScreenActivity } from '../src/registry/codex-screen.js';
import { sessionProducers } from '../src/registry/discover.js';
import { processLifetime } from '../src/process-owner.js';
import { list } from '../src/registry/sessions.js';
import { shellQuote } from '../src/shell.js';
import { sandbox, waitFor } from './helpers.js';

const id = '11111111-2222-3333-4444-555555555555';
const running = '• Working (2m 59s • esc to interrupt)';
const footer = '  GPT-6 medium · Context 51% used · workspace';
const screen = (body: string, status = footer) => `${body}\n\n› Ask Codex to do anything\n\n${status}\n  ? for shortcuts\n`;

test('Codex current composer and running widget provide activity independently of identity', () => {
  assert.deepEqual(codexScreen(screen(running)), { working: true });
  assert.deepEqual(codexScreen(screen(`${running}\n\n  ⚠ weekly limit: 24% left`)), { working: true });
  assert.equal(codexScreen(screen('• Thinking (1s • esc to interrupt)'))?.working, true);
  assert.deepEqual(codexScreen(screen('• Result ready.')), { working: false });
  assert.equal(codexScreen(screen(`${running}\n\n• Result ready.`))?.working, false);
  assert.equal(codexScreen(`${running}\n\n› quoted prompt\nnot a native footer`), undefined);
  assert.equal(codexScreen(`${screen(running)}\nWould you like to proceed?`), undefined);
  assert.equal(codexScreen('• Working (1s • esc to interrupt)'), undefined);
  assert.equal(codexScreen(screen('• Waiting (1s)'))?.working, false);
});

test('Native footer UUID remains an identity candidate; truncation and body UUIDs never bind', () => {
  assert.deepEqual(codexScreen(screen(running, `  ${id} · Working`)), { working: true, conversationCandidate: id });
  assert.equal(codexScreen(screen(id))?.conversationCandidate, undefined);
  assert.equal(codexScreen(screen(running, `  ${id.slice(0, 29)}...`)), undefined);
  assert.equal(codexScreen(screen(running, `  ${id} · ${id}`)), undefined);
  assert.equal(codexScreen(`\x1b[31m${screen(running)}`), undefined);
});

test('Isolated pane observation changes display only and respects hook waits and producer identity', async t => {
  const sb = sandbox(t), ctx = sb.ctx();
  const path = join(sb.root, 'codex');
  writeFileSync(path, `process.stdout.write(${JSON.stringify(screen('› Review fixture\n\n' + running))});setInterval(()=>{},1000);`);
  ctx.tmux.newSession('screen', sb.root, `${shellQuote(process.execPath)} ${shellQuote(path)}`);
  sb.tmux('resize-window', '-t', '=screen:', '-x', '120', '-y', '30');
  const producer = await waitFor(() => sessionProducers(ctx, 'screen')[0], 'producer');
  const lifetime = processLifetime(producer.pid)!.key;
  ctx.tmux.setMeta('screen', { agent: 'codex', producerPane: producer.pane, producerLifetime: lifetime });
  await waitFor(() => codexScreen(sb.tmux('capture-pane', '-p', '-S', '0', '-t', producer.pane))?.working, 'native-shaped grid');
  const before = ctx.tmux.listSessions()[0].meta;
  assert.equal(withCodexScreenActivity(ctx, list(ctx))[0].state, 'working');
  assert.deepEqual(ctx.tmux.listSessions()[0].meta, before);
  assert.equal(withCodexScreenActivity(ctx, list(ctx))[0].conversation, '');
  assert.equal(withCodexScreenActivity(ctx, list(ctx))[0].topic, '');
  assert.equal(withCodexScreenActivity(ctx, list(ctx))[0].terminalPreview, 'Review fixture');
  ctx.tmux.setMeta('screen', { state: 'waiting', note: 'permission' });
  assert.equal(withCodexScreenActivity(ctx, list(ctx))[0].state, 'waiting');
  assert.equal(withCodexScreenActivity(ctx, list(ctx).map(row => ({ ...row, terminalPreview: 'old' })))[0].terminalPreview, undefined);
  ctx.tmux.setMeta('screen', { state: '', producerLifetime: 'stale' });
  assert.equal(withCodexScreenActivity(ctx, list(ctx))[0].state, '');
});


test('Visible prompt preview excludes drafts, commands, fenced output and missing response', () => {
  assert.equal(codexScreen(screen('› Explain this function\n\n• Checking the implementation.'))?.terminalPreview, 'Explain this function');
  assert.equal(codexScreen(screen('› first\n• reply\n› second\n• reply'))?.terminalPreview, 'second');
  for (const body of ['› /status\n• result', '› \n• result', '› no reply', '  › quoted\n• result', '```\n› quoted\n```\n• result']) {
    assert.equal(codexScreen(screen(body))?.terminalPreview, undefined);
  }
  assert.equal(codexScreen(screen('› older\n• result').replace('› Ask Codex to do anything', '› unsent draft'))?.terminalPreview, 'older');
  assert.equal(codexScreen(screen('› ' + '文'.repeat(150) + '\n• reply'))?.terminalPreview?.length, 120);
  assert.equal(codexScreen(screen('• prompt has scrolled away'))?.terminalPreview, undefined);
});


test('Default footer without context usage requires the native version header', () => {
  const body = '  >_ OpenAI Codex (v0.162.1)\n\n› Review the fixture\n\n◦ Working (1s • esc to interrupt)';
  const status = '  fixture-model default · fixture-project';
  assert.equal(codexScreen(screen(body, status))?.terminalPreview, 'Review the fixture');
  assert.equal(codexScreen(screen(running, status)), undefined);
});
