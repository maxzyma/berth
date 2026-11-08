import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { setCodexThreadName } from '../src/agents/naming.js';
import { handleHook, type HookReply } from '../src/agents/hooks.js';
import { captureProfile } from '../src/agents/profile.js';
import { create, rename, stamp } from '../src/registry/sessions.js';
import { sandbox, waitFor } from './helpers.js';

type Reply = (request: { id?: number; method?: string; params?: Record<string, unknown> }) => object | undefined;

/** A stand-in for the Codex daemon's WebSocket control socket, at a short path like Codex's own. */
async function fakeDaemon(t: TestContext, reply: Reply): Promise<{ path: string; requests: { method?: string; params?: Record<string, unknown> }[] }> {
  const path = `/tmp/berth-test-${randomBytes(4).toString('hex')}.sock`;
  const requests: { method?: string; params?: Record<string, unknown> }[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = Buffer.alloc(0), upgraded = false;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const key = /Sec-WebSocket-Key: (\S+)/i.exec(buffer.subarray(0, end).toString())?.[1] ?? '';
        const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        upgraded = true;
        buffer = buffer.subarray(end + 4);
      }
      while (buffer.length >= 6) {
        const length = buffer[1] & 0x7f;
        const offset = length === 126 ? 4 : 2;
        const size = length === 126 ? buffer.readUInt16BE(2) : length;
        if (buffer.length < offset + 4 + size) return;
        const mask = buffer.subarray(offset, offset + 4);
        const payload = buffer.subarray(offset + 4, offset + 4 + size).map((byte, index) => byte ^ mask[index % 4]);
        buffer = buffer.subarray(offset + 4 + size);
        const request = JSON.parse(Buffer.from(payload).toString('utf8'));
        requests.push(request);
        const response = reply(request);
        if (response) {
          const data = Buffer.from(JSON.stringify(response));
          socket.write(Buffer.concat([Buffer.from([0x81, data.length < 126 ? data.length : 126]),
            data.length < 126 ? Buffer.alloc(0) : Buffer.from([data.length >> 8, data.length & 0xff]), data]));
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  t.after(() => { server.close(); rmSync(path, { force: true }); });
  return { path, requests };
}

const codexReplies: Reply = (request) => request.id === undefined ? undefined
  : { id: request.id, result: request.method === 'thread/name/set' && request.params?.threadId === 'missing' ? undefined : {},
    ...(request.params?.threadId === 'missing' ? { error: { message: 'thread not found' } } : {}) };

test('Codex protocol naming sends thread/name/set after initialization and reports failures', async (t) => {
  const daemon = await fakeDaemon(t, codexReplies);
  assert.equal(await setCodexThreadName(daemon.path, 'thread-1', '前端 重构'), true);
  assert.deepEqual(daemon.requests.map((request) => request.method), ['initialize', 'initialized', 'thread/name/set']);
  assert.deepEqual(daemon.requests[2].params, { threadId: 'thread-1', name: '前端 重构' });
  assert.equal(await setCodexThreadName(daemon.path, 'missing', 'x'), false);
  assert.equal(await setCodexThreadName('/tmp/berth-test-absent.sock', 'thread-1', 'x'), false);
  const silent = await fakeDaemon(t, () => undefined);
  assert.equal(await setCodexThreadName(silent.path, 'thread-1', 'x', 200), false);
});

test('rename gives a bound Codex conversation the new name through its running service only', async (t) => {
  const daemon = await fakeDaemon(t, codexReplies);
  const sb = sandbox(t);
  const home = join(sb.root, 'codex-home');
  mkdirSync(join(home, 'app-server-control'), { recursive: true });
  symlinkSync(daemon.path, join(home, 'app-server-control', 'app-server-control.sock'));
  sb.env.CODEX_HOME = home;
  const ctx = sb.ctx();
  create(ctx, { agent: 'shell', cwd: sb.root, name: 'before' });
  ctx.tmux.setMeta('before', { agent: 'codex' });
  stamp(ctx, 'before', { conversation: 'thread-1' });
  assert.equal(captureProfile('codex', sb.env).environment.CODEX_HOME, home);
  rename(ctx, 'before', '任务乙');
  await waitFor(() => daemon.requests.find((request) => request.method === 'thread/name/set'), 'thread name request');
  assert.deepEqual(daemon.requests.find((request) => request.method === 'thread/name/set')?.params, { threadId: 'thread-1', name: '任务乙' });

  const claude = sandbox(t), claudeCtx = claude.ctx();
  create(claudeCtx, { agent: 'shell', cwd: claude.root, name: 'plain' });
  claudeCtx.tmux.setMeta('plain', { agent: 'claude' });
  stamp(claudeCtx, 'plain', { conversation: 'claude-1' });
  const before = daemon.requests.length;
  rename(claudeCtx, 'plain', 'renamed');
  assert.equal(daemon.requests.length, before, 'agents without protocol naming are not contacted');
});

test('binding a Codex conversation keeps the title the agent generates', async (t) => {
  const daemon = await fakeDaemon(t, codexReplies);
  const sb = sandbox(t), ctx = sb.ctx();
  const home = join(sb.root, 'codex-home');
  mkdirSync(join(home, 'app-server-control'), { recursive: true });
  symlinkSync(daemon.path, join(home, 'app-server-control', 'app-server-control.sock'));
  ctx.tmux.newSession('project-2', sb.root, 'sleep 3600');
  ctx.tmux.setMeta('project-2', { agent: 'codex', cwd: sb.root });
  const socket = sb.tmux('display-message', '-p', '-t', '=project-2:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=project-2:', '#{pane_id}').trim();
  handleHook('codex', 'SessionStart', JSON.stringify({ session_id: 'thread-9' }), { ...sb.env, CODEX_HOME: home, TMUX: `${socket},1,0`, TMUX_PANE: pane });
  assert.equal(ctx.tmux.listSessions()[0].meta.conversation, 'thread-9');
  assert.deepEqual(daemon.requests, [], 'a default folder name never replaces the title Codex generates');
});

test('Claude takes a pending rename from its next prompt hook, once, without its terminal', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  ctx.tmux.newSession('before', sb.root, 'sleep 3600');
  ctx.tmux.setMeta('before', { agent: 'claude', cwd: sb.root });
  rename(ctx, 'before', '任务乙');
  assert.equal(ctx.tmux.listSessions()[0].meta.nameSync, '1');
  const socket = sb.tmux('display-message', '-p', '-t', '=任务乙:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=任务乙:', '#{pane_id}').trim();
  const env = { ...sb.env, TMUX: `${socket},1,0`, TMUX_PANE: pane };
  const compact: HookReply = {};
  handleHook('claude', 'SessionStart', JSON.stringify({ session_id: 'c-1', source: 'compact' }), env, compact);
  assert.deepEqual(compact, {}, 'a compaction start applies no title');
  const first: HookReply = {};
  handleHook('claude', 'UserPromptSubmit', JSON.stringify({ session_id: 'c-1', prompt: 'hi', session_title: 'before' }), env, first);
  assert.deepEqual(first, { sessionTitle: '任务乙' });
  assert.equal(ctx.tmux.listSessions()[0].meta.nameSync ?? '', '');
  const later: HookReply = {};
  handleHook('claude', 'UserPromptSubmit', JSON.stringify({ session_id: 'c-1', prompt: 'again', session_title: 'my own' }), env, later);
  assert.deepEqual(later, {}, 'a title the user sets in Claude afterwards is left alone');
});

test('a Codex rename made while its service is down is delivered by the next Codex hook', async (t) => {
  const sb = sandbox(t);
  const home = join(sb.root, 'codex-home');
  mkdirSync(join(home, 'app-server-control'), { recursive: true });
  sb.env.CODEX_HOME = home;
  const ctx = sb.ctx();
  ctx.tmux.newSession('before', sb.root, 'sleep 3600');
  ctx.tmux.setMeta('before', { agent: 'codex', cwd: sb.root });
  stamp(ctx, 'before', { conversation: 'thread-5' });
  rename(ctx, 'before', 'after');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(ctx.tmux.listSessions()[0].meta.nameSync, '1', 'still pending without a running service');
  const daemon = await fakeDaemon(t, codexReplies);
  symlinkSync(daemon.path, join(home, 'app-server-control', 'app-server-control.sock'));
  const socket = sb.tmux('display-message', '-p', '-t', '=after:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=after:', '#{pane_id}').trim();
  handleHook('codex', 'UserPromptSubmit', JSON.stringify({ session_id: 'thread-5', prompt: 'hi' }), { ...sb.env, TMUX: `${socket},1,0`, TMUX_PANE: pane });
  await waitFor(() => (ctx.tmux.listSessions()[0].meta.nameSync ?? '') === '', 'pending rename delivered');
  assert.deepEqual(daemon.requests.find((request) => request.method === 'thread/name/set')?.params, { threadId: 'thread-5', name: 'after' });
});
