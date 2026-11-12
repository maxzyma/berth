// Drives the isolated VS Code workbench through CDP: synthetic input events
// go to this window only (never to the OS), so the window never needs focus.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cdp, pageTarget } from './cdp.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  F1: { code: 'F1', keyCode: 112 },
};

/** A pointer drawn in the page, because synthetic mouse events have no visible cursor. */
const POINTER_SCRIPT = `(() => {
  if (document.getElementById('demo-pointer')) return true;
  const el = document.createElement('div');
  el.id = 'demo-pointer';
  el.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;display:none;transform:translate(-2px,-1px)';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); svg.setAttribute('viewBox', '0 0 22 22');
  const path = document.createElementNS(ns, 'path');
  const attributes = { d: 'M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10 13 L16 13 Z', fill: '#fff', stroke: '#000', 'stroke-width': '1.3', 'stroke-linejoin': 'round' };
  for (const [name, value] of Object.entries(attributes)) path.setAttribute(name, value);
  svg.appendChild(path);
  el.appendChild(svg);
  document.body.appendChild(el);
  return true;
})()`;

export class Workbench {
  static async connect(port, log) {
    const page = await pageTarget(port);
    const workbench = new Workbench(await Cdp.connect(page.webSocketDebuggerUrl), port, log);
    await workbench.cdp.send('Page.enable');
    await workbench.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // The terminal's GPU renderer only draws correctly at the display's own scale.
    workbench.scale = await workbench.cdp.evaluate('devicePixelRatio');
    log(`window scale ${workbench.scale}`);
    return workbench;
  }

  constructor(cdp, port, log) {
    this.cdp = cdp;
    this.port = port;
    this.log = log;
    this.pointer = { x: 700, y: 420 };
  }

