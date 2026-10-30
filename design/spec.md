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
- **iTerm2** — a lighter host for agent work without an editor window. iTerm2
  already restores its windows, tabs and split panes; Berth makes each
  restored pane return to the agent session it showed (§7).

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
   (Claude Code and Qoder CLI `--name`), Berth passes the session name, and later resolves
   the newest conversation in that directory carrying that name.
3. **Unbound.** Restore relaunches without resuming and the session row says
   so. Berth never falls back to "most recent conversation in this directory".

The same hooks keep `@berth_state` current from the agent's lifecycle events
(prompt submitted → `working`, needs approval → `waiting`, turn finished →
`done`).

Agents without Berth hooks can still ask for attention: a terminal bell in
their session (tmux `alert-bell`, hooked by `berth tmux install`) sets
`@berth_state` to `waiting` with note `bell`. Agents whose installed hooks
report `waiting` ignore the bell, since hooks are more precise; agents whose
hooks have no waiting event (Cursor CLI, OpenCode) keep it. Showing the session in a
frontend clears a bell-raised `waiting`.

Hooks are written only by `berth hooks install <agent>`, are marked as Berth's,
and are removed by `berth hooks uninstall <agent>`.

Without hooks a session cannot be resumed, and nothing shows it until after
a restart, so Berth says so when an agent without hooks is in use: `berth new`
and `berth adopt` print the install command on stderr; a terminal other than
VS Code attaching to such a session shows it in tmux's status line, once per
agent per tmux server (sessions started by a custom launcher reach the user
this way); VS Code offers to install them (§6). Session rows carry the
agent's hook status so every frontend decides the same way. Installing still
needs the user's go-ahead, because it edits the agent's own configuration.

## 5. Berth core

TypeScript library plus the `berth` CLI. Node ≥ 20. No editor dependency.

The core is the shared kernel of every host. It owns everything about
sessions — metadata, launch and resume, snapshots and restore, bells, which
terminal a client belongs to, and how state is shown on that terminal — so a
session behaves the same whichever host shows it, and can move between hosts.
A frontend only does what its host alone can do:

| | Berth for VS Code (§6) | Berth for iTerm2 (§7) |
|---|---|---|
| Uses the core | in-process (bundled library) | through the CLI, from an AutoLaunch script |
| Shows sessions | its sessions view and one session terminal | the panes iTerm2 restores |
| Layout | VS Code's own parts, set by the layout preset | iTerm2's own window restoration |
| Asks the core to | list, show, rebuild, adopt, stamp origin `vscode` | reattach a pane's session |
| State on terminals | core presenter, VS Code sequences | core presenter, iTerm2 sequences |
| Pane ↔ session | tracked by the extension | user variable written by the core on attach |

Adding a host means writing such a column, not changing the core's model.

Published under the npm organization scope `@berthdev`: core and CLI ship as
`@berthdev/berth` with the `berth` binary; later packages use the same scope.
The VS Code extension is published to the Marketplace, not npm.

### 5.1 Commands

| Command | Behaviour |
|---|---|
| `berth ls [--json]` | All sessions: name, agent, cwd, conversation, origin, attached clients, managed or not, and whether the agent's hooks are installed. |
| `berth new <agent> [--name] [--cwd] [--origin] [-- args]` | Create a managed session and run the agent's launch command in it, with any extra agent arguments. Name defaults to the cwd's basename, made unique. |
| `berth adopt <session> --agent <id> [--origin]` | Stamp an existing session so it is managed. |
| `berth attach <session> [--origin]` | Attach, re-stamping origin when given. |
| `berth stamp [--session] key=value…` | Set metadata; used by hooks and custom launchers. |
| `berth snapshot` | Write a snapshot (§5.3). |
| `berth ensure [--origin <o>] [<session>]` | Rebuild missing managed sessions from the newest snapshot; idempotent and lock-protected so concurrent callers rebuild once. |
| `berth restore [--origin <o>] [--session <s>] [<snapshot>]` | Explicit restore from a chosen snapshot, same rules as `ensure`. |
| `berth show <session> [<snapshot>]` | Print saved scrollback. |
| `berth doctor [--json]` | Report unbound sessions, missing working directories, unknown agents and agents in use without hooks. |
| `berth present <session>` | Show the session's state again on the terminals attached to it. |
| `berth hooks install\|uninstall <agent>` | Agent hooks (§4.2). |
| `berth tmux install\|uninstall` | Managed block in the user's tmux config: snapshot, bell and attach hooks. |
| `berth iterm2 install\|uninstall` | Install the iTerm2 AutoLaunch script (§7.3). |
| `berth iterm2 reattach <session>` | Rebuild the session if missing, then print its attach command (§7.3). |

