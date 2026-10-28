# Berth implementation contract

How Berth is built and tested. [spec.md](spec.md) says what Berth does; this
file fixes the choices code must follow and the acceptance cases that decide
when a milestone is done. Where the two disagree, the spec wins and this file
is fixed.

## 1. Stack

| Concern | Choice |
|---|---|
| Runtime | Node ≥ 20 |
| Language | TypeScript, `strict`, ES modules |
| Repo | npm workspaces: `packages/core`, `packages/vscode` |
| Build | `tsc -b` to `dist/`; the VS Code extension is bundled with esbuild |
| Tests | `node:test` on the built output; the VS Code integration tests run under `@vscode/test-cli` (mocha) |
| CLI parsing | `node:util` `parseArgs` |
| Config parsing | `smol-toml` (the only runtime dependency of core) |
| iTerm2 side | Python 3, iTerm2 Python API; no other dependency |
| Minimum tmux | 3.0 |

Scripts at the repo root:

| Script | Runs |
|---|---|
| `npm run build` | all packages |
| `npm test` | every automated test (§5), all isolated |
| `npm run test:vscode` | VS Code integration tests in a real editor window (§5.3); run deliberately |
| `npm run test:live` | opt-in tests against real agent CLIs (§5.5); never part of `npm test` |

## 2. Data formats

### 2.1 Snapshot

`<snapshot root>/<UTC timestamp, ISO basic>/sessions.json`:

```json
{
  "version": 1,
  "createdAt": "2026-10-26T08:00:00Z",
  "sessions": [
    {
      "name": "web-api",
      "cwd": "/abs/path",
      "agent": "claude",
      "argv": "claude --name web-api",
      "conversation": "9f1c…",
      "origin": "vscode"
    }
  ]
}
```

- Readers reject an unknown `version`; writers only write the current one.
- `conversation` and `origin` are always present; unknown is `""` / `"none"`.
- A snapshot is written to a temporary directory and renamed into place, so a
  reader never sees a partial one.
- Scrollback files sit beside it as `scrollback/<name>.txt`.

### 2.2 `berth ls --json`

An array; one object per tmux session:

```json
{ "name": "web-api", "managed": true, "agent": "claude", "cwd": "/abs/path",
  "conversation": "9f1c…", "origin": "vscode", "state": "waiting", "note": "",
  "attachedClients": 1, "live": true }
```

`live: false` rows come from the newest snapshot (stopped sessions). Unmanaged
rows carry `managed: false` and empty Berth fields.

### 2.3 CLI conventions

| Exit code | Meaning |
|---|---|
| 0 | success |
| 1 | runtime failure |
| 2 | usage error |
| 3 | tmux unavailable or server not running where one is required |
| 4 | named session not found |

- Errors go to stderr as one line prefixed `berth: `. Machine output only on
  stdout, and only with `--json`.
- Precedence: flags > environment > config file > defaults. Environment:
  `BERTH_CONFIG`, `BERTH_STATE_DIR`, `BERTH_TMUX`, `BERTH_TMUX_SOCKET`.

### 2.4 Names and locks

- Default session name: basename of the cwd, reduced to `[A-Za-z0-9_-]`;
  on collision append `-2`, `-3`, … .
