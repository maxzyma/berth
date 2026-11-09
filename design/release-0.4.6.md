# Release 0.4.6

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md) for guided setup and
hook reminders, faster creation, CJK session names, renames carried to agent
conversations and folder group reordering. Terminal-led launch remains the core
principle: rename delivery uses each agent's own protocol, hook or launch option,
and Berth types into an agent pane only after the user confirms.

The release also moves three session decisions from the VS Code frontend into the
core (finding codes, terminal ownership and custom-launcher settlement) and splits
the largest frontend modules; see the
[iterations record](iterations.md#session-responsiveness-investigation).

## Validation and publication

Source `3aa1cba`, 2026-11-09, macOS:

- Unit and controller suite: 404 passed, 11 opt-in native tests skipped, 0 failed.
- VS Code integration suite: 5 passed, 1 pending (the multi-process workspace
  ownership phase, run separately).
- Webview browser suite at the release-candidate refactor (`1bd97f8`): 128 passed
  at 1440×900 and 1280×800; the later commits do not change the webview.
- The maintainer reported manual cases V8, V9 and I5 passing on the installed
  candidate; see [manual acceptance](manual-acceptance.md#results).
- Commit identities since 0.4.5 match the attribution reviewed in the
  [0.4.5 audit](release-0.4.5.md#public-repository-audit); the private-identifier
  check of the working tree found no matches.

Publication is pending. The locally installed candidate is not the formal release.

## Accepted limits

Gemini and Cursor conversations keep their own titles after a Berth rename.
Copilot and Kimi Code rename commands are offered only from the verified versions.
CLI and transport tests cover the setup review that follows an incomplete creation
check; nobody has exercised it in a native editor yet. Completion of a new session
can wait behind a background snapshot for the state lock; the terminal is already
shown by then. Native review of the hook reminder and repair notices, broader
native focus and accessibility, remote Profile workflow, iTerm2 and remaining
agent-version acceptance stay open, as listed in [iterations](iterations.md).
