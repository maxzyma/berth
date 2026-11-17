# Release 0.4.12

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md). The session list now
orders each group by most recent activity: the latest of tmux's
`session_activity`, which core adds to live rows as `lastActivity`, and the
agent state change Berth recorded; ties keep natural name order (spec §6,
Order). Each group shows five sessions with a Show more row adding ten at a
time, reset by collapsing the group (spec §6, Show more). Pinned sessions lead
their group outside that limit and are saved per workspace; Mark as Unread
returns a live agent session to attention navigation; Find a Session follows
the same order.

## Validation and publication

macOS, 2026-11-17:

- Unit and controller suite: 419 passed, 11 opt-in native tests skipped, 0 failed.
  New cases cover the `lastActivity` field, activity ordering with name ties and
  stopped sessions last, pins (order, mark, menu, persistence through the host,
  rename) and Mark as Unread, and Find a Session order (V16).
- Webview review suite (Playwright, 1440×900 and 1280×800): 138 passed, including
  five rows with Show more, ten per activation by click and Enter, the hidden
  waiting mark, reset on collapse, the flattened top level and a pinned row
  outside the limit. Three earlier cases that need a full list now expand it
  first.
- VS Code integration suite: 5 passed, 1 pending (the multi-process workspace
  ownership phase).
- The maintainer installed a candidate build locally before release.
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
editor tabs. tmux's session activity also changes on output an agent writes
without a turn, such as a redraw; ordering accepts that, and displayed times
still use hook evidence only.