- `ensure` takes `<state dir>/ensure.lock` (the state dir is per tmux server) (a directory created atomically,
  holding the owner's PID). A lock whose PID is dead is taken over; otherwise
  callers wait up to 30 s, then exit 1.

## 3. Agent adapters

Commands per agent are defined in [spec §8](spec.md#8-agent-adapters). An
adapter is a module in `packages/core/src/agents/` exposing: `launch`
template, `resume` template, how a conversation id is obtained, how native
hook events map to `@berth_state`, and which original launch arguments are
kept on resume.

### 3.1 Hook events → state

| Agent | → `working` | → `waiting` | → `done` | Conversation id |
|---|---|---|---|---|
| Claude Code | `UserPromptSubmit` | `Notification` with a permission request (not the idle reminder) | `Stop` | `SessionStart` payload |
| Codex CLI | to verify | to verify | `Stop` | `SessionStart` payload |
| OpenCode | to verify | to verify | `session.idle` (a turn ending, not the session) | `session.created` |
| Copilot CLI | to verify | to verify | `Notification` | to verify |
| Others | to verify | to verify | to verify | to verify |

Rows marked "to verify" are filled from the CLI's own hook documentation
where available, otherwise from cmux's event mapping for that agent (the
reference commit in spec §8); the source is noted in the adapter module.

### 3.2 Arguments kept on resume

Resume rebuilds the command from the resume template plus the original
arguments that configure the session (model, profile, sandbox / approval
mode, added directories). It drops arguments that start new work: an initial
prompt, `--continue`, a different session id, one-shot / print modes. Each
adapter lists its keep-set explicitly; anything not listed is dropped.

## 4. Edge cases every implementation must handle

1. tmux not installed, or installed but no server running (after reboot).
2. Two `ensure` calls at once (two terminals opening after a reboot).
3. A recorded cwd that no longer exists: `ensure` skips it, `doctor` reports it.
4. The agent binary missing at restore: start a shell in the cwd, report.
5. A conversation id the agent no longer accepts: the session shows the
   agent's own error. Berth does not silently start a fresh conversation in
   its place.
6. Fork / clear / compact inside the agent mints a new id: the hook re-stamps
   it; the newest stamp wins.
7. Session renamed in tmux: metadata travels with the session; the snapshot
   uses the new name.
8. A managed session whose agent exited: the session ends (spec §5.2), and
   disappears from `live` rows.
9. Name collision with an unmanaged session: `new` picks the next suffix and
   never adopts silently.
10. Snapshot with no managed sessions: written, empty, valid.
11. Stale lock from a crashed `ensure` (§2.4).
12. Hook installed twice: idempotent; uninstall removes only Berth's entries
    and leaves the agent's other hooks untouched.
13. Snapshots of one tmux server are never restored into another.

## 5. Test isolation (MUST)

Automated tests must never touch the user's real tmux sessions, agent
configuration, or editor settings.

### 5.1 tmux

- Every test uses its own server: `tmux -L berth-test-<random>`. The default
  server is never addressed.
- The test helper refuses any server-wide command (`kill-server`) unless the
  socket name starts with `berth-test-`.
- Teardown kills only the test's own server.
- Waits poll tmux state with a deadline; no fixed sleeps.

### 5.2 Files and environment

- `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` point into a per-test temporary
  directory. Hook install / uninstall tests run against agent config files
  created there.
- With `BERTH_KEEP_SANDBOX=1`, tests keep their temporary directory and print
  its path for inspection.

### 5.3 VS Code

- The extension's logic lives in a view model and a controller that never
  import `vscode`; they talk to the editor through a small host interface.
  `npm test` runs them against a fake host and a test tmux server (§5.1), which
  covers V1–V7 without opening an editor window.
- `npm run test:vscode` runs a real VS Code instance through `@vscode/test-cli`
  with a temporary `--user-data-dir`, `--extensions-dir`, workspace and test
  tmux socket, so settings writes stay throwaway. It opens a window, so it is
  run deliberately, not as part of `npm test`.
- Remote-SSH, Dev Containers and WSL are covered by manual acceptance (§6),
  not automated.

### 5.4 Agents in automated tests

Real agent CLIs are not run. Each agent's launch and resume templates are
overridden in the test config with a stand-in command that writes its
arguments to a file and then waits:

```sh
sh -c 'printf "%s\n" "$0" "$@" > "$BERTH_TEST_ARGV"; exec sleep 3600' {args}
```

Hooks are simulated by calling `berth stamp` with the payload the agent would
send. Adapter unit tests check template rendering, the keep-set (§3.2) and
event mapping (§3.1) without any process.

### 5.5 Live tests (opt-in)

`npm run test:live` runs real agents in an isolated tmux server: launch,
record the conversation id through the agent's hook, kill the server,
`ensure`, and check through the agent's own start hook that it resumed that
conversation. Only Claude Code is covered so far; other agents follow when
they can take hooks without editing the user's own agent configuration.

Usage is kept low on purpose, to limit cost and avoid tripping provider
abuse controls: the smallest model, one short prompt (about one request per
run), nothing sent after resuming, no retries, and at most one run every six
hours unless `BERTH_LIVE_FORCE=1`. Hooks are passed with `--settings`, so the
user's agent settings are not modified; the agent still records the
conversation in its own history as it always does. Runs only with
`BERTH_LIVE=1`.

### 5.6 iTerm2

The generated AutoLaunch script is unit-tested as a file (it must parse). Running
inside iTerm2 is manual acceptance.

## 6. Acceptance cases

Each case gets a test whose name starts with its id. A milestone is done when
all its automated cases pass under `npm test`, its
manual cases are recorded as checked, and the de-identification check passes.

### Milestone 1 — core and baseline adapters

- **C1** `ls` lists managed, unmanaged and stopped (snapshot-only) sessions
  with the fields of §2.2.
- **C2** `new <agent>` creates a session running the agent's launch template,
  stamps all metadata, picks a unique name.
- **C3** A custom launcher that creates a session and calls `stamp` is listed
  as managed.
- **C4** `adopt` makes an unmanaged session managed without restarting it.
- **C5** `stamp` from a hook updates `conversation` and `state`; the newest
  stamp wins.
- **C6** `snapshot` writes the §2.1 format atomically and keeps the newest K.
- **C7** After the test server is killed, `ensure` rebuilds every managed
  session with its resume template and conversation id (stand-in argv checked).
- **C8** `ensure --origin vscode` rebuilds only `vscode` sessions.
- **C9** Two concurrent `ensure` calls rebuild each session once.
- **C10** A session without a conversation id is rebuilt with its launch
  template and reported as unbound.
- **C11** `hooks install` / `uninstall` per agent are idempotent and leave
  unrelated hook entries intact.
- **C12** Every edge case in §4 has a test.
- **C14** With `berth tmux install`, a bell in a session whose agent has no
  installed hooks sets `waiting` / `bell`; one whose hooks are installed is
  left alone; showing the session clears a bell-raised `waiting`.
- **C13** Every baseline adapter passes its unit tests (§5.4) and its spec §8
  row records its source (help-checked or cmux reference).
- **L1** (live, manual trigger) Every installed baseline agent resumes its own
  conversation after the server is killed.

### Milestone 2 — Berth for VS Code

- **V1** The session view shows the rows of spec §6, grouped by cwd, with the
  latest notification on waiting / done rows and the waiting-count badge.
- **V2** Selecting a row switches the one session terminal to that session
  (rebuilding a stopped one first), or opens it when there is none; open to
  the side adds a second terminal; the explorer follows only folders inside
  the workspace.
- **V3** New / attach / detach / rename / kill / adopt act on the test server;
  a custom launcher runs in the session terminal in the chosen folder with its
  placeholders filled; the terminal then learns its session from tmux, and a
  session the launcher did not stamp is adopted with the chosen agent and the
  directory of its active pane.
- **V4** On startup, missing `vscode`-origin sessions are rebuilt and one is
  shown in the session terminal; sessions of other origins are not.
- **V5** Native tabs show state through `${progress}` and `${sequence}`.
- **V6** Waiting and done produce an in-editor notification.
- **V7** Apply / revert layout writes and restores only the listed settings in
  the test instance's user settings, adding to the user's own object values
  rather than writing the defaults.
- **V10** *Go to Next Session Needing You* shows waiting sessions first, then
  unread ones, in name order, wrapping around.
- **V8** (manual) The same flows work in Remote-SSH, a Dev Container and WSL.
- **V9** (manual) OS notifications appear and focus the session when clicked.

### Milestone 3 — Berth for iTerm2

- **I1** `iterm2 install` writes only the AutoLaunch script, with absolute tool
  paths; `iterm2 uninstall` removes it; no profiles are written.
- **I2** With `berth tmux install`, attaching an iTerm2 client to a managed
  session (or switching it to one) writes `SetUserVar=berthSession` to that
  client's tty and stamps origin `iterm2`; other clients get neither.
- **I3** `iterm2 reattach <name>` rebuilds a missing session from the newest
  snapshot (resume template, conversation id) and prints the configured
  attach command; for a live session it only prints the command.
- **I4** For iTerm2 clients the presenter writes `OSC 21337` status for working,
  waiting and done and clears it otherwise; no badge, tab colour, OSC 9 or
  OSC 9;4.
- **I5** (manual) Quit iTerm2 with several windows, tabs and splits showing
  sessions; reopen: the same layout returns and every pane is back in its
  session. Repeat after a crash (kill iTerm2) and after a reboot, where each
  session is rebuilt and resumes its conversation. Record whether user
  variables survived each case (spec §12).

### Milestone 4 — public release

Cases marked (human) need the maintainer's decision or accounts.

- **R1** (human) Choose the license; add `LICENSE` at the root and set
  `license` in both package manifests.
- **R2** The whole history is free of private identifiers: file contents
  through the de-identification check, and commit author / committer
  identities checked separately (the content check does not see them).
- **R3** (human) Rewrite any commit whose identity fails R2 before the
  repository is made public, and update every reference to the old commit
  ids in the same step. Publish the rewritten history into a repository that
  never held the old one: on GitHub, commits removed from every branch can
  still be fetched by id from the repository that had them. History kept for
  old references stays in a separate private repository.
- **R4** `npm pack` of `packages/core` contains only `dist/src`, `README.md`
  and the manifest; `vsce package` of `packages/vscode` succeeds.
- **R5** (human) Create the `berthdev` npm organization and Marketplace
  publisher, then publish `@berthdev/berth` and the extension. Until then,
  each release attaches the npm tarball and the `.vsix` to its GitHub release.
- **R6** (human) Run the manual cases V8, V9, I5 following
  [manual-acceptance.md](manual-acceptance.md), and `npm run test:vscode`,
  before each release.

## 7. Prior art used

Resume commands and hook-event semantics come from cmux (GPL-3.0-or-later,
reference commit in spec §8) and AI Terminal Sessions (MIT), checked against
each CLI where installed. Agents not checked follow cmux's logic for that
agent. No code is copied from either; facts about third-party CLIs are
restated in Berth's own words, and each adapter module notes its source.