Every command accepts `--socket <name>` (a tmux `-L` server) and
`--socket-path <path>` (a `-S` server). Run by hooks, not by people: `hook
<agent> <event>` (§4.2), `bell --session <s>` (§4.2), `attached --session <s>
--tty <t> --termtype <x>` (§7.3). Berth's tmux hooks pass the socket of the
server they run in, so each server's state stays separate.

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
contract is only: create the tmux session, run the agent in it, and attach
the terminal it was started in. Berth needs nothing else from it: the
frontend that ran it learns the session from that terminal's tmux client and
adopts it with the agent the user chose and the directory detected from the
session's active pane (a launcher may resolve a project name and change into
it). A launcher may also stamp metadata itself (`berth stamp`, or the
`@berth_*` options); what it stamps is kept.

When the agent exits, the session ends — Berth does not leave a stray shell.

### 5.3 Snapshot

- Location: `$XDG_STATE_HOME/berth/servers/<tmux socket or "default">/snapshots/<UTC timestamp>/`
  (default `~/.local/state/berth/…`). State is kept per tmux server, so one
  server's snapshots never restore into another. The root is overridable in
  config; servers stay separate under it.
- Contents:
  - `sessions.json` — one entry per managed session: name, cwd, agent, argv,
    conversation id, origin.
  - `scrollback/<name>.txt` — last N lines of each pane (default 3000), for
    reading only.
- Triggers: `berth snapshot`; tmux hooks on session created / renamed / closed
  (installed by `berth tmux install`, which also hooks `alert-bell`, §4.2,
  and `client-attached` / `client-session-changed`, §7.3).
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
  stays at the bottom and is closed; it opens on demand. It spans the whole
  editor area, so it cannot sit under the files group alone. Berth does not move views it does not own, such as
  Chat.
  Applying again re-establishes the layout after the user has changed it,
  and keeps the values saved by the first apply. *Revert Agent Layout*
  restores the user's settings from before the first apply, and says so when
  there is nothing to restore. Views the user drags elsewhere, including
  Berth's, go back with VS Code's own *View: Reset View Locations*. On first
  activation the
  extension opens its sessions view and offers this command once; nothing
  changes unless the user confirms.
- **Session view.** The rich session list, contributed as an ordinary view so
  the user can place it in any side bar. A tree of every session from
  `berth ls`, grouped by cwd. What a row shows follows the vertical tabs of
  agent terminal apps (cmux, Warp), which set the bar users compare against:
  agent; agent state (`@berth_state`), followed by the latest notification
  text while the state is waiting or done; unread mark when an agent finished
  or started waiting while the user looked elsewhere;
  git branch; connection (attached here / elsewhere / detached / stopped — in
  snapshot, not live); conversation bound or not. A view badge counts sessions
  waiting for the user. Unmanaged sessions are listed separately.
- **One session terminal.** Selecting a row shows that session in the one
  session terminal: the terminal's tmux client switches to it
  (`switch-client`), or the terminal opens attached when there is none. A
  stopped session is rebuilt first. The list, not a row of tabs, is how
  sessions are switched; tmux keeps each session's screen. *Open to the Side*
  adds a second terminal for watching two sessions at once.
