# Third-party notices

The Berth extension bundles the following third-party software.

## Lit (lit, lit-html, lit-element, @lit/reactive-element)

Bundled into `dist/webview/main.js`. https://lit.dev

```
BSD 3-Clause License

Copyright (c) 2017 Google LLC. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.```

## Codicons (@vscode/codicons)

The icon font `dist/webview/codicon.ttf` and `codicon.css`, by Microsoft Corporation, https://github.com/microsoft/vscode-codicons. The icons are licensed under Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/); the CSS is under the MIT License:

```
    MIT License

    Copyright (c) Microsoft Corporation.

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE
```

## Agent product marks

These assets identify coding products, not their vendors or sibling chat products.
Six products use official assets. Claude Code uses Lobe Icons’ Clawd mascot
rendering and Codex uses its terminal product mark; those two are third-party
renderings, not vendor-issued files. Shared Cursor, Copilot and Qoder marks are
not claimed to be separate CLI-only logos. Product names and marks remain their
owners’ trademarks; their use does not imply endorsement.

Assets are copied unchanged. Official artwork keeps its colours and supplied
light/dark variants; the two monochrome third-party SVGs use theme foreground.
Checked 2026-10-31. Archive members and hashes are also recorded in
[the asset manifest](media/agents/sources.json).

| File | Product identity | Channel | Source | SHA-256 |
|---|---|---|---|---|
| `gemini.png` | Gemini CLI | official | [Asset](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/vscode-ide-companion/assets/icon.png) | `351e9f5b1bf863d738cd7be4ed040a625a1419450ae7fc490143e4042b7c2438` |
| `kimi.png` | Kimi CLI | official | [Asset](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/web/public/logo.png) | `dbd00e2ad61ea8832ef0b024662a4a8a5d1b66f0599d5d42e1c9688b9d4cfdf6` |
| `qoder.svg` | Qoder (shared product mark for CLI) | official | [Asset](https://qoder.com/favIcon.svg) | `5e1843cb50c4613855024453e76d5c06d2ca5562efebc12b4fcd80cf9ece1dd0` |
| `opencode.svg` | OpenCode | official | [Asset](https://github.com/anomalyco/opencode/blob/bf544cd419c5f17535c0d5af929f7ecd41188320/packages/console/app/src/asset/brand/opencode-logo-dark.svg) | `5dd4abb4de60204510edf140bbe74b3580d07ebdda79fdb0081cd45acb53d44b` |
| `opencode-light.svg` | OpenCode (light theme) | official | [Asset](https://github.com/anomalyco/opencode/blob/bf544cd419c5f17535c0d5af929f7ecd41188320/packages/console/app/src/asset/brand/opencode-logo-light.svg) | `b47a4fecc77599382e238868e74064bbe92307b0e253a32f0b1a026517a2d2a6` |
| `claude.svg` | Claude Code (Clawd mascot) | third-party | [Asset](https://github.com/lobehub/lobe-icons/blob/8b7bbc433d38437fa2b0cca58ae896917162b812/packages/static-svg/icons/claudecode.svg) | `d7eb2d876b49e51cc16291a42b681d7cf4906e60e0150776dbfb353ec4ca3746` |
| `codex.svg` | Codex (terminal product mark) | third-party | [Asset](https://github.com/lobehub/lobe-icons/blob/8b7bbc433d38437fa2b0cca58ae896917162b812/packages/static-svg/icons/codex.svg) | `d08b4e824cd6727e89617f59e4737273ff53e44c1da849d016dd64dfd08b33e1` |
| `cursor.svg` | Cursor (shared product mark for CLI) | official | [Asset](https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/cursor-brand-assets.zip) | `cd0e3e5d8991a4cdd4577f8896cd063105207665165c73e25a1ff918dd367eb7` |
| `cursor-light.svg` | Cursor (shared product mark for CLI) | official | [Asset](https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/cursor-brand-assets.zip) | `c483c02f78eb2619778fdd959e72a9adfac4844854472cd2653d4cbfd60e4d71` |
| `copilot.png` | GitHub Copilot (shared product mark for CLI) | official | [Asset](https://GitHub.gallerycdn.vsassets.io/extensions/github/copilot/1.388.0/1761326434179/Microsoft.VisualStudio.Services.Icons.Default) | `10812cc1baceeb1d932232e69e1121f290faedca3f400289c24293f1e8d57d0b` |

Gemini CLI and Kimi CLI repository assets are distributed under
[Apache-2.0](media/licenses/Apache-2.0.txt). OpenCode artwork retains its
[MIT notice](media/licenses/OpenCode-MIT.txt). Cursor’s official
[brand assets](https://cursor.com/brand), Qoder’s website product mark, and
GitHub’s published Copilot extension icon retain their respective owners’
rights; no MIT or Apache license is asserted for these marks.

Lobe Icons SVGs retain the following notice:

```text
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Host product icons

Native fallback artwork is read from installed application bundles on macOS
and cached locally. These extracted assets are not included in Berth source
or release packages.
The bundle's identifier and `CFBundleIconFile` identify the original product
asset; iTerm2 and Apple Terminal retain their separate application identities.
Vendor ownership of these assets remains unchanged. Missing or unsupported
artwork uses Berth's existing Codicons terminal fallback.

`media/hosts/vscode.svg` is the unmodified blue Visual Studio Code product mark
from Microsoft's [official icon archive](https://code.visualstudio.com/assets/branding/visual-studio-code-icons.zip),
retrieved 2026-11-03. It identifies the connected host, not Berth or an endorsement.
Microsoft owns the mark; [brand usage guidelines](https://code.visualstudio.com/brand)
apply separately from Berth's MIT license. The transparent product mark replaces
the macOS application tile and is shared across themes and platforms.

## Berth-owned interface artwork

`media/berth-brand-c.svg` is a project-authored vector interpretation of the selected
AI-generated folded-b concept. `media/new-session.svg` is the separate creation
action. Theme variants and the extension icon derive from these sources.
These assets are covered by Berth's project license; they are not Codicons or
vendor product marks.

## fflate

The extension bundles fflate 0.8.2 to package its installed payload for offline Profile preparation.
Source: https://github.com/101arrowz/fflate

```text
MIT License

Copyright (c) 2023 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## jsonc-parser

The extension bundles jsonc-parser 3.3.1 to read VS Code Profile settings.
Source: https://github.com/microsoft/node-jsonc-parser

```text
The MIT License (MIT)

Copyright (c) Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
