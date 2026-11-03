/** A single owner for details visibility, pointer transit, focus and source updates. */
import { agentIcon, codicon, hostIcon } from './icons.js';
import type { HoverLine } from '../src/model.js';
import type { ViewSettings } from '../src/view/protocol.js';
import { horizontalPosition, verticalPosition, inBridge, inside, type Point } from './hoverPosition.js';

type Request = { anchor: HTMLElement; lines: HoverLine[]; settings?: ViewSettings; agent: string };
const CLOSE_DELAY = 180;

export class HoverCard {
  delay = 500;
  private opening?: ReturnType<typeof setTimeout>;
  private closing?: ReturnType<typeof setTimeout>;
  private pending?: Request;
  private active?: Request;
  private dismissed?: HTMLElement;
  private signature = '';
  private pointer?: Point;
  private dismissedPointer?: Point;
  private readonly el = document.createElement('div');
  private readonly content = document.createElement('div');
  private readonly copyStatus = document.createElement('div');
  private readonly events = new AbortController();

  constructor(
    private readonly onVisibility: (visible: boolean) => void = () => {},
    private readonly copyValue: (value: string) => Promise<void> = (value) => navigator.clipboard.writeText(value),
    private readonly checkRecovery: (session: string) => void = () => {},
  ) {
    this.el.id = 'berth-hover';
    this.el.className = 'hover';
    this.el.setAttribute('role', 'dialog');
    this.el.dataset.vscodeContext = JSON.stringify({ webviewSection: 'details', preventDefaultContextMenuItems: false });
    this.el.setAttribute('aria-modal', 'false');
    this.el.setAttribute('aria-labelledby', 'berth-hover-title');
    this.el.hidden = true;
    this.content.className = 'hover-content';
    this.content.tabIndex = 0;
    this.content.setAttribute('aria-label', 'Details. Escape closes; Shift+Tab returns to the session.');
    const close = document.createElement('button');
    close.className = 'hover-close codicon codicon-close';
    close.setAttribute('aria-label', 'Close details');
    close.addEventListener('click', () => this.dismiss(true));
    this.copyStatus.className = 'hover-copy-status';
    this.copyStatus.setAttribute('role', 'status');
    this.copyStatus.setAttribute('aria-live', 'polite');
    this.el.append(this.content, this.copyStatus, close);
    document.body.append(this.el);
    const options = { signal: this.events.signal };
    document.addEventListener('pointermove', (e) => this.trackPointer(e), options);
    document.documentElement.addEventListener('pointerleave', () => { this.pointer = undefined; this.scheduleClose(); }, options);
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.contains(e.target as Node)) this.hide();
    }, options);
    document.addEventListener('keydown', (e) => this.key(e), options);
    document.addEventListener('focusin', () => this.focusChanged(), options);
    document.addEventListener('contextmenu', (e) => {
      if (!this.el.contains(e.target as Node)) this.hide();
    }, options);
    document.addEventListener('scroll', (e) => {
      if (!this.el.contains(e.target as Node)) this.hide();
    }, { ...options, capture: true, passive: true });
    window.addEventListener('blur', () => this.hide(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.hide(); }, options);
    window.addEventListener('resize', () => this.position(), options);
  }

  schedule(anchor: HTMLElement, lines: HoverLine[], settings: ViewSettings | undefined, agent = '', event?: MouseEvent): void {
    if (this.el.contains(document.activeElement)) return;
    if (event && this.dismissedPointer
      && Math.hypot(event.clientX - this.dismissedPointer.x, event.clientY - this.dismissedPointer.y) < 2) return;
    if (this.dismissed === anchor) {
      if (event?.type !== 'mouseenter') return;
      this.dismissed = undefined;
    }
    if (this.dismissed && this.dismissed !== anchor) this.dismissed = undefined;
    if (event && this.active && this.active.anchor !== anchor && this.bridge({ x: event.clientX, y: event.clientY })) return;
    if (this.active?.anchor === anchor) { this.cancelClose(); return; }
    if (this.pending?.anchor === anchor) return;
    this.hide();
    this.pending = { anchor, lines, settings, agent };
    this.opening = setTimeout(() => {
      const request = this.pending;
      if (request?.anchor.isConnected) this.show(request);
    }, this.delay);
  }

  leave(anchor: HTMLElement): void {
    if (this.dismissed === anchor) this.dismissed = undefined;
    if (this.pending?.anchor === anchor && document.activeElement !== anchor) this.cancelOpen();
    this.scheduleClose();
  }

  /** Explicit close: it must work even when the pointer is still on the card. */
  hide(): void {
    this.cancelOpen();
    this.cancelClose();
    this.active?.anchor.removeAttribute('aria-controls');
    this.active?.anchor.removeAttribute('aria-describedby');
    this.active = undefined;
    if (!this.el.hidden) this.onVisibility(false);
    this.el.hidden = true;
  }

  dispose(): void {
    this.hide();
    this.events.abort();
    this.el.remove();
  }

  /** Tab from the row enters details without activating the underlying session. */
  focus(): boolean {
    if (this.pending) this.show(this.pending);
    if (!this.active) return false;
    this.content.focus({ preventScroll: true });
    return true;
  }

  get anchorId(): string | undefined { return this.active?.anchor.id ?? this.pending?.anchor.id; }

  update(request?: Request): void {
    if (!request) { this.hide(); return; }
    if (this.pending) this.pending = request;
    if (!this.active) return;
    this.active = request;
    const signature = JSON.stringify([request.lines, request.settings?.agentIcons, request.settings?.hostIcons, request.agent]);
    if (signature !== this.signature) this.render(request, true);
    this.position();
  }

  private show(request: Request): void {
    this.cancelOpen();
    this.cancelClose();
    this.active = request;
    this.render(request);
    this.el.hidden = false;
    this.onVisibility(true);
    request.anchor.setAttribute('aria-controls', this.el.id);
    request.anchor.setAttribute('aria-describedby', this.el.id);
    this.position();
  }

  private render(request: Request, preserve = false): void {
    this.signature = JSON.stringify([request.lines, request.settings?.agentIcons, request.settings?.hostIcons, request.agent]);
    const focused = preserve && this.content.contains(document.activeElement) ? document.activeElement : undefined;
    const label = focused?.getAttribute('aria-label');
    const value = focused instanceof HTMLElement ? focused.dataset.copyValue : undefined;
    const previousMatches = [...this.content.querySelectorAll('button')].filter((button) => button.getAttribute('aria-label') === label).length;
    const scrollTop = preserve ? this.content.scrollTop : 0;
    this.copyStatus.textContent = '';
    this.content.replaceChildren(...this.sections(request.lines, request.settings, request.agent));
    if (focused) {
      const matches = label ? [...this.content.querySelectorAll<HTMLButtonElement>('button')]
        .filter((button) => button.getAttribute('aria-label') === label) : [];
      const replacement = matches.find((button) => button.dataset.copyValue === value)
        ?? (previousMatches === 1 && matches.length === 1 ? matches[0] : undefined);
      (replacement ?? this.content).focus({ preventScroll: true });
    }
    this.content.scrollTop = scrollTop;
  }

  private position(): void {
    if (!this.active || this.el.hidden) return;
    const anchor = this.active.anchor;
    if (!anchor.isConnected) { this.hide(); return; }
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) { this.hide(); return; }
    const column = anchor.querySelector('.icon')?.getBoundingClientRect().left ?? rect.left;
    const horizontal = horizontalPosition(column, window.innerWidth);
    this.el.style.left = `${horizontal.left}px`;
    this.el.style.width = `${horizontal.width}px`;
    const footerHeight = this.copyStatus.getBoundingClientRect().height;
    const vertical = verticalPosition(rect, this.content.scrollHeight + footerHeight + 2, window.innerHeight);
    this.content.style.maxHeight = `${Math.max(0, vertical.maxHeight - footerHeight - 2)}px`;
    this.el.dataset.side = vertical.side;
    this.el.style.top = `${vertical.top}px`;
    const name = anchor.querySelector('.name')?.getBoundingClientRect();
    const target = name ? name.left + Math.min(24, name.width / 2) : column + 32;
    this.el.style.setProperty('--berth-pointer', `${Math.max(6, Math.min(target - horizontal.left - 7, horizontal.width - 20))}px`);
  }

  private bridge(point: Point): boolean {
    return !!this.active && !this.el.hidden && this.el.dataset.side !== 'overlay'
      && inBridge(point, this.active.anchor.getBoundingClientRect(), this.el.getBoundingClientRect());
  }

  private retained(): boolean {
    if (!this.active) return false;
    const focus = document.activeElement;
    if (this.el.contains(focus) || focus === this.active.anchor) return true;
    return !!this.pointer && (inside(this.pointer, this.el.getBoundingClientRect())
      || inside(this.pointer, this.active.anchor.getBoundingClientRect()) || this.bridge(this.pointer));
  }

  private trackPointer(event: PointerEvent): void {
    this.pointer = { x: event.clientX, y: event.clientY };
    if (this.dismissedPointer && Math.hypot(this.pointer.x - this.dismissedPointer.x, this.pointer.y - this.dismissedPointer.y) >= 2) this.dismissedPointer = undefined;
    if (event.buttons) return; // Keep selection drags alive, including outside the card.
    if (this.retained()) this.cancelClose();
    else this.scheduleClose();
  }

  private focusChanged(): void {
    if (this.dismissed && document.activeElement !== this.dismissed && !this.dismissed.matches(':hover')) this.dismissed = undefined;
    if (this.pending && document.activeElement !== this.pending.anchor && !this.pending.anchor.matches(':hover')) this.cancelOpen();
    if (this.retained()) this.cancelClose();
    else this.scheduleClose();
  }

  private scheduleClose(): void {
    if (!this.active || this.closing || this.retained()) return;
    this.closing = setTimeout(() => {
      this.closing = undefined;
      if (!this.retained()) this.hide();
    }, CLOSE_DELAY);
  }

  dismiss(returnFocus = this.el.contains(document.activeElement)): void {
    const anchor = this.active?.anchor ?? this.pending?.anchor;
    this.dismissed = anchor;
    this.dismissedPointer = this.pointer;
    this.hide();
    if (returnFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  }

  private key(event: KeyboardEvent): void {
    if (event.key === 'Escape' && (this.active || this.pending)) {
      const inside = this.el.contains(document.activeElement);
      event.preventDefault();
      event.stopPropagation();
      this.dismiss(inside);
    } else if (event.key === 'Tab' && event.shiftKey && document.activeElement === this.content) {
      event.preventDefault();
      this.dismiss(true);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && this.el.contains(document.activeElement)) {
      event.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(this.content);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  private cancelOpen(): void {
    clearTimeout(this.opening);
    this.opening = undefined;
    this.pending = undefined;
  }

  private cancelClose(): void {
    clearTimeout(this.closing);
    this.closing = undefined;
  }

  /** Header, then the body lines, then a details section after the rule. */
  private sections(lines: HoverLine[], settings: ViewSettings | undefined, agent: string): HTMLElement[] {
    const out: HTMLElement[] = [];
    let section = this.div('hover-body');
    for (const line of lines) {
      if (line.kind === 'title') {
        out.push(this.header(line, settings, agent));
      } else if (line.kind === 'rule') {
        if (section.childElementCount) out.push(section);
        section = this.div('hover-meta');
      } else {
        section.append(this.line(line, settings));
        if (line.checkRecoveryFor) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'hover-recovery';
          button.textContent = 'Check Recovery Readiness';
          button.addEventListener('click', () => {
            this.hide();
            this.checkRecovery(line.checkRecoveryFor!);
          });
          section.append(button);
        }
      }
    }
    if (section.childElementCount) out.push(section);
    return out;
  }

  private header(line: HoverLine, settings: ViewSettings | undefined, agent: string): HTMLElement {
    const head = this.div('hover-head');
    if (line.sub) head.append(agentIcon(agent, settings?.agentIcons));
    else if (line.icon) head.append(this.icon(line.icon));
    const title = this.span('title', line.text);
    title.id = 'berth-hover-title';
    head.append(title);
    if (line.copyValue !== undefined) head.append(this.copyButton(line.copyValue, line.copyLabel ?? 'value'));
    const summary = this.div('hover-summary');
    if (line.sub) {
      summary.append(this.span('sub', line.sub));
      if (agent) summary.append(this.copyButton(line.sub, 'agent name'));
    }
    if (line.chip) {
      const chip = this.span(`chip tone-${line.chip.tone || 'muted'}`, '');
      chip.append(this.icon(line.chip.icon), this.span('', line.chip.text));
      summary.append(chip);
    }
    if (summary.childElementCount) head.append(summary);
    return head;
  }

  private line(line: HoverLine, settings?: ViewSettings): HTMLElement {
    const row = this.div(`hover-line ${line.kind ?? ''}`);
    if (line.icon) row.append(hostIcon(line.icon, line.hostApplication, settings?.hostIcons, line.currentWindow));
    const text = this.span('text', line.full ?? line.text);
    row.append(text);
    if (line.copyValue !== undefined) row.append(this.copyButton(line.copyValue, line.copyLabel ?? 'value'));
    return row;
  }

  private copyButton(value: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'hover-copy';
    button.dataset.copyValue = value;
    button.type = 'button';
    button.title = `Copy ${label}`;
    button.setAttribute('aria-label', button.title);
    button.append(codicon('copy'));
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (button.getAttribute('aria-disabled') === 'true') return;
      const signature = this.signature;
      button.setAttribute('aria-disabled', 'true');
      this.copyStatus.textContent = 'Copying…';
      try {
        await this.copyValue(value);
        if (button.isConnected && signature === this.signature) this.copyStatus.textContent = `Copied ${label}.`;
      } catch {
        if (button.isConnected && signature === this.signature) this.copyStatus.textContent = 'Could not copy. Try again.';
      } finally {
        button.removeAttribute('aria-disabled');
        this.position();
      }
    });
    return button;
  }

  private icon(name: string): HTMLElement {
    return codicon(name);
  }

  private span(className: string, text: string): HTMLElement {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  }

  private div(className: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = className;
    return el;
  }
}
