import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lateBindingId } from '../src/agents/late-binding.js';
import { getAdapter } from '../src/agents/registry.js';
import { shellQuote } from '../src/shell.js';
import { sessionProducers } from '../src/registry/discover.js';
import { CLI, sandbox, waitFor } from './helpers.js';

const EVENTS = { claude: 'UserPromptSubmit', codex: 'UserPromptSubmit', gemini: 'BeforeAgent',
  opencode: 'session.status', copilot: 'userPromptSubmitted', cursor: 'beforeSubmitPrompt', kimi: 'UserPromptSubmit' };

test('late identity rejects foreign context, unknown events and contradictory aliases', () => {
  for (const [agent, event] of Object.entries(EVENTS)) {
    assert.equal(lateBindingId(agent, event, { session_id: 'root-id' }), 'root-id');
    for (const payload of [{ session_id: '' }, { session_id: 'bad\nvalue' },
      { session_id: 'root-id', conversation_id: 'other' }, { session_id: 'root-id', agent_id: 'child' },
      { session_id: 'root-id', parent_thread_id: 'parent' }]) {
      assert.equal(lateBindingId(agent, event, payload), undefined);
    }
    assert.equal(lateBindingId(agent, 'not-registered', { session_id: 'root-id' }), undefined);
  }
  for (const [agent, event] of Object.entries({ claude: 'Stop', codex: 'Stop', gemini: 'AfterAgent',
    opencode: 'session.idle', copilot: 'agentStop', cursor: 'stop', kimi: 'Stop' })) {
    const key = agent === 'cursor' ? 'conversation_id' : agent === 'copilot' ? 'sessionId' : 'session_id';
    assert.equal(lateBindingId(agent, event, { [key]: 'root-id' }), 'root-id');
  }
  assert.equal(lateBindingId('qoder', 'UserPromptSubmit', { session_id: 'id' }), undefined);
});

for (const [agent, event] of Object.entries(EVENTS)) {
  for (const adopted of [false, true]) test(`${agent} missed-start binding; previously adopted=${adopted}`, async t => {
    const sb = sandbox(t), ctx = sb.ctx();
    const script = join(sb.root, getAdapter(agent)!.binary), ack = join(sb.root, 'ack');
    // Native process naming and ancestry, with synthetic hook payloads only.
    writeFileSync(script, `const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
require('node:readline').createInterface({input:process.stdin}).on('line', input=>{
spawnSync(process.execPath,[${JSON.stringify(CLI)},'hook',${JSON.stringify(agent)},${JSON.stringify(event)}],{env:process.env,input,encoding:'utf8'});
fs.writeFileSync(${JSON.stringify(ack)},input);
});\n`);
    ctx.tmux.newSession('late', sb.root, `${shellQuote(process.execPath)} ${shellQuote(script)}`);
    await waitFor(() => sessionProducers(ctx, 'late')[0], 'synthetic producer');
    if (adopted) ctx.tmux.setMeta('late', { agent });
    const send = async (payload: object) => {
      const line = JSON.stringify(payload);
      sb.tmux('send-keys', '-t', '=late:', '-l', line);
      sb.tmux('send-keys', '-t', '=late:', 'Enter');
      await waitFor(() => existsSync(ack) && readFileSync(ack, 'utf8') === line, 'hook receipt');
    };
    await send({ session_id: 'child-id', agent_id: 'worker' });
    assert.equal(ctx.tmux.listSessions()[0].meta.conversation, undefined);
    const paneId = sb.tmux('display-message', '-p', '-t', '=late:', '#{pane_id}').trim();
    const socketPath = sb.tmux('display-message', '-p', '-t', '=late:', '#{socket_path}').trim();
    spawnSync(process.execPath, [CLI, 'hook', agent, event], { env: { ...sb.env,
      TMUX_PANE: paneId, TMUX: `${socketPath},1,0` }, input: JSON.stringify({ session_id: 'forged-id' }) });
    assert.equal(ctx.tmux.listSessions()[0].meta.conversation, undefined, 'unrelated caller cannot bind');
    await send({ session_id: 'root-id' });
    const meta = ctx.tmux.listSessions()[0].meta;
    assert.equal(meta.conversation, 'root-id');
    assert.ok(meta.profile);
    assert.ok(meta.producerLifetime);
    assert.equal(ctx.store.newest()?.sessions[0].conversation, 'root-id', 'durable without next inventory');
    await send({ session_id: 'other-id' });
    assert.equal(ctx.tmux.listSessions()[0].meta.conversation, 'root-id');
    const otherHome = sb.makeDir('other-profile');
    ctx.tmux.setMeta('late', { conversation: '', profile: JSON.stringify({ environment: { HOME: otherHome } }) });
    await send({ session_id: 'conflicting-profile' });
    assert.equal(ctx.tmux.listSessions()[0].meta.conversation, undefined);
    assert.equal(JSON.parse(ctx.tmux.listSessions()[0].meta.profile!).environment.HOME, otherHome);
    ctx.tmux.setMeta('late', { conversation: '', profile: '', recovery: 'starting' });
    await send({ session_id: 'pending-id' });
    assert.equal(ctx.tmux.listSessions()[0].meta.conversation, undefined);
    assert.equal(ctx.tmux.listSessions()[0].meta.recovery, 'starting');
  });
}
