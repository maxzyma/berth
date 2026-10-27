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

Agent-focused terminal apps (cmux, Warp) address these by asking people to
move their agents into a new app, leaving behind the tools and extensions they
already use. Berth takes the other route.

## 2. Goals

Berth brings agent sessions into the hosts people already work in instead of
replacing them. Each host gets a frontend named *Berth for <host>*; all of
them sit on one core. Each host is supported for its own reason:

- **VS Code** — the full editor and its extension ecosystem: source control and
  diff, language servers, remote workspaces, settings sync.
- **iTerm2** — a lighter host for agent work without an editor window, with
  its own scripting surface (Python API, toolbelt, triggers) and community
  extensions built on it, such as file viewers.

Across hosts, one set of live sessions is shared: a session attached in one
host can be attached in the other, and returns after a restart to the host
that last took it (§4.1). Standalone agent terminal apps cannot share live
sessions with an editor.

A feature counts as a Berth difference only if it relies on the host: if an
agent terminal app running beside an editor can do it equally well, it is not
a reason for Berth to exist.

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
- G8. Support every agent CLI in the baseline set (§8) from the first
  release: launch, conversation binding and resume for each. Missing resume
  for a baseline agent is a defect, not a lower tier. Not every agent has to
  be verified against its own CLI first (§8).

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
| `@berth_state` | `working` / `waiting` (needs the user) / `done` / empty when unknown; written by agent hooks |
| `@berth_note` | latest notification text from the agent, shown in session lists |

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

The same hooks keep `@berth_state` current from the agent's lifecycle events
(prompt submitted → `working`, needs approval → `waiting`, turn finished →
`done`).

Hooks are written only by `berth hooks install <agent>`, are marked as Berth's,
and are removed by `berth hooks uninstall <agent>`.

## 5. Berth core

TypeScript library plus the `berth` CLI. Node ≥ 20. No editor dependency.

Published under the npm organization scope `@berthdev`: core and CLI ship as
`@berthdev/berth` with the `berth` binary; later packages use the same scope.
The VS Code extension is published to the Marketplace, not npm.

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
| `berth restore [--origin <o>] [--session <s>] [<snapshot>]` | Explicit restore from a chosen snapshot, same rules as `ensure`. |
| `berth show <session> [<snapshot>]` | Print saved scrollback. |
| `berth doctor` | Report unbound sessions, missing working directories, unknown agents and agents in use without hooks. |
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
  (installed by `berth tmux install`).
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

