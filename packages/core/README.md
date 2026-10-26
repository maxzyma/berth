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

Requires Node ≥ 20 and tmux ≥ 3.0. Behaviour is specified in the repository's
`design/spec.md`.
