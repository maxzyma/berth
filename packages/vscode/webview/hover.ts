/**
 * The hover card (spec §6): VS Code's hover look, Berth's own delay
 * (`berth.hover.delay`), since VS Code lets no extension change the delay of
 * its views. Text is set with textContent, never parsed.
 */
import type { HoverLine } from '../src/model.js';
import type { ViewSettings } from '../src/view/protocol.js';

const GAP = 4;
/** Room between the card and the hover for the pointer. */
const POINTER = 9;

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
    this.el.replaceChildren(...this.sections(lines, settings, agent));
    this.el.hidden = false;
    // Aligned with the card's icon column, just below the card; above when there is no room.
    const a = anchor.getBoundingClientRect();
    const column = anchor.querySelector('.icon')?.getBoundingClientRect().left ?? a.left;
    const left = Math.max(GAP, Math.min(column - 8, window.innerWidth - this.el.offsetWidth - GAP));
    this.el.style.left = `${left}px`;
    this.el.style.maxWidth = `${window.innerWidth - left - GAP}px`;
    const height = this.el.offsetHeight;
    const below = a.bottom + POINTER + height <= window.innerHeight;
    this.el.dataset.side = below ? 'below' : 'above';
    this.el.style.top = `${below ? a.bottom + POINTER : Math.max(GAP, a.top - POINTER - height)}px`;
    // The pointer sits under the card's icon.
    this.el.style.setProperty('--berth-pointer', `${Math.max(6, column + 1 - left)}px`);
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
        section.append(this.line(line));
      }
    }
    if (section.childElementCount) out.push(section);
    return out;
  }

  private header(line: HoverLine, settings: ViewSettings | undefined, agent: string): HTMLElement {
    const head = this.div('hover-head');
    if (agent && agent !== 'shell' && settings?.agentIcons) {
      const img = document.createElement('img');
      img.className = 'icon agent';
      img.alt = '';
      img.src = `${settings.agentIcons}/${agent}.svg`;
      head.append(img);
    } else if (line.icon) {
      head.append(this.icon(line.icon));
    }
    head.append(this.span('title', line.text));
    if (line.sub) head.append(this.span('sub', line.sub));
    if (line.chip) {
      const chip = this.span(`chip tone-${line.chip.tone || 'muted'}`, '');
      chip.append(this.icon(line.chip.icon), this.span('', line.chip.text));
      head.append(chip);
    }
    return head;
  }

  private line(line: HoverLine): HTMLElement {
    const row = this.div(`hover-line ${line.kind ?? ''}`);
    if (line.icon) row.append(this.icon(line.icon));
    const text = this.span('text', line.text);
    if (line.full) text.title = line.full;
    row.append(text);
    return row;
  }

  private icon(name: string): HTMLElement {
    return this.span(`codicon codicon-${name}`, '');
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
