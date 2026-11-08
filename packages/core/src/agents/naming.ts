import { randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { getAdapter } from './registry.js';
import { profileEnvironment, readProfile } from './profile.js';
import { agentRoot } from './roots.js';
import type { Context } from '../context.js';

/**
 * Protocol naming (spec §4.2.1): give a session's bound conversation the
 * session name through the agent's own interface, without touching its
 * terminal. Best effort: false when the agent has no such interface, the
 * conversation is unbound, or the agent's service is not running.
 */
export async function nameConversation(ctx: Context, session: string): Promise<boolean> {
  const live = ctx.tmux.listSessions().find((row) => row.name === session);
  const agent = live?.meta.agent;
  const conversation = live?.meta.conversation;
  if (!agent || !conversation || getAdapter(agent)?.naming?.protocol !== 'codex-app-server') return false;
  const profile = readProfile(agent, live.meta.profile);
  const socket = join(agentRoot(agent, profile ? profileEnvironment(agent, profile, ctx.env) : ctx.env), 'app-server-control', 'app-server-control.sock');
  // Connect only to a running service; never start one. The link in the agent
  // home can exceed the Unix socket path limit; its target is kept short.
  return existsSync(socket) ? setCodexThreadName(realpathSync(socket), conversation, session) : false;
}

/** Codex app-server JSON-RPC over the daemon's WebSocket control socket (verified with Codex 0.166). */
export function setCodexThreadName(socketPath: string, threadId: string, name: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    let settled = false, upgraded = false, buffer: Buffer = Buffer.alloc(0);
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const send = (message: object) => socket.write(textFrame(JSON.stringify(message)));
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
    socket.on('connect', () => socket.write(['GET / HTTP/1.1', 'Host: localhost', 'Connection: Upgrade', 'Upgrade: websocket',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`, 'Sec-WebSocket-Version: 13', '', ''].join('\r\n')));
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        if (!buffer.subarray(0, end).toString().startsWith('HTTP/1.1 101')) return finish(false);
        upgraded = true;
        buffer = buffer.subarray(end + 4);
        send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'berth', version: '1' }, capabilities: null } });
      }
      for (let next = readFrame(buffer); next; next = readFrame(buffer)) {
        buffer = next.rest;
        if (next.opcode === 8) return finish(false);
        if (next.opcode !== 1) continue;
        let message: { id?: unknown; error?: unknown };
        try { message = JSON.parse(next.payload.toString('utf8')) as typeof message; }
        catch { return finish(false); }
        if (message.id === 1) {
          if (message.error) return finish(false);
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'thread/name/set', params: { threadId, name } });
        } else if (message.id === 2) return finish(!message.error);
      }
    });
  });
}

/** A masked, unfragmented client text frame (RFC 6455 §5.2). */
function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length < 126 ? Buffer.from([0x80 | payload.length])
    : payload.length < 65536 ? Buffer.from([0x80 | 126, payload.length >> 8, payload.length & 0xff])
      : Buffer.concat([Buffer.from([0x80 | 127]), bigLength(payload.length)]);
  const mask = randomBytes(4);
  return Buffer.concat([Buffer.from([0x81]), length, mask, payload.map((byte, index) => byte ^ mask[index % 4])]);
}

function bigLength(length: number): Buffer {
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(length));
  return value;
}

/** One complete server frame (unmasked), or undefined while more bytes are needed. */
function readFrame(data: Buffer): { opcode: number; payload: Buffer; rest: Buffer } | undefined {
  if (data.length < 2) return undefined;
  let length = data[1] & 0x7f, offset = 2;
  if (length === 126) {
    if (data.length < 4) return undefined;
    length = data.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (data.length < 10) return undefined;
    length = Number(data.readBigUInt64BE(2));
    offset = 10;
  }
  if (data.length < offset + length) return undefined;
  return { opcode: data[0] & 0x0f, payload: data.subarray(offset, offset + length), rest: data.subarray(offset + length) };
}
