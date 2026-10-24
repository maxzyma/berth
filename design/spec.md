# Berth spec

Source of truth for what Berth does. Code follows this file; rules for
editing the repo are in `.claude/rules/`, not here.

## 1. Problem

Terminal-based coding agents (Claude Code, Codex CLI, Gemini CLI, …) are long
running, and people run many at once across projects. Three things break:

1. **Losing the process.** Closing an editor terminal, quitting the editor, or
   rebooting kills the agent. tmux keeps the process alive across editor
   restarts, but not across a reboot.
2. **Losing the conversation.** After a reboot the session must be relaunched
   and resumed into *its* conversation. `--continue` picks the newest
   conversation in a directory, which is wrong when one directory holds many
   concurrent sessions.
3. **Losing the place.** Sessions are spread over terminals (VS Code, iTerm2).
   After a restart each should come back where it was opened, and only there.

## 2. Goals

- G1. List every agent session on the machine in one place, including ones
  Berth did not start.
- G2. Start a new agent session in one action, with a launch command the user
  can replace.
- G3. Bind each session to its conversation by an exact key, not a guess.
- G4. Snapshot sessions so a reboot loses nothing that can be rebuilt.
- G5. Reopen each session, resumed into its conversation, in the terminal that
  owns it.
- G6. Ship a VS Code layout that puts the session list first.
- G7. Depend on no directory layout, workspace structure, or private script.

## 3. Non-goals

- Not an agent harness or chat UI. Berth runs the user's own CLI with the
  user's own configuration; it never talks to a model.
- No cost, token or billing tracking.
- No scrollback replay as a substitute for resume. Scrollback is kept for
  reading only.
- No native Windows. tmux is required (macOS, Linux, WSL, Remote-SSH).
- No git worktree management. Worktrees are just directories to Berth.

## 4. Concepts

| Term | Meaning |
|---|---|
| **Session** | One tmux session. Berth keys everything by its name. |
| **Managed session** | A session carrying Berth metadata (below). Created by `berth new`, or adopted with `berth adopt`. |
| **Unmanaged session** | Any other tmux session. Listed, attachable, never snapshotted or restored. |
| **Agent** | The CLI running in the session: an adapter id (`claude`, `codex`, `gemini`, …) or `shell`. |
| **Conversation id** | The agent's own id for the conversation, used to resume it. |
| **Origin** | The frontend that owns reopening the session: `vscode`, `iterm2`, or `none`. |
| **Snapshot** | A dated record of all managed sessions, enough to rebuild them. |

Metadata lives on the tmux session as user options, so it travels with the
session and any tool can read it:

| Option | Value |
|---|---|
| `@berth_agent` | adapter id or `shell` |
| `@berth_cwd` | working directory at launch |
| `@berth_argv` | the launch command, verbatim |
| `@berth_conversation` | conversation id, or empty if not yet known |
| `@berth_origin` | `vscode` / `iterm2` / `none` |

### 4.1 Origin rules

- Stamped when a frontend creates a session, and re-stamped when a frontend
  attaches a session: opening a VS Code session from iTerm2 moves it to iTerm2.
- Never inferred from attached clients. A session can be attached from two
  terminals at once, or from none.
- `none` sessions are restored as processes but no frontend reopens them.

### 4.2 Conversation binding

Order of preference, first hit wins:

1. **Agent hook.** The agent reports its own id at session start (Claude Code
   `SessionStart`, which also fires on resume, clear, compact and fork, so the
   stamp follows id changes). The hook runs `berth stamp --conversation <id>`.
2. **Name key.** When the agent supports naming a conversation at launch
   (Claude Code `--name`), Berth passes the session name, and later resolves
   the newest conversation in that directory carrying that name.
3. **Unbound.** Restore relaunches without resuming and the session row says
   so. Berth never falls back to "most recent conversation in this directory".

Hooks are written only by `berth hooks install <agent>`, are marked as Berth's,
and are removed by `berth hooks uninstall <agent>`.

## 5. Berth core

TypeScript library plus the `berth` CLI. Node ≥ 20. No editor dependency.

### 5.1 Commands

| Command | Behaviour |
|---|---|
| `berth ls [--json]` | All sessions: name, agent, cwd, conversation, origin, attached clients, managed or not. |
| `berth new <agent> [--name] [--cwd] [--origin]` | Create a managed session and run the agent's launch command in it. Name defaults to the cwd's basename, made unique. |
| `berth adopt <session> --agent <id>` | Stamp an existing session so it is managed. |
| `berth attach <session> [--origin]` | Attach, re-stamping origin when given. |
| `berth stamp [--session] key=value…` | Set metadata; used by hooks and custom launchers. |
| `berth snapshot` | Write a snapshot (§5.3). |
| `berth ensure [--origin <o>] [<session>]` | Rebuild missing managed sessions from the newest snapshot; idempotent and lock-protected so concurrent callers rebuild once. |
| `berth restore [--resume] [--origin <o>] [<snapshot>]` | Explicit restore from a chosen snapshot. |
| `berth show <session> [<snapshot>]` | Print saved scrollback. |
| `berth doctor` | Report drift: name / title / conversation mismatches, unbound sessions, missing hooks. |
| `berth hooks install\|uninstall <agent>` | Agent hooks (§4.2). |
| `berth tmux install\|uninstall` | Managed block in the user's tmux config: snapshot hooks, optional session picker key. |
| `berth iterm2 install\|uninstall` | Install the iTerm2 frontend (§7). |

### 5.2 Launch

Each agent adapter defines a default launch template and a resume template.
Users override either per agent in config:

```toml
[agents.claude]
launch = "claude --name {name}"
resume = "claude --resume {conversation} --name {name}"

[agents.codex]
launch = "codex"
resume = "codex resume {conversation}"
```

