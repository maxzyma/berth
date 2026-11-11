# Release 0.4.10

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md). Activation now shows the
known sessions as soon as the environment check passes, before startup
restoration and the first discovery finish (spec §4.2.2). The setup reminder
covers an installed iTerm2 AutoLaunch script that runs another or a removed Berth
installation (spec §6, §7.5); core gains `inspectIterm2`, and scripts written
under an editor runtime set `ELECTRON_RUN_AS_NODE`.

## Validation and publication

macOS, 2026-11-11:

- Unit and controller suite at `f382288`: 414 passed, 11 opt-in native tests
  skipped, 0 failed. Core is unchanged since; the VS Code unit tests at
  `6675f1e`: 145 passed, 1 skipped, 0 failed.
- VS Code integration suite at `6675f1e`: 5 passed, 1 pending (the multi-process
  workspace ownership phase).
- In the isolated editor with 15 sessions, the first list arrived at 3.05 and
  3.02 s after activation against 5.4 and 5.1 s before; both include about 3 s of
  session setup. On this machine a reload's timing showed the list data ready
  2.2 s after activation before the change.
- An iTerm2 script installed through the editor runtime runs `berth ls` with its
  recorded command and environment; this machine's script, which runs a
  standalone 0.4.9 CLI, is reported as another installation.
- The webview is unchanged since 0.4.9. Manual cases V8, V9 and I5 were not
  re-run; the [recorded results](manual-acceptance.md#results) remain the latest.
- The private-identifier check of the working tree found no matches.

Publication is pending. The locally installed candidate is not the formal release.

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