- **Layout preset.** The Berth container lives in the secondary side bar.
  Command *Berth: Apply Agent Layout* writes, after confirmation, the user
  settings `workbench.sideBar.location = right` (so the secondary side bar,
  and Berth with it, is on the left), `workbench.secondarySideBar.defaultVisibility
  = visible`, adds `terminalEditor: true` to `workbench.editor.autoLockGroups`
  (keeping the user's other entries), adds `${progress}` to
  `terminal.integrated.tabs.description`, and optionally
  (`berth.layout.hideTerminalTabs`) hides the native terminal tab list.
  Berth opens session terminals as editors in the first editor group; that
  group locks, so files open in the group beside it. Left to right: Berth
  sessions (secondary side bar), session terminals, files, the explorer
  (primary side bar). The panel, with Problems, Output and plain terminals,
  stays at the bottom. Berth does not move views it does not own, such as
  Chat.
  *Revert Agent Layout* restores the settings and returns the panel to the
  bottom. On first activation the
  extension opens its sessions view and offers this command once; nothing
  changes unless the user confirms.
- **Session view.** The rich session list, contributed as an ordinary view so
  the user can place it in any side bar. A tree of every session from
  `berth ls`, grouped by cwd. What a row shows follows the vertical tabs of
  agent terminal apps (cmux, Warp), which set the bar users compare against:
  agent; agent state (`@berth_state`); unread mark when an agent finished or
  started waiting while the user looked elsewhere; latest notification text;
  git branch; connection (attached here / elsewhere / detached / stopped — in
  snapshot, not live); conversation bound or not. A view badge counts sessions
  waiting for the user. Unmanaged sessions are listed separately. Selecting a
  row focuses its terminal, attaching first when needed.
- **Native terminal tabs.** Kept, never replaced: they stay the terminal
  surface the rest of the ecosystem works with. VS Code lets an extension set
  a tab's icon and colour only at creation, and offers no way to add content
  to a tab row, so Berth adds state through the two channels that do update:
  `${progress}` in `terminal.integrated.tabs.description`, driven by the
  OSC 9;4 sequence (spinner / warning / error), and `${sequence}`, the OSC 2
  title, which VS Code records only on unnamed terminals — another reason
  Berth's terminals are unnamed.
- **Notifications.** When an agent starts waiting for the user or finishes a
  turn: an in-editor notification through the VS Code API, and a native OS
  notification through a platform helper, because VS Code has no API for OS
  notifications. "Open" in the editor notification focuses the session;
  clicking the OS notification brings the editor forward (on macOS this needs
  `terminal-notifier`).
- **Actions.** New session (pick agent; runs `berth new --origin vscode` or the
  configured custom launcher in a new terminal), attach (opens a terminal and
  re-stamps origin), detach, rename, kill (with confirmation), adopt.
- **Startup.** On startup, for each `vscode`-origin session that no open
  terminal shows, open one terminal running attach-or-ensure. Restored
  terminals are ordinary unnamed terminals, so tab titles follow tmux.
- **Remote workspaces.** Works the same in Remote-SSH, Dev Containers and
  WSL: the extension runs on the workspace side, next to the tmux server it
  manages.
- Disabled in untrusted workspaces. Bundles the core library and calls it
  in-process, so it never depends on a `berth` CLI on `PATH` or on its
  version; it shells out to tmux only through the core.

## 7. Berth for iTerm2

- `berth iterm2 install` writes an AutoLaunch script (iTerm2 Python API) and one
  dynamic profile per `iterm2`-origin session.
- Each profile's command is attach-or-heal: attach; if the session is missing,
  `berth ensure --origin iterm2 <session>`; attach again. After a reboot the
  first tab rebuilds and the rest attach.
- Session list: live tmux when a server is running, else the newest snapshot.
- iTerm2 starts AutoLaunch scripts with a minimal `PATH`; the installer records
  absolute paths to `tmux` and `berth`.
- **Agent state on tabs.** iTerm2 lets a running session change its tab
  colour, title and badge, so `@berth_state` is shown there directly.
- **Notifications** through iTerm2's own notification sequence (OSC 9) when an
  agent starts waiting or finishes.
- **Coexistence.** Berth uses iTerm2's documented surfaces only and leaves room
  for other iTerm2 extensions; it does not take over profiles it did not write.
- A session list in the toolbelt is optional, added only if users manage many
  sessions from iTerm2 alone.

## 8. Agent adapters

The baseline set below must all be supported by milestone 1 (G8).

"Help" means checked against the CLI's own `--help` on the version shown.
"Reference" means the command and hook semantics follow cmux's implementation
for that agent (commit `473e77e`, 2026-10-26) and have not been run against the
CLI by Berth.

| Agent | Launch | Resume | Conversation id source | Status |
|---|---|---|---|---|
| Claude Code | `claude --name {name}` | `claude --resume {id}` | `SessionStart` hook, then name key | Proven in a private prototype; help 2.1.310 |
| Codex CLI | `codex` | `codex resume {id}` (id or session name) | Codex hooks | Help 0.162.1; id source to verify |
| Gemini CLI | `gemini` | `gemini --resume {id}` | to verify | Reference only |
| OpenCode | `opencode` | `opencode --session {id}` | plugin events | Reference only |
| GitHub Copilot CLI | `copilot` | `copilot --resume {id}` | to verify | Reference only |
| Cursor CLI | `cursor-agent` | `cursor-agent --resume {id}` | to verify | Help 2025.09.12 |
| Kimi CLI | `kimi` | `kimi --session {id}` | to verify | Help 0.31.1 (other tools use `--resume`; follow the CLI) |
| Qoder CLI | `qodercli --name {name}` | `qodercli --resume {id}` | to verify; name key possible | Help 1.0.48 |
| `shell` | user shell | — | — | — |

A row is done when it is implemented, covered by unit tests, and its source
is recorded: help-checked against the CLI, or reference to cmux as above.
Live verification (implementation §5.5) covers the agents installed where it
runs; the rest stay "reference" until someone runs them.

Agents outside the baseline set may be added later. Adding an adapter means
filling its row and passing the adapter tests; no change elsewhere.

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
- **cmux** (macOS terminal app on Ghostty): vertical tabs, notifications,
  embedded browser; restores layout and resumes 17 agent CLIs by hook-recorded
  id. Live processes end when the app quits. No editor integration. Its
  vertical-tab content and hook-based agent state are the reference for the
  VS Code session view and `@berth_state`. Licensed GPL-3.0-or-later (server
  parts BUSL-1.1): Berth takes behaviour and design from it, not code.
- **Warp** (terminal app): vertical tabs with agent status, notifications,
  in-terminal code review, remote control for third-party CLI agents. Restores
  tabs and panes, not running agents. Some features need an account.

Berth's difference: agents stay inside the user's existing hosts and their
ecosystems, including remote workspaces; sessions outlive the host process;
Berth adopts sessions it did not start, treats the launcher as replaceable,
and gives each host its own sessions back. Ideas borrowed
from MIT-licensed projects keep their notices.

## 11. Milestones

1. **Core + baseline adapters.** `ls`, `new`, `stamp`, `snapshot`, `ensure`,
   `restore`, hooks, every agent in §8; reboot test: every managed session returns, resumed into
   its own conversation.
2. **VS Code frontend.** Session view, actions, startup reopen, layout preset.
3. **iTerm2 frontend.**
4. **Public release.** Choose license, scan history for private identifiers,
   publish packages.

## 12. Open questions

- iTerm2 surfaces in §7 (tab colour / badge updates, notifications, toolbelt
  web views) are stated from experience and need checking against the current
  Python API before implementation.
- Which host-native features beyond the session view earn a place (for
  example a per-session changes view built on VS Code's source control), judged
  by the rule in §2.
