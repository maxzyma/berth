// Synthetic Anthropic Messages API for the Berth demo capture.
//
// Serves canned, short replies so Claude Code can run in a demo without a real
// model or credentials. Binds to 127.0.0.1 only. Standalone use:
//
//   node scripts/demo/model-server.mjs [--port N] [--log FILE]
//
// then point Claude Code at it with ANTHROPIC_BASE_URL=http://127.0.0.1:N and
// any dummy ANTHROPIC_API_KEY.

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Replies are chosen by the newest prompt in the request that matches. */
export const REPLIES = [
  {
    match: /three focused test cases for cartTotal/i,
    text: 'Three cases for cartTotal:\n\n1. Empty cart returns 0.\n2. One item multiplies price by quantity.\n3. Multiple items sum their subtotals.\n\nKeep currency rounding at the display boundary.',
  },
  {
    match: /validation edge case/i,
    text: 'One validation edge case: `cartTotal` accepts a negative `quantity`, which lowers the total instead of failing.\n\nReject quantities below 1 before summing, and cover it with a test.',
  },
  {
    match: /clearer three-step flow/i,
    text: 'A clearer quickstart:\n\n1. Install the dependencies with `npm install`.\n2. Copy `.env.example` to `.env` and set `API_URL`.\n3. Run `npm run dev` and open the printed URL.\n\nMove troubleshooting after step 3.',
  },
  {
    match: /test for the negative quantity/i,
    pauseMs: 6000,
    text: "Here is the test:\n\n```ts\ntest('rejects a negative quantity', () => {\n  expect(() => cartTotal([{ sku: 'a', price: 5, quantity: -1 }]))\n    .toThrow(RangeError);\n});\n```\n\nIt fails until `cartTotal` checks quantities.",
  },
];

const FALLBACK = 'Done.';
const MODEL = 'claude-sonnet-demo';

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block?.type === 'text').map(block => block.text).join('\n');
}

/** The reply for the newest user message that matches a canned prompt. */
export function chooseReply(body) {
  const users = (body.messages ?? []).filter(message => message.role === 'user');
  const last = users.length ? textOf(users[users.length - 1].content) : '';
  return REPLIES.find(reply => reply.match.test(last)) ?? { text: FALLBACK };
}

function message(model, content, outputTokens) {
  return {
    id: `msg_demo_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: content.length ? 'end_turn' : null,
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: outputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Split text into word-sized chunks so the terminal visibly streams. */
function chunks(text) {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

async function stream(res, model, reply) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  send('message_start', { message: message(model, [], 1) });
  send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  send('ping', {});
  await sleep(reply.pauseMs ?? 1500);
  const parts = chunks(reply.text);
  for (const part of parts) {
    if (res.destroyed) return;
    send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: part } });
    await sleep(reply.chunkMs ?? 60);
  }
  send('content_block_stop', { index: 0 });
  send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: parts.length } });
  send('message_stop', {});
  res.end();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

/** Start the server; resolves with its port and a close function. */
export function startModelServer({ port = 0, log } = {}) {
  const record = entry => { if (log) appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); };
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    try {
      if (req.method === 'POST' && path === '/v1/messages/count_tokens') return json(res, 200, { input_tokens: 120 });
      if (req.method === 'POST' && path === '/v1/messages') {
        const body = await readJson(req);
        const reply = chooseReply(body);
        record({ path, stream: !!body.stream, model: body.model, reply: reply.text.slice(0, 40) });
        if (body.stream) return await stream(res, body.model ?? MODEL, reply);
        return json(res, 200, message(body.model ?? MODEL, [{ type: 'text', text: reply.text }], 20));
      }
      record({ path, method: req.method, status: 404 });
      return json(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'Not served by the demo model.' } });
    } catch (error) {
      record({ path, error: String(error) });
      if (!res.headersSent) json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: String(error) } });
      else res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      port: server.address().port,
      close: () => new Promise(done => { server.closeAllConnections(); server.close(() => done()); }),
    }));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const { port } = await startModelServer({ port: Number(arg('--port') ?? 0), log: arg('--log') });
  process.stdout.write(`demo model listening on http://127.0.0.1:${port}\n`);
}
