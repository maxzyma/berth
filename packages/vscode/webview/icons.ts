/** Shared icon rendering for session rows and details. Sources live in THIRD_PARTY_NOTICES.md. */
const AGENT_MARKS: Readonly<Record<string, { file: string; artwork?: boolean; light?: string }>> = {
  claude: { file: 'claude.svg' }, codex: { file: 'codex.svg' },
  cursor: { file: 'cursor.svg', artwork: true, light: 'cursor-light.svg' },
  copilot: { file: 'copilot.png', artwork: true },
  gemini: { file: 'gemini.png', artwork: true }, kimi: { file: 'kimi.png', artwork: true },
  qoder: { file: 'qoder.svg', artwork: true },
  opencode: { file: 'opencode.svg', artwork: true, light: 'opencode-light.svg' },
};

export function codicon(name: string): HTMLElement {
  const [glyph, modifier] = name.split('~');
  const icon = document.createElement('span');
  icon.className = `codicon codicon-${glyph}${modifier === 'spin' ? ' codicon-modifier-spin' : ''}`;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

export function agentIcon(agent: string, baseUri?: string): HTMLElement {
  if (!baseUri || !Object.hasOwn(AGENT_MARKS, agent)) {
    const icon = codicon('terminal');
    icon.classList.add('icon');
    return icon;
  }
  const asset = AGENT_MARKS[agent];
  const icon = document.createElement('span');
  icon.className = `icon agent${asset.artwork ? ' agent-artwork' : ''}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.style.setProperty('--agent-mark', `url(${JSON.stringify(`${baseUri}/${asset.file}`)})`);
  if (asset.light) icon.style.setProperty('--agent-mark-light', `url(${JSON.stringify(`${baseUri}/${asset.light}`)})`);
  return icon;
}

/** Host products keep their original artwork; unknown/failed assets retain the semantic glyph. */
export function hostIcon(glyph: string, application?: string, assets?: Record<string, string>, currentWindow = false): HTMLElement {
  const uri = application && assets?.[application];
  const icon = uri ? document.createElement('img') : codicon(glyph);
  if (icon instanceof HTMLImageElement && uri) {
    icon.className = `host-icon${application === 'VS Code' || application === 'Visual Studio Code' ? ' host-vscode' : ''}`;
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    icon.src = uri;
    icon.addEventListener('error', () => icon.replaceWith(codicon(glyph)), { once: true });
  }
  const mark = document.createElement('span');
  mark.className = `host-mark${currentWindow ? ' current-window' : ''}`;
  mark.setAttribute('aria-hidden', 'true');
  mark.append(icon);
  return mark;
}
