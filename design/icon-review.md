# Icon review

Berth uses product marks to identify agents, Codicons to explain actions and
state, and its own folded lowercase-b symbol for the extension. A session's
accessible name includes the agent name; details also show that name as text.
Unknown agents and shells use the terminal symbol.

## Scope and decisions

The 2026-10-31 review covers all eight agent identities, the 26 functional glyphs used
by the webview and contributed commands, the folder picker, and Berth's sidebar
SVG and extension PNG. Terminal-title state markers (`●`, `◐`, `✓`) and
iTerm2 indicator/status sequences were checked in the core and retained; their
native rendering was not re-tested in this browser review. The starting point was HEAD `dfb47bf` plus the preceding
local details-card changes. Exact candidate hashes are in
[the evidence record](assets/icons/evidence.json).

| Finding | Resolution |
|---|---|
| All eight agents used invented coloured letters; Codex was a green X. | Replace letters with sourced product marks; prefer official assets and document third-party fallbacks. |
| Row and details rendered agent images separately. Unknown IDs could request nonexistent SVGs. | Use one allowlisted renderer, with a terminal fallback for unknown agents, shells and unmanaged sessions. |
| Agent identity was absent from the row's accessible name. | Include the model's agent display name. Keep decorative marks hidden from assistive technology. |
| Activity and refresh shared arrow glyphs, and modifiers need separate font classes. | Share `loading~spin` between list and hover; separate modifier classes and respect editor/OS reduced motion. |
| Outside-workspace folders had different symbols in the picker and sidebar. | Use `folder-library` in both. |

The remaining functional glyphs retain their existing meanings and Codicons
source. Waiting and unread indicators retain their text and state colours.
Berth's folded lowercase-b mark is shared by the sidebar and extension icon.

## Agent assets

Six products now use official assets. Claude Code and Codex retain product-specific
third-party renderings from Lobe Icons. Source channel and identity are separate:
an official extension may use a shared vendor mark, while a third-party library
may provide a more recognisable product-specific symbol. Neither the filename
nor the license alone establishes identity.

| Agent | Selected identity | Source channel and scope |
|---|---|---|
| Claude Code | Clawd pixel mascot | Lobe Icons `claudecode`; not the Claude chat-product starburst or Anthropic company mark. This is a mascot rendering, not a claim of an official standalone logo. |
| Codex CLI | Codex terminal product mark | Lobe Icons `codex`; not the generic OpenAI knot used by the sampled official editor extension. Not claimed to be a vendor-issued asset. |
| Gemini CLI | Rounded terminal frame and prompt | Official Gemini CLI repository, IDE companion asset; not the Gemini chat-product sparkle or Google company mark. |
| Cursor CLI | Cursor cube | Official Cursor brand package, 2D light/dark variants. Shared Cursor product mark, not a distinct CLI-only logo or Anysphere company mark. |
| GitHub Copilot CLI | Copilot robot | Official GitHub Copilot extension asset. Shared Copilot product mark, not GitHub’s Octocat. |
| Kimi CLI | Kimi CLI application badge | Official Kimi CLI repository’s web client. The CLI itself uses the K identity; it is not a separate Moonshot company logo. This source is the legacy CLI repository matching the adapter family, not a claim about a newly renamed successor. |
| OpenCode | OpenCode rectangular symbol | Official OpenCode brand SVGs, light/dark variants; not the Anomaly company mark. |
| Qoder CLI | Qoder application mark | Official Qoder site favicon. Shared Qoder product identity, not an Alibaba company mark or a separately invented CLI logo. |

The [asset manifest](../packages/vscode/media/agents/sources.json) records exact
URLs, archive members, revisions or versions, and SHA-256 values. The
[third-party notices](../packages/vscode/THIRD_PARTY_NOTICES.md) preserve the
applicable licenses and distinguish product trademark assets from MIT/Apache
repository assets. All selected files are copied unchanged. Official artwork
keeps its colours; supplied light/dark variants follow the editor theme.