- **Go to the next session needing you.** A command and key (⌘⌥U on macOS,
  Ctrl+Alt+U elsewhere) shows the next session waiting for the user, then
  unread ones, wrapping around.
- **Explorer follows.** When a session is shown, its folder is revealed in
  the explorer if it lies inside the workspace (`berth.explorer.followSession`).
  Folders outside it are left alone: showing them would mean changing the
  workspace, which reloads the window.
- **Native terminal tabs.** Kept, never replaced: they stay the terminal
  surface the rest of the ecosystem works with. VS Code lets an extension set
  a tab's icon and colour only at creation, and offers no way to add content
  to a tab row, so Berth adds state through the two channels that do update:
  `${progress}` in `terminal.integrated.tabs.description`, driven by the
  OSC 9;4 sequence (spinner / warning / error), and `${sequence}`, the OSC 2
  title, which VS Code records only on unnamed terminals — another reason
  Berth's terminals are unnamed. Berth turns on tmux's `set-titles` for its
  sessions with the session name prefixed by the state glyph, and the layout
  makes tab titles use `${sequence}`, so a tab reads like "● work" and follows
  `switch-client`.
- **Notifications.** When an agent starts waiting for the user or finishes a
  turn: an in-editor notification through the VS Code API, and a native OS
  notification through a platform helper, because VS Code has no API for OS
  notifications. "Open" in the editor notification focuses the session;
  clicking the OS notification brings the editor forward (on macOS this needs
  `terminal-notifier`).
- **Missing hooks.** The first time a window sees a session whose agent has
  no hooks installed, it says that such sessions start a new conversation
  after a restart and offers *Install*, *Not now* and *Don't ask again* (per
  agent). The session row's tooltip says why it is unbound, and its context
  menu offers *Install Agent Hooks*. Installing runs the `berth` CLI on the
  login PATH, so the hooks keep pointing at a stable path across extension
  updates.
- **Projects.** A project in the sessions view is a folder that has sessions;
  starting a session in a folder creates its group. *New Session* asks for
  the agent and the folder (workspace folders, existing groups, or any folder
  chosen); a group's *New Session Here* uses that group's folder.
- **Custom launcher.** `berth.customLauncher`, when set, starts sessions
  instead of `berth new` (the §5.2 contract): it runs in the session terminal,
  in the chosen folder, and creates and attaches the session; Berth learns the
  session from that terminal's tmux client and adopts it unless the launcher
  stamped it, with the directory detected from the session's pane.
  Placeholders: `{agent}`, `{cwd}` (absolute folder), `{relative}` (folder
  relative to the workspace folder containing it, empty at its root) and
  `{name}` (folder name), each shell-quoted.
- **Actions.** New session, show (also re-stamps origin), open to the side,
  detach, rename, kill (with confirmation), adopt.
- **Startup.** On startup, missing `vscode`-origin sessions are rebuilt and
  the first one not attached anywhere is shown in the session terminal; the
  rest stay in the list. Session terminals are ordinary unnamed terminals, so
  tab titles follow tmux.
- **Remote workspaces.** Works the same in Remote-SSH, Dev Containers and
  WSL: the extension runs on the workspace side, next to the tmux server it
  manages.
- Disabled in untrusted workspaces. Bundles the core library and calls it
  in-process, so it never depends on a `berth` CLI on `PATH` or on its
  version; it shells out to tmux only through the core.

## 7. Berth for iTerm2

### 7.1 Role

After iTerm2 quits — normally or by crashing — or the machine restarts, the
user gets back the same windows, tabs and split panes, and every pane is back
in the agent session it was showing, with that agent's conversation resumed.

That is all Berth does in iTerm2. It has no session list in iTerm2, no layout
model of its own, and never opens tabs for sessions that were not showing.
Sessions are still started with the user's own launcher (§5.2).

### 7.2 Who does what

Berth only fills the gaps between capabilities that already exist.