  /**
   * Render the workbench at an exact CSS size, independent of the OS window.
   * It renders at the display's scale; screenshots and the screencast are
   * scaled to CSS pixels.
   */
  async viewport(width, height) {
    this.size = { width, height };
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: this.scale, mobile: false });
    await this.cdp.waitFor(`innerWidth === ${width} && innerHeight === ${height}`, { label: `${width}x${height} viewport` });
    await sleep(300);
  }

  evaluate(expression) { return this.cdp.evaluate(expression); }
  waitFor(expression, options) { return this.cdp.waitFor(expression, options); }

  async key(name, modifiers = 0) {
    const key = KEYS[name];
    const base = { key: name, code: key.code, windowsVirtualKeyCode: key.keyCode, modifiers };
    await this.cdp.send('Input.dispatchKeyEvent', { type: key.text ? 'keyDown' : 'rawKeyDown', ...base, ...(key.text ? { text: key.text } : {}) });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  /** Type like a person: one key event per character. */
  async type(text, delayMs = 70) {
    for (const char of text) {
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char, unmodifiedText: char });
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
      await sleep(delayMs);
    }
  }

  /** Run a command through the Command Palette. */
  async command(title) {
    await this.key('F1');
    await this.waitFor(`!!document.querySelector('.quick-input-widget:not([style*="display: none"]) input')`, { label: 'Command Palette' });
    await this.cdp.send('Input.insertText', { text: title });
    await this.waitFor(`[...document.querySelectorAll('.quick-input-list .monaco-list-row')].some(r => r.getAttribute('aria-label')?.startsWith(${JSON.stringify(title)}))`, { label: `command ${title}` });
    await this.key('Enter');
    await sleep(400);
  }

  async showPointer(visible) {
    await this.evaluate(POINTER_SCRIPT);
    await this.evaluate(`document.getElementById('demo-pointer').style.display = ${JSON.stringify(visible ? 'block' : 'none')}`);
  }

  async movePointerTo(x, y, durationMs = 0) {
    const from = { ...this.pointer };
    const steps = Math.max(1, Math.round(durationMs / 16));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      const px = from.x + (x - from.x) * ease;
      const py = from.y + (y - from.y) * ease;
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py });
      await this.evaluate(`(p => { if (p) { p.style.left = '${px}px'; p.style.top = '${py}px'; } })(document.getElementById('demo-pointer'))`);
      if (steps > 1) await sleep(16);
    }
    this.pointer = { x, y };
  }

  async click(x, y, durationMs = 0) {
    await this.movePointerTo(x, y, durationMs);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  async drag(from, to) {
    await this.movePointerTo(from.x, from.y);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
      const x = from.x + (to.x - from.x) * i / 10, y = from.y + (to.y - from.y) * i / 10;
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      await sleep(20);
    }
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    this.pointer = { ...to };
  }

  /** Centre of the first visible element matching a selector (and exact text, if given). */
  async center(selector, text, { timeoutMs = 20000 } = {}) {
    const expression = `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && (${JSON.stringify(text ?? null)} === null || e.textContent.trim() === ${JSON.stringify(text ?? '')});
      });
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    })()`;
    return this.waitFor(expression, { timeoutMs, label: `${selector}${text ? ` "${text}"` : ''}` });
  }

  async clickElement(selector, text, durationMs = 0) {
    const { x, y } = await this.center(selector, text);
    await this.click(x, y, durationMs);
  }

  /** A connection to the Berth sessions webview (an out-of-process iframe). */
  async sessionsView() {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const targets = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
      const webviews = targets.filter(t => t.type === 'iframe' && t.url.startsWith('vscode-webview://'));
      const frame = webviews.find(t => t.url.includes('berthdev.berth')) ?? (webviews.length === 1 ? webviews[0] : undefined);
      if (frame) {
        if (this.view?.url !== frame.url) {
          this.view?.cdp.close();
          this.view = { url: frame.url, cdp: await Cdp.connect(frame.webSocketDebuggerUrl) };
        }
        return this.view.cdp;
      }
      await sleep(200);
    }
    throw new Error('The Berth sessions view did not load.');
  }

  /** Evaluate inside the view's content frame; `doc` is its document. */
  async inView(body) {
    const view = await this.sessionsView();
    return view.evaluate(`(() => { const doc = document.getElementById('active-frame')?.contentDocument; if (!doc) return null; ${body} })()`);
  }

  /** Page coordinates of a point inside a session row (or of its rectangle). */
  async sessionRow(name, { timeoutMs = 20000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = await this.inView(`
        const row = [...doc.querySelectorAll('.row.card')].find(r => r.querySelector('.name')?.textContent.trim() === ${JSON.stringify(name)});
        if (!row) return null;
        const b = row.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height, className: row.className };`).catch(() => null);
      const frame = await this.evaluate(`(() => { const f = [...document.querySelectorAll('iframe.webview')].find(f => f.getBoundingClientRect().width > 0); if (!f) return null; const b = f.getBoundingClientRect(); return { x: b.x, y: b.y }; })()`);
      if (row && frame) return { ...row, x: frame.x + row.x, y: frame.y + row.y };
      await sleep(200);
    }
    throw new Error(`Session row ${name} is not shown.`);
  }

  /** Page coordinates of the centre of an element inside the sessions view. */
  async viewElementCenter(selector) {
    const inner = await this.inView(`
      const el = doc.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;`);
    const frame = await this.evaluate(`(() => { const f = [...document.querySelectorAll('iframe.webview')].find(f => f.getBoundingClientRect().width > 0); const b = f?.getBoundingClientRect(); return b ? { x: b.x, y: b.y } : null; })()`);
    return inner && frame ? { x: Math.round(frame.x + inner.x), y: Math.round(frame.y + inner.y) } : null;
  }

  /** Wait until the session details card shows (or, with null, hides). */
  async waitForDetails(name, timeoutMs = 10000) {
    const view = await this.sessionsView();
    const card = `document.getElementById('active-frame')?.contentDocument.querySelector('.hover')`;
    const shown = `(c => !!c && !c.hidden && c.getBoundingClientRect().height > 0)(${card})`;
    const expression = name === null ? `!${shown}` : `${shown} && ${card}.textContent.includes(${JSON.stringify(name)})`;
    await view.waitFor(expression, { label: name === null ? 'details card to close' : `${name} details`, timeoutMs });
  }

  async screenshot(file) {
    const clip = { x: 0, y: 0, ...this.size, scale: 1 / this.scale };
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
    writeFileSync(file, Buffer.from(data, 'base64'));
    this.log(`wrote ${file}`);
  }

  /** Record compositor frames with their timestamps until stopScreencast. */
  async startScreencast(dir, { width, height }) {
    this.frames = [];
    this.stopFrames = this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = join(dir, `frame-${String(this.frames.length).padStart(6, '0')}.jpg`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      this.frames.push({ file, time: metadata.timestamp });
      void this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    this.screencastStarted = Date.now() / 1000;
  }

  async stopScreencast() {
    await this.cdp.send('Page.stopScreencast');
    this.stopFrames?.();
    return { frames: this.frames, end: Date.now() / 1000 };
  }

  close() {
    this.view?.cdp.close();
    this.cdp.close();
  }
}
