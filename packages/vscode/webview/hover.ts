/**
 * The hover card (spec §6): VS Code's hover look, Berth's own delay
 * (`berth.hover.delay`), since VS Code lets no extension change the delay of
 * its views. Text is set with textContent, never parsed.
 */
import type { HoverLine } from '../src/model.js';
import type { ViewSettings } from '../src/view/protocol.js';

const GAP = 4;

export class HoverCard {
  delay = 500;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly el: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hover';
    this.el.setAttribute('role', 'tooltip');
    this.el.hidden = true;
    // Moving onto the card keeps it open, as VS Code's hovers do.
    this.el.addEventListener('mouseleave', () => this.hide());
    document.body.append(this.el);
    window.addEventListener('scroll', () => this.hide(), { passive: true });
    window.addEventListener('blur', () => this.hide());
  }

  schedule(anchor: HTMLElement, lines: HoverLine[], settings: ViewSettings | undefined, agent = ''): void {
    this.cancel();
    this.timer = setTimeout(() => this.show(anchor, lines, settings, agent), this.delay);
  }

  hide(): void {
    this.cancel();
    // Leave it open while the pointer is on the card itself.
    if (this.el.matches(':hover')) return;
    this.el.hidden = true;
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private show(anchor: HTMLElement, lines: HoverLine[], settings: ViewSettings | undefined, agent: string): void {
    this.el.replaceChildren(...lines.map((line) => this.line(line, settings, agent)));
    this.el.hidden = false;
    const a = anchor.getBoundingClientRect();
    const card = this.el.getBoundingClientRect();
    const below = a.bottom + GAP + card.height <= window.innerHeight;
    const top = below ? a.bottom + GAP : Math.max(GAP, a.top - GAP - card.height);
    const left = Math.max(GAP, Math.min(a.left + 16, window.innerWidth - card.width - GAP));
    this.el.style.top = `${top}px`;
    this.el.style.left = `${left}px`;
  }

  private line(line: HoverLine, settings: ViewSettings | undefined, agent: string): HTMLElement {
    if (line.kind === 'rule') return document.createElement('hr');
    const row = document.createElement('div');
    row.className = `hover-line ${line.kind ?? ''}`;
    if (line.kind === 'title' && agent && agent !== 'shell' && settings?.agentIcons) {
      const img = document.createElement('img');
      img.className = 'icon agent';
      img.alt = '';
      img.src = `${settings.agentIcons}/${agent}.svg`;
      row.append(img);
    } else if (line.icon) {
      const icon = document.createElement('span');
      icon.className = `codicon codicon-${line.icon}`;
      row.append(icon);
    }
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = line.text;
    row.append(text);
    if (line.sub) {
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = line.sub;
      row.append(sub);
    }
    return row;
  }
}
