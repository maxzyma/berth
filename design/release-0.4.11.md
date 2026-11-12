# Release 0.4.11

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md). The layout preset no
longer adds `${progress}` to `terminal.integrated.tabs.description`: VS Code
1.143.1 resolves it to codicon syntax such as `$(loading~spin)`, which the
terminal panel's tab list draws as an icon and terminal editor tabs, where Berth
opens sessions, print as text. Tab titles keep the state glyph through
`${sequence}` (spec §6, Native terminal tabs). A managed Profile prepared by an
earlier version drops that description once, only while it equals the value in
the preparation record; a retried preparation no longer writes it (spec §6, Use
Berth Layout). Core still emits OSC 9;4 for terminals that draw it natively.

## Validation and publication

macOS, 2026-11-12:

- Unit and controller suite: 415 passed, 11 opt-in native tests skipped, 0 failed.
  The new V5 case covers the cleanup conditions: the recorded value, a value the
  user changed, an absent value, a recorded value without `${progress}`, a value
  Berth did not record, and a retried preparation.
- VS Code integration suite: 5 passed, 1 pending (the multi-process workspace
  ownership phase).
- In an isolated editor built by `scripts/demo/`, a working session's editor tab
  read `● api-review $(loading~spin)` before the change and `● api-review
  shop-api` after it; the terminal panel's tab list drew the same state as an
  icon. The cleanup of an existing managed Profile is covered by unit tests, not
  exercised in a native editor.
- Manual cases V8, V9 and I5 were not re-run. They cover remote workspaces,
  notification focus and iTerm2 restoration, which this change does not touch;
  the [0.4.6 results](manual-acceptance.md#results) remain the latest.

Publication is pending.

## Accepted limits

Agents read hook configuration when they start, so sessions already running keep
calling the previous target until they restart. A nested agent started by `exec`
without a shell in between is indistinguishable from an agent's own launcher;
agents' shell tools run commands through a shell, which the identity check relies
on.

Unbound default-footer Codex clients on a shared daemon lack a verified current
conversation ID; display-only activity and prompt excerpts do not authorize exact
recovery. Hook trust remains agent-owned. Gemini and Cursor conversations keep
their own titles after a Berth rename; Copilot and Kimi Code rename commands are
offered only from the verified versions. Completion of a new session can wait
behind a background snapshot for the state lock; the terminal is already shown by
then. The setup review that follows an incomplete creation check is covered by CLI
and transport tests, not exercised in a native editor. Native review of the hook
reminder and repair notices, broader native focus and accessibility, the remote
Profile workflow, iTerm2 and remaining agent-version acceptance stay open, as
listed in [iterations](iterations.md). Qoder missed-start support is deferred.
Other VS Code versions were not checked for how they draw `${progress}` on
editor tabs.
