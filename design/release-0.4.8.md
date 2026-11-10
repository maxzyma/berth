# Release 0.4.8

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md). The main change fixes a
conversation-identity defect: a hook now counts only when it comes from the
session's producer itself, so an agent run nested inside it cannot replace the
session's conversation, topic or state (spec §4.2). The release also adjusts the
hover card: its open delay follows `workbench.hover.delay` unless
`berth.hover.delay` is set, focus left by a click no longer opens or keeps it,
and its text uses the width the Copy column left empty.

## Validation and publication

macOS, 2026-11-10:

- Unit and controller suite at `fa47dfb`: 409 passed, 11 opt-in native tests
  skipped, 0 failed. A new two-process test fails on the previous hook check and
  passes now; later commits change only an opt-in native test.
- Native fixtures against the installed CLIs, with loopback models: Codex 4 of 4
  passed at `fa47dfb`; Claude passed at `446f28c`. Its earlier timeout came from
  a permission prompt that ignores an immediate Enter, not from Berth.
- Webview browser suite at `cf271bd`: 132 passed at 1440×900 and 1280×800; the
  webview is unchanged since.
- VS Code integration suite at `e92c7b4`: 5 passed, 1 pending (the multi-process
  workspace ownership phase); the VS Code package is unchanged since. The
  integration suite does not exercise agent hooks.
- Manual cases V8, V9 and I5 were not re-run. They cover remote workspaces,
  notification focus and iTerm2 restoration, which these changes do not touch;
  the [0.4.6 results](manual-acceptance.md#results) remain the latest.
- The private-identifier check of the working tree found no matches.

Publication is pending. The locally installed candidate is not the formal release.

## Accepted limits

The limits of [0.4.6](release-0.4.6.md#accepted-limits) still apply. A nested
agent started by `exec` without a shell in between is indistinguishable from an
agent's own launcher; agents' shell tools run commands through a shell, which
this release relies on.
