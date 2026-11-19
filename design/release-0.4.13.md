# Release 0.4.13

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md). Rows order by the last
recorded message, kept in `@berth_messageAt` and moved only by activity timing a
hook or exact native event writes (spec §6, Order). Remind Me Later marks a
session unread and notifies when due (spec §6). A live Claude Code session whose
transcript holds a settled prompt typed by a person that its hooks never reported
carries `hooksSilent` (spec §4.2). Live Berth sessions bound to one agent
conversation all warn; the one whose binding changed last (`@berth_boundAt`)
keeps recovery and rename naming, and a stopped record of a conversation running
elsewhere is dropped (spec §4.2). The spec gives each term one meaning (§4) and
states the session naming convention (§4.2.1).

## Validation and publication

macOS, 2026-11-19:

- Unit and controller suite: 429 passed, 11 opt-in native tests skipped, 0 failed.
  New cases cover message-time ordering and its preservation when state clears,
  reminders (firing once, after a reload, through a rename, dropped with the
  session), hook-silence detection against synthetic transcripts (queued
  messages, compaction summaries, subagent turns and messages from other
  sessions), and shared-conversation keeping, conflict, snapshot and rename
  naming.
- Webview review suite (Playwright, 1440×900 and 1280×800): 140 passed,
  including the pin, reminder and warning marks.
- VS Code integration suite: 5 passed, 1 pending (the multi-process workspace
  ownership phase).
- On the maintainer's machine, hook-silence detection flagged the Claude Code
  sessions whose hooks still called a removed installation and, after three
  corrections, no session whose hooks report. An isolated run confirmed that an
  agent started in another folder inside a Berth shell session moves the
  session's folder with it.
- The details-on-window-blur change is covered by build and integration runs,
  not exercised by switching applications natively.
- Manual cases V8, V9 and I5 were not re-run; the
  [0.4.6 results](manual-acceptance.md#results) remain the latest.

The [release workflow](https://github.com/maxzyma/berth/actions/runs/44449103383)
passed on its first attempt for tag `v0.4.13`: on macOS 15 and macOS 15 Intel,
429 tests passed, 11 opt-in tests skipped, zero failures; the Linux and Windows
jobs also passed. npm `latest`, [GitHub Releases](https://github.com/maxzyma/berth/releases/tag/v0.4.13)
and the VS Code Marketplace publish 0.4.13. `scripts/verify-release.mjs` found
the npm archive identical to the GitHub archive and to the registry's integrity,
and the Marketplace VSIX identical to the GitHub one. Private-identifier and
credential scans of the 215 published files found nothing. The official VSIX is
installed locally, with all 33 extension payload files matching the archive
(ignoring VS Code's installation metadata). See the
[publication receipt](assets/code-review/release-0.4.13.json).

## Accepted limits

A running agent can keep hook configuration it loaded earlier: some Claude Code
versions stop noticing a settings file replaced by an atomic write
([anthropics/claude-code#57852](https://github.com/anthropics/claude-code/issues/57852)),
and only a restart loads the current one. Berth detects this for Claude Code
only. A nested agent started by `exec`
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
editor tabs. Ordering needs hook or exact native evidence of a message, so
sessions of agents without hooks keep name order; reminders are checked every
30 seconds. Shared-conversation detection compares live bindings only.
