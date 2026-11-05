# @berthdev/berth

Core library and `berth` CLI of Berth: keep terminal-based coding agents
(Claude Code, Codex CLI, Gemini CLI, OpenCode, Copilot CLI, Cursor CLI, Kimi
CLI, Qoder CLI) running in tmux, list sessions, and resume conversations whose
identity, profile and launch options have been verified. Adapter availability does
not imply every CLI version or startup mode has passed native acceptance.

```sh
berth new claude --origin vscode     # start an agent session
berth ls                             # every session, managed or not
berth hooks install claude           # let the agent report its conversation id and state
berth tmux install                   # snapshot automatically as sessions change
berth ensure                         # after a reboot: rebuild and resume
```

Recovery requires a verified conversation ID and its profile. Installing hooks
cannot identify every conversation that was already running: the agent must
execute a supported event or expose verified native identity evidence. Codex's
shared-daemon TUI can be bound when an existing complete native session-ID footer
is independently verified against its client profile and rollout. Clients without
that signal remain unbound; working activity and visible-prompt previews are display
information only. Berth does not change Codex configuration for passive discovery
or resume the most recent conversation in a directory as a substitute.

Requires Node ≥ 20 and tmux ≥ 3.0. macOS process discovery also uses system Perl. Behaviour is specified in the repository's
[design/spec.md](https://github.com/maxzyma/berth/blob/main/design/spec.md).

The optional `berth iterm2 install` integration reconnects iTerm2-restored panes
and presents tab state. It does not provide an iTerm2 session list or layout manager.
