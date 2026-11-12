// Minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
// One connection to the workbench page; child targets (webview iframes) are
// reached through flattened sessions.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function pageTarget(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find(t => t.type === 'page' && /workbench/.test(t.url));
      if (page) return page;
    } catch { /* the debugger endpoint is not up yet */ }
    await sleep(250);
  }
  throw new Error(`No VS Code workbench page on debugging port ${port} after ${timeoutMs} ms.`);
}

export class Cdp {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error(`Cannot connect to ${url}`)), { once: true });
    });
    return new Cdp(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => this.receive(JSON.parse(event.data)));
    socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
  }

  receive(message) {
    if (message.id !== undefined) {
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
      else call.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  on(method, listener) {
    const list = this.listeners.get(method) ?? [];
    this.listeners.set(method, [...list, listener]);
    return () => this.listeners.set(method, (this.listeners.get(method) ?? []).filter(l => l !== listener));
  }

  /** Evaluate an expression and return its JSON value; throws on page exceptions. */
  async evaluate(expression, sessionId) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Evaluation failed: ${detail}`);
    }
    return result.result.value;
  }

  /** Poll an expression until it returns a truthy value. */
  async waitFor(expression, { sessionId, timeoutMs = 20000, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const value = await this.evaluate(expression, sessionId);
        if (value) return value;
      } catch (error) { lastError = error; }
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`);
  }

  close() { this.socket.close(); }
}
