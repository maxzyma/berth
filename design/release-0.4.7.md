# Release 0.4.7

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md). This release applies the
[principle review](principle-review.md): it removes a duplicate context-menu
entry and shows recovery repairs and legacy layout inspection only when they
apply. It also adds the [product principles](spec.md#22-product-principles) to
the specification. Stopped rows in `berth ls --json` gain `cwdMissing`.

## Validation and publication

Source `b39e108`, 2026-11-09, macOS:

- Unit and controller suite: 407 passed, 11 opt-in native tests skipped, 0 failed.
- VS Code integration suite: 5 passed, 1 pending (the multi-process workspace
  ownership phase, run separately).
- Every `berthItem` token used by a context-menu condition is produced by the
  session view model. Menu rendering in a native editor is not automated.
- The webview is unchanged since the 0.4.6 browser run (128 passed at both
  viewports).
- Manual cases V8, V9 and I5 reuse the [0.4.6 results](manual-acceptance.md#results):
  this release changes only menus, which none of the three cases exercise. The
  maintainer approved the reuse.
- The private-identifier check of the working tree found no matches.

The [release workflow](https://github.com/maxzyma/berth/actions/runs/42645566665)
passed on its second attempt; the first could not obtain a macOS 15 runner and
skipped publication. On macOS 15 and macOS 15 Intel, 407 tests passed, 11 opt-in
tests skipped, zero failures; the Linux and Windows jobs also passed. npm
`latest`, [GitHub Releases](https://github.com/maxzyma/berth/releases/tag/v0.4.7)
and the VS Code Marketplace publish 0.4.7. The npm archive from the official
registry matches the GitHub archive byte for byte and its integrity; the
Marketplace and GitHub VSIX archives match byte for byte. Private-identifier and
credential scans of the 209 published files found nothing. The official VSIX is
installed locally, with all 33 extension payload files verified against the
archive (ignoring VS Code's installation metadata). See the
[publication receipt](assets/code-review/release-0.4.7.json).

## Accepted limits

The limits of [0.4.6](release-0.4.6.md#accepted-limits) still apply.
