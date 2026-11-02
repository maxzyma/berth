# @berthdev/berth

Core library and `berth` CLI of Berth: keep terminal-based coding agents
(Claude Code, Codex CLI, Gemini CLI, OpenCode, Copilot CLI, Cursor CLI, Kimi
CLI, Qoder CLI) running in tmux, list them all, and bring each back —
conversation included — after an editor restart or a reboot.

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
shared-daemon TUI does not yet support passive binding. Berth preserves unknown
bindings rather than resuming the most recent conversation in a directory.

Requires Node ≥ 20 and tmux ≥ 3.0. macOS process discovery also uses system Perl. Behaviour is specified in the repository's
`design/spec.md`.