| Concern | Done by |
|---|---|
| Windows, tabs, split panes and their sizes | iTerm2 window restoration |
| Agent processes surviving an iTerm2 quit or crash | tmux |
| Rebuilding sessions after a reboot, resuming conversations | Berth core (`ensure`, §5.4) |
| Remembering which session each pane showed | Berth: a user variable on the pane (§7.3) |
| Putting each restored pane back in its session | Berth's AutoLaunch script (§7.3) |
| Starting sessions | the user's launcher, unchanged |
| Agent state on the tab | iTerm2's tab status indicator, written by Berth (§7.4) |

iTerm2's own agent hooks (`it2 handle-agent-hook`) do not report from panes of
plain tmux sessions — iTerm2 cannot tell which tab shows such a pane — so for
these sessions Berth writes the state itself.

### 7.3 Restoring panes

1. **Marking.** `berth tmux install` also hooks tmux's `client-attached` and
   `client-session-changed`. When the client is iTerm2 (tmux's
   `client_termtype`), Berth writes `OSC 1337 ; SetUserVar=berthSession=<name,
   base64>` to that client's tty and stamps the session's origin `iterm2`
   (§4.1). The variable belongs to the iTerm2 pane and is saved with it.
   Clients of other terminals are left alone.
2. **Reattaching.** `berth iterm2 install` writes an AutoLaunch script that
   runs when iTerm2 starts, after iTerm2 has restored its windows. For every
   pane whose `user.berthSession` is set and which is not attached to tmux,
   it runs `berth iterm2 reattach <name>`: the core rebuilds the session if it
   is missing (resuming its conversation) and prints the attach command, which
   the script sends to the pane's shell. The attach command is configurable
   (`[iterm2] attach`, default `tmux attach-session -t ={session}`), so a user
   whose launcher also attaches can keep using it.
3. A pane whose session no longer exists and is in no snapshot is left as a
   shell with a one-line note on its screen (shown, never run).

### 7.4 Agent state on the tab

For iTerm2 clients the state presenter (§5, §6) writes iTerm2's tab status
sequence `OSC 21337 ; indicator=<colour> ; status=<text> ; status-color=<colour>`:
a dot and a subtitle for working, waiting (with the latest note) and done,
cleared when there is no state. It writes no badge, tab colour or
notification, and no OSC 9;4, which older iTerm2 versions show as notification
text.

### 7.5 Requirements and coexistence

- iTerm2 3.7 or later (tab status sequence), Python API enabled, and window
  restoration on in iTerm2 and macOS.
- iTerm2 starts AutoLaunch scripts with a minimal `PATH`; the installer records
  absolute paths to `node`, `berth` and `tmux`.
- Berth writes no profiles. Another script that reopens one tab per session
  at startup duplicates panes that iTerm2 already restores; keep only one.

## 8. Agent adapters

The baseline set below must all be supported by milestone 1 (G8).

"Help" means checked against the CLI's own `--help` on the version shown.
"Docs" means the hook or plugin interface follows the CLI's official
documentation (sources below, read 2026-10-30) and has not been run against
the CLI by Berth. "cmux" means cmux integrates the same interface (commit
`6bb44996`, read 2026-10-30).