Identity references, checked on 2026-10-31: [Claude Code](https://github.com/anthropics/claude-code),
[Lobe Icons product asset sources](https://github.com/lobehub/lobe-icons),
[Codex CLI](https://github.com/openai/codex),
[Gemini CLI](https://github.com/google-gemini/gemini-cli),
[Cursor branding](https://cursor.com/brand),
[GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot),
[Kimi CLI](https://github.com/MoonshotAI/kimi-cli),
[OpenCode branding](https://opencode.ai/brand), and [Qoder](https://qoder.com/).
Product identity references do not confer an endorsement or make a third-party
rendering an official file.

## Rendered evidence

The screenshots use the built webview, synthetic sessions and Chrome. Agent
marks render at their actual 16px size. The function sheets are diagnostic
catalogs of the bundled font, not an additional product screen.

![Agent marks in dark theme](assets/icons/agents-dark.png)
![Agent marks in light theme](assets/icons/agents-light.png)
![Agent marks in high contrast](assets/icons/agents-hc.png)
![Agent marks in light high contrast](assets/icons/agents-hclight.png)
![Functional glyphs and meanings](assets/icons/functions-dark.png)
![Working state in details](assets/icons/working.png)

## Verification

The product-identity revision passed the targeted icon checks recorded in
[the evidence JSON](assets/icons/evidence.json): both 1440×900 and 1280×800
outer viewports, four themes, every product mark, terminal fallbacks, identical
row/details mappings, served asset bytes and accessible agent names. Functional
font/animation checks from the preceding run remain valid; those glyphs did not
change. The VS Code build and webview type check passed. The latest unit run
passed 31 cases; no core behaviour changed in this icon revision.

The extension-host keybinding, native menu, screen-reader, zoom and remote-host
checks listed in [the details review](session-details-review.md#verification-and-limits)
remain open. Browser accessibility assertions do not establish screen-reader
behaviour in VS Code. The local package is installed without reloading the
user's editor; installation hashes are recorded with the evidence.

[Return to development](../README.md#development)

## Host application icons

Host icons prefer reviewed official transparent product marks, shared by list and
hover rendering. VS Code uses its official blue SVG on light and dark backgrounds;
other hosts retain original installed artwork without cropping or recoloring.
Host slots remain 16px; VS Code is centered at 14px. The 4px membership dot
plus its 1px border stays inside the slot; the border follows row hover,
selection and detail backgrounds. Optical checks compare the combined mark,
not just image dimensions.
macOS bundle IDs are resolved through Spotlight and verified
against the bundle metadata; `CFBundleIconFile` selects the original asset.
The VS Code product mark is bundled with attribution; native app images are not distributed. The local PNG cache
is invalidated by source path, size and modification time. Unsupported systems,
unknown applications, unavailable assets and image load failures use the generic
terminal glyph. This-window membership adds a small corner dot to the same
host icon; it does not replace the host identity. Selection, active terminal
and unread activity keep their independent markers.

Sources: [iTerm2](https://iterm2.com/) and
[Apple Terminal](https://support.apple.com/guide/terminal/welcome/mac) application
bundles. Product names and full connection information remain in hover details
and accessible labels; the list stays icon-only.

Working uses a 12px arrowless Codicons loading ring in both list and hover,
centered in the list's 16px activity slot. Editor
and OS reduced-motion settings disable rotation; refresh actions retain arrows.

Validation on 2026-11-03: eight identity/native-asset checks and 64 browser checks
passed. The browser matrix covers two viewport sizes, light/dark host marks,
functional icons in high-contrast themes, list/hover consistency, failed assets,
and editor/OS reduced motion. Real rendered host views use the bundled VS Code
SVG and locally extracted iTerm2/Terminal PNGs. Native editor reload remains manual.

Optical-size follow-up: four host-icon browser cases and two shared-hover
regressions passed. Rendered normal and selected marks were inspected on light
and dark backgrounds at both configured viewport sizes. Local installation is
ready for manual editor reload.

### Size hierarchy

| Role | Rendered size | Layout or target |
|---|---|---|
| Agent and folder identity | 16px | 16px slot |
| Host identity | VS Code 14px; native assets 16px with their original padding | 16px slot |
| Working / hover state glyph | 12px | List activity slot 16px |
| Connection fallback / branch metadata | 12px | Fixed metadata alignment |
| Hover copy | 13px | 22px control |
| Hover close | 16px | 24px control |

Native editor toolbar controls retain VS Code's own metrics. Readability,
combined silhouette and hit targets are checked separately; original product
artwork is not redrawn to force matching pixel coverage.

Size-hierarchy follow-up: 22 icon/host browser checks passed, covering the full
agent catalog, functional glyphs, dark/light/high-contrast themes, shared 12px
Working glyphs, fixed slots, animation and both reduced-motion controls.

### Berth brand and creation action

The brand mark is a folded lowercase b, vectorized from the selected C concept.
It identifies Berth in the sidebar and extension icon. The Editor creation
button uses a separate session-bubble-plus glyph: brand identity and creation
are not the same symbol. Both render at native toolbar size with explicit
light/dark variants, and are distinct from neighboring split/layout controls.
`media/berth-brand-c.svg` and `media/new-session.svg` are the vector sources.
