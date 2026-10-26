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
| Tests | `node:test` on the built output; no other test framework |
| CLI parsing | `node:util` `parseArgs` |
| Config parsing | `smol-toml` (the only runtime dependency of core) |
| iTerm2 side | Python 3, iTerm2 Python API; no other dependency |
| Minimum tmux | 3.0 |

Scripts at the repo root:

| Script | Runs |
|---|---|
| `npm run build` | all packages |
| `npm test` | every automated test (§5), all isolated |
| `npm run test:vscode` | VS Code extension tests (§5.3) |
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
  "conversation": "9f1c…", "origin": "vscode", "state": "waiting",
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
- `ensure` takes `<state dir>/ensure.lock` (a directory created atomically,
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
before the adapter is done. Behaviour of other tools may guide where to look;
it is not evidence.

### 3.2 Arguments kept on resume

Resume rebuilds the command from the resume template plus the original
arguments that configure the session (model, profile, sandbox / approval
mode, added directories). It drops arguments that start new work: an initial
prompt, `--continue`, a different session id, one-shot / print modes. Each
adapter lists its keep-set explicitly; anything not listed is dropped.

## 4. Edge cases every implementation must handle

1. tmux not installed, or installed but no server running (after reboot).
2. Two `ensure` calls at once (two terminals opening after a reboot).
3. A recorded cwd that no longer exists: skip, report in `ls` and `doctor`.
4. The agent binary missing at restore: start a shell in the cwd, report.
5. A conversation id the agent no longer accepts: the session shows the
   agent's own error; `doctor` reports it. Berth does not silently start a
   fresh conversation in its place.
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
- Tests that fail keep their temporary directory and print its path.

### 5.3 VS Code

- Extension tests run through `@vscode/test-cli` in a separate VS Code
  instance with a temporary `--user-data-dir` and `--extensions-dir`, so the
  layout preset writes only to throwaway settings.
- The test instance receives `BERTH_TMUX_SOCKET` for a test server (§5.1).
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

`npm run test:live` runs each installed baseline agent for real in an isolated
tmux server: launch, record a conversation id through the installed hook,
kill the server, `ensure`, and check the agent resumed that conversation. It
needs the agent logged in and may cost tokens; it skips agents not installed.

### 5.6 iTerm2

Generated profiles and the AutoLaunch script are unit-tested as files. Running
inside iTerm2 is manual acceptance.

## 6. Acceptance cases

Each case gets a test whose name starts with its id. A milestone is done when
all its automated cases pass under `npm test` (or `npm run test:vscode`), its
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
- **C13** Every baseline adapter passes its unit tests (§5.4) and its spec §8
  row is confirmed against the CLI.
- **L1** (live, manual trigger) Every installed baseline agent resumes its own
  conversation after the server is killed.

### Milestone 2 — Berth for VS Code

- **V1** The session view shows the rows of spec §6, grouped by cwd, with the
  waiting-count badge.
- **V2** Selecting a row focuses its terminal, attaching first when needed.
- **V3** New / attach / detach / rename / kill / adopt act on the test server.
- **V4** On startup, each `vscode`-origin session not shown in a terminal gets
  one; sessions of other origins do not.
- **V5** Native tabs show state through `${progress}` and `${sequence}`.
- **V6** Waiting and done produce an in-editor notification.
- **V7** Apply / revert layout writes and restores only the listed settings in
  the test instance's user settings.
- **V8** (manual) The same flows work in Remote-SSH, a Dev Container and WSL.
- **V9** (manual) OS notifications appear and focus the session when clicked.

### Milestone 3 — Berth for iTerm2

- **I1** `iterm2 install` writes the AutoLaunch script and one profile per
  `iterm2`-origin session, with absolute tool paths.
- **I2** A profile's command is attach-or-heal (checked as text).
- **I3** (manual) After quitting tmux, opening iTerm2 restores its sessions and
  only those; tab state and notifications appear.

## 7. Prior art used

Resume commands and hook-event semantics were first located in the published
support lists and tests of cmux (GPL-3.0-or-later) and AI Terminal Sessions
(MIT), then checked against each CLI where installed (spec §8). No code is
copied from either; facts about third-party CLIs are restated in Berth's own
words.