| Agent | Launch | Resume | Conversation id source | Status |
|---|---|---|---|---|
| Claude Code | `claude --name {name}` | `claude --resume {id}` | `SessionStart` hook (`~/.claude/settings.json`), then name key | Proven in a private prototype; help 2.1.310 |
| Codex CLI | `codex` | `codex resume {id}` (id or session name) | `SessionStart` hook (`~/.codex/hooks.json`) | Help 0.162.1; cmux |
| Gemini CLI | `gemini` | `gemini --resume {id}` | `SessionStart` hook (`~/.gemini/settings.json`) | Docs; hooks on by default from 0.27 |
| OpenCode | `opencode` | `opencode --session {id}` | `session.created` event via a plugin (`~/.config/opencode/plugins/berth.js`) | Docs; cmux |
| GitHub Copilot CLI | `copilot` | `copilot --resume={id}` | `sessionStart` hook (`~/.copilot/hooks/berth.json`) | Docs; 1.0.21 or later; cmux |
| Cursor CLI | `cursor-agent` | `cursor-agent --resume {id}` | `sessionStart` hook (`~/.cursor/hooks.json`) | Help 2025.09.12; docs: the CLI runs hooks from 2026.01; cmux |
| Kimi Code | `kimi` | `kimi --session {id}` | `SessionStart` hook (`[[hooks]]` in `~/.kimi-code/config.toml`) | Help 0.31.1; docs; cmux |
| Qoder CLI | `qodercli --name {name}` | `qodercli --resume {id}` | `SessionStart` hook (`~/.qoder/settings.json`), then name key | Help 1.0.48; docs; cmux |
| `shell` | user shell | — | — | — |

Every hook receives a JSON payload on stdin and the id is read from
`session_id`, `sessionId`, `sessionID` or `conversation_id`. The other hooks
installed per agent map prompt submitted → `working`, permission request →
`waiting`, turn finished → `done`; where the agent's notification event also
fires for idle reminders, only a permission notification counts.

Agent-specific limits:

- Kimi Code refuses to load its whole config on an unknown hook field or
  event, so Berth writes only `event` and `command`, as one marked block at the
  end of `config.toml`. The legacy Python Kimi CLI (`~/.kimi/config.toml`, hooks
  from 1.28) is used only when `~/.kimi-code` does not exist.
- Cursor CLI and OpenCode have no hook for "needs approval" in Berth's set,
  so the terminal bell still marks them `waiting`.
- An OpenCode session spawns child sessions for subagents; the plugin ignores
  sessions with a parent, so the conversation id stays the one the user resumes.

Sources: [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks),
[Gemini CLI hooks](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/index.md),
[Gemini CLI sessions](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md),
[OpenCode plugins](https://opencode.ai/docs/plugins/),
[OpenCode CLI](https://opencode.ai/docs/cli/),
[Copilot CLI hooks](https://github.com/github/docs/blob/main/content/copilot/reference/hooks-reference.md),
[Copilot CLI changelog](https://github.com/github/copilot-cli/blob/main/changelog.md),
[Cursor hooks](https://cursor.com/docs/agent/hooks),
[Cursor CLI changelog](https://cursor.com/docs/cli/changelog),
[Kimi Code hooks](https://moonshotai.github.io/kimi-code/en/customization/hooks.html),
[Qoder CLI hooks](https://docs.qoder.com/en/cli/hooks),
[Qoder CLI sessions](https://docs.qoder.com/cli/sessions),
[cmux agent hooks](https://github.com/manaflow-ai/cmux/blob/main/docs/agent-hooks.md).

A row is done when it is implemented, covered by unit tests, and its source
is recorded: help-checked against the CLI, official docs, or cmux as above.
Live verification (implementation §5.5) covers the agents installed where it
runs; the rest stay "docs" until someone runs them.

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
- **cmux** (macOS terminal app on Ghostty): workspaces, splits, vertical tabs
  showing branch, PR, cwd, ports and the latest notification; a notification
  panel, pane rings and a jump-to-latest-unread key; embedded scriptable
  browser; CLI and socket API; SSH workspaces. Restores layout and resumes
  agent CLIs by hook-recorded id; live processes end when the app quits
  unless tmux / zellij backing is opted into. No editor integration. Its
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
3. **iTerm2 frontend** (§7).
4. **Public release.** Choose license, scan history for private identifiers,
   publish packages.

## 12. Open questions

- Whether iTerm2 keeps a pane's user variables through window restoration
  after a quit, a crash and a reboot (§7.3). If not, the AutoLaunch script
  records the arrangement (`Arrangement.async_save`) with the session of each
  pane in order, and restores that instead.
- Which host-native features beyond the session view earn a place (for
  example a per-session changes view built on VS Code's source control), judged
  by the rule in §2.