A **custom launcher** (any user script) may replace `berth new` entirely. Its
contract: create the tmux session, run the agent, and call `berth stamp` with
at least `agent`, `cwd`, `origin`. Berth then treats it like its own.

When the agent exits, the session ends — Berth does not leave a stray shell.

### 5.3 Snapshot

- Location: `$XDG_STATE_HOME/berth/snapshots/<UTC timestamp>/`
  (default `~/.local/state/berth/…`). Overridable in config.
- Contents:
  - `sessions.json` — one entry per managed session: name, cwd, agent, argv,
    conversation id, origin.
  - `scrollback/<name>.txt` — last N lines of each pane (default 3000), for
    reading only.
- Triggers: `berth snapshot`; tmux hooks on session created / renamed / closed
  (installed by `berth tmux install`); optional interval.
- Retention: newest K snapshots (default 5).
- Snapshots contain conversation text and are never meant for version control.

### 5.4 Restore

- `ensure` reads live tmux first; if a managed session is missing, it rebuilds
  from the newest snapshot. After a reboot there is no tmux server, so the
  snapshot is the only source.
- A rebuilt session runs the resume template when it has a conversation id,
  the launch template otherwise, `shell` sessions get a shell in their cwd.
- `--origin` limits work to one frontend's sessions.

### 5.5 Configuration

`$XDG_CONFIG_HOME/berth/config.toml`. Keys: tmux binary and socket (default:
the user's default server, so existing sessions are visible), snapshot root,
scrollback lines, retention, agent templates. Everything has a default;
Berth runs with no config file.

## 6. Berth for VS Code

- **Layout preset.** Command *Berth: Apply Agent Layout* writes, after
  confirmation, the user settings
  `terminal.integrated.tabs.location = left`,
  `workbench.sideBar.location = right`,
  `workbench.secondarySideBar.defaultVisibility = visible`.
  Moving the Terminal view into the secondary side bar has no stable API; the
  command attempts it and, if that fails, shows a one-step instruction.
  *Revert Agent Layout* restores the previous values.
- **Session view.** A tree of every session from `berth ls`, grouped by cwd:
  agent, attached here / elsewhere / detached / stopped (in snapshot, not
  live), conversation bound or not. Unmanaged sessions are listed separately.
- **Actions.** New session (pick agent; runs `berth new --origin vscode` or the
  configured custom launcher in a new terminal), attach (opens a terminal and
  re-stamps origin), detach, rename, kill (with confirmation), adopt.
- **Startup.** On startup, for each `vscode`-origin session that no open
  terminal shows, open one terminal running attach-or-ensure. Restored
  terminals are ordinary unnamed terminals, so tab titles follow tmux.
- Disabled in untrusted workspaces. Calls the core library in-process; shells
  out to tmux only through the core.

## 7. Berth for iTerm2

- `berth iterm2 install` writes an AutoLaunch script (iTerm2 Python API) and one
  dynamic profile per `iterm2`-origin session.
- Each profile's command is attach-or-heal: attach; if the session is missing,
  `berth ensure --origin iterm2 <session>`; attach again. After a reboot the
  first tab rebuilds and the rest attach.
- Session list: live tmux when a server is running, else the newest snapshot.
- iTerm2 starts AutoLaunch scripts with a minimal `PATH`; the installer records
  absolute paths to `tmux` and `berth`.

## 8. Agent adapters

| Agent | Launch | Resume | Conversation id source | Status |
|---|---|---|---|---|
| Claude Code | `claude --name {name}` | `claude --resume {id}` | `SessionStart` hook, then name key | Behaviour proven in a private prototype |
| Codex CLI | `codex` | `codex resume {id}` | Codex hooks / session index | To verify |
| Gemini CLI and others | CLI default | none until verified | none | Process-only restore |
| `shell` | user shell | — | — | — |

Adding an adapter means filling that row and passing the adapter tests; no
change elsewhere.

## 9. Constraints

- No dependency on any directory layout or workspace convention (G7).
- No edits to agent configuration except via `berth hooks install`.
- No network access. Berth reads local files and talks to tmux only.
- Snapshot data stays out of repositories.

## 10. Prior art

Checked 2026-10-25.

- **AI Terminal Sessions** (VS Code, MIT): closest match — tmux persistence,
  per-agent status, reboot recovery. Lists only sessions it created (name
  prefix), has no custom launcher, no layout preset, no iTerm2 side.
- **AgentMux** (VS Code): tmux sidebar scoped to the current workspace.
- **agent-deck** (TUI / web): broad session manager outside the editor.
- **tmux-assistant-resurrect** and similar tmux-resurrect plugins: resume
  agents by recorded id after a reboot; no editor integration.

Berth's difference: it adopts sessions it did not start, treats the launcher
as replaceable, and gives each terminal its own sessions back. Ideas borrowed
from MIT-licensed projects keep their notices.

## 11. Milestones

1. **Core + Claude adapter.** `ls`, `new`, `stamp`, `snapshot`, `ensure`,
   `restore`, hooks; reboot test: every managed session returns, resumed into
   its own conversation.
2. **VS Code frontend.** Session view, actions, startup reopen, layout preset.
3. **iTerm2 frontend.**
4. **Codex adapter**, then others as verified.
5. **Public release.** Choose license, scan history for private identifiers,
   publish packages.

## 12. Open questions

- Package names: `berth` is taken on npm; candidates `@berth/core` (scope
  availability unchecked) or a personal scope.
- Codex resume and conversation-id source need checking against the current
  Codex CLI.
- Whether the VS Code extension bundles the core or requires the CLI on `PATH`
  (bundling avoids a version mismatch; the iTerm2 side needs the CLI anyway).
