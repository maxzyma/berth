# Release: 0.4.2

Published on 2026-11-03 (Asia/Shanghai) from
`a479ab19203d26056e6230dc76be8ffb120cc6e7`.

- [npm](https://www.npmjs.com/package/@berthdev/berth/v/0.4.2): `latest` is 0.4.2.
- [GitHub Release](https://github.com/maxzyma/berth/releases/tag/v0.4.2): CLI archive and VSIX available.
- [Marketplace](https://marketplace.visualstudio.com/items?itemName=berthdev.berth): official client lists 0.4.2 and its public package is downloadable.

User-facing changes and limits are in the [release notes](../packages/vscode/CHANGELOG.md).

## Verification

The [release workflow](https://github.com/maxzyma/berth/actions/runs/41476463979)
passed the full macOS/tmux 3.8 suite: 279 passed, 7 skipped, 0 failed.
Both archives were built before publication. Publish dry-run and actual npm
publication used the same explicit local archive path.

Downloaded npm and GitHub CLI packages contain identical files. The Marketplace
VSIX and GitHub VSIX also contain identical files. Versions are 0.4.2 across all
three channels. Local CLI installations and the extension match those published
files; the daily editor was not reloaded. Hashes and file counts are in the
[release receipt](assets/code-review/release-0.4.2.json).

## Accepted limitations

The maintainer authorized the release after the outstanding native editor and
manual acceptance checks under implementation R6 were disclosed. Those checks
remain unverified; the release exception does not count as passing them.
CR51's earlier intermittent diagnosis failure did not recur in release CI, but
its cause remains unknown. Passive first-install adoption still does not cover
all CLI modes, including the Codex shared-daemon TUI. These limitations remain
in the [iteration plan](iterations.md).

## Open-source review

The initial audit covered 75 reachable commits, 450 historical blobs, 294
candidate files and 60 archives across npm, GitHub and Marketplace. No
credentials or private workspace identifiers were found. Six secret-scanner
findings were verified evidence hashes. Forty evidence images received OCR
checks, with a flagged fixture reviewed visually. The subsequent 77-commit
publication scan retained only those same hash false positives.

Historical public attribution remains unchanged. Author email addresses are
public attribution, not credentials; subsequent commits use the maintainer’s
chosen personal email. No historical rewrite or old-version withdrawal was indicated
by the observed findings. See the [audit receipt](assets/code-review/open-source-audit.json)
for scope and limits.

## Earlier release attempts

The [0.4.0 candidate](assets/code-review/release-0.4.0.json) passed local checks,
but its CI run stopped before publication because tmux 3.8 rejected Tab in a
test session name. Version 0.4.1 corrected the fixture and passed CI tests; its
publication stopped because a relative archive path lacked `./`. Version 0.4.2
corrects that path. Neither earlier tag produced registry packages or a GitHub
Release. The failed tags remain unchanged. Runtime source did not change between
these attempts.
