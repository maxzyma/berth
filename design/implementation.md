# Berth implementation contract

How Berth is built and tested. [spec.md](spec.md) says what Berth does; this
file fixes the choices code must follow and the acceptance cases that decide
when a milestone is done. Where the two disagree, the spec wins and this file
is fixed.

Launch and discovery changes must satisfy the
[core launch principle](spec.md#21-core-principle-terminal-led-launch-evidence-based-discovery).
Acceptance must include an unchanged launcher that emits no Berth metadata and
knows nothing of Berth, plus a session started outside the Berth UI. Identify the
result from live process/connection evidence, preserve the launcher's chosen
agent and directory, and report missing conversation evidence without guessing.
Do not replace these cases with tests that supply a cooperative callback or
Berth-created session. Existing V3 cases cover the unaware-launcher path; new
interfaces must preserve that acceptance case.

Attachment uses core `presentCurrentState` under the shared lock after bell
acknowledgement; it does not replay an inventory row. Custom-launch intent belongs
to the successful terminal PID and is assigned inside the main-action queue.
The observed attachment carries its PID through settlement so an older sample
cannot consume a newer launch. `tools.executableOnPath` owns executable lookup
for diagnostics, recovery preflight and resolved integration commands. Callers
that launch in a session pass its cwd; relative/empty PATH entries use that cwd.
Version diagnosis caches resolved executables and limits each run to eight probes.
Lock-ticket scans first reject nonexistent PIDs without starting a subprocess,
then verify boot and process-birth identity for live owners. Only confirmed stale
UUID tickets are reclaimed; malformed or inaccessible records fail closed.
VS Code creation invokes the existing core CLI asynchronously through the main
action queue. Mutation workers are not automatically timed out and retried.
Local activation is rendered from cached inventory and current terminal identity;
terminal lifecycle revisions discard older in-flight inventory. Explorer follow
cancels focus restoration when the selected terminal or editor group changes.

Internal placeholder commands use the current runtime path, independent of PATH.
Editor hook installation uses an asynchronous bounded child process. A host-local
queue serializes runtime replacement and installer execution; failed requests
return their cause and release the queue.
`config/write.ts` stages configuration in the target directory and renames
it into place. It resolves existing symlinks, preserves POSIX modes and removes
failed staging files. JSON, TOML, generated plugin and tmux configuration writers share this owner.
Tmux block parsing validates standalone paired markers before publication; live
hook updates propagate errors with the persisted-versus-runtime distinction.

Connection inventory derives counts and client identities from one successful
`list-clients` result. Strict inventory sampling rejects client query failures;
window PID readiness remains separate from connection presence. Refresh bounds
PID collection and resamples it after inventory acquisition. Regression cases
cover zero stale counts with live clients, pending PIDs, failed client queries,
and stable marker placement with working/waiting/unread states.

Automatic layout preparation is capability-gated against VS Code 1.143.1.
The adapter checks native commands, uses `_files.newWindow` with reuse and Profile
options to initialize the destination, then restores the exact workspace with
`vscode.openFolder`. A detached helper installs the running extension snapshot
and writes only the newly created Profile's settings. The destination acknowledges
its preparation token before completion. Native VS Code owns Profile registration;
Berth reads that registry without rewriting it. Existing prepared Profiles are
matched by ID and token. Unsupported hosts stop before switching, without opening
a manual import or selection flow. Source references:
[profile actions](https://github.com/microsoft/vscode/blob/e646868227c3e3a9e3f24277c8c7220be42c0be7/src/vs/workbench/contrib/userDataProfile/browser/userDataProfile.ts),
[default profile identity](https://github.com/microsoft/vscode/blob/e646868227c3e3a9e3f24277c8c7220be42c0be7/src/vs/platform/userDataProfile/common/userDataProfile.ts),
and [workspace command options](https://github.com/microsoft/vscode/blob/e646868227c3e3a9e3f24277c8c7220be42c0be7/src/vs/workbench/browser/actions/workspaceCommands.ts)
(checked 2026-11-07). These commands are version-bound, not a general Profile API.
Profile settings use Microsoft’s [jsonc-parser](https://github.com/microsoft/node-jsonc-parser)
with comments and trailing commas enabled, and reject parse errors. Bundles prefer
ESM module entry points; a subprocess smoke check loads the packaged helper to
catch unresolved UMD dependency imports.
Native acceptance must cover one-click preparation, source settings preservation,
exact multi-root restoration, reuse and dirty-editor cancellation. Unit routing
checks do not establish those outcomes.

## 1. Stack

| Concern | Choice |
|---|---|
| Runtime | Node ≥ 20 |
| Development toolchain | Node ≥ 22, required by the locked VS Code integration tools |
| Language | TypeScript, `strict`, ES modules |
| Repo | npm workspaces: `packages/core`, `packages/vscode` |
| Build | `tsc -b` to `dist/`; the VS Code extension is bundled with esbuild |
| Sessions view | A webview view: Lit rendering into light DOM (VS Code's context menu reads `data-vscode-context` by walking the document, which does not enter shadow roots), `@vscode/codicons`; both bundled into `dist/webview` by `scripts/build-webview.mjs`, notices in `THIRD_PARTY_NOTICES.md` |
| Tests | `node:test` on the built output; the VS Code integration tests run under `@vscode/test-cli` (mocha) |
| CLI parsing | `node:util` `parseArgs` |
| Config parsing | `smol-toml` (the only runtime dependency of core) |
| iTerm2 side | Python 3, iTerm2 Python API; no other dependency |
| Minimum tmux | 3.0 |

The root test launcher enumerates compiled `.test.js` files and passes explicit
paths to Node. It does not rely on test-runner glob expansion, which is unavailable
on the supported Node 20 baseline. Normal tests retain serial execution and
include opt-in native fixtures as skips; the live command selects only the native
fixture directory and enables its existing environment gate. Editor integration
`.cjs` files remain outside both commands. PTY fixtures select BSD `script`
arguments on macOS and util-linux arguments on Linux. A fixture asserting the
pane process cwd explicitly replaces its launcher shell instead of relying on
shell-specific last-command execution optimizations.

Scripts at the repo root:

| Script | Runs |
|---|---|
| `npm run build` | all packages |
| `npm test` | every automated test (§5), all isolated |
| `npm run test:vscode` | VS Code integration tests in a real editor window (§5.3); run deliberately |
| `npm run test:live` | opt-in tests against real agent CLIs (§5.5); never part of `npm test` |

Agent marks are bundled as unchanged product assets from the recorded sources in
[third-party notices](../packages/vscode/THIRD_PARTY_NOTICES.md). The shared
`webview/icons.ts` renderer owns the asset allowlist, terminal fallback and
Codicon modifier mapping. [Icon review](icon-review.md) records the inventory
and browser evidence.

Natural session ordering is covered by mixed live/snapshot and unmanaged-row
unit cases, attention navigation, and browser refresh/reordering cases.
[Ordering evidence](assets/session-order/evidence.json) and the
[rendered order](assets/session-order/natural-order.png) record the targeted checks.

[Product review](product-review.md) records the global product and architecture
assessment, connection/name changes and current validation evidence.
[Iterations](iterations.md) owns pending implementation tasks and their acceptance conditions.

The editor samples the bundled CLI asynchronously with a 10-second deadline,
an 8 MiB output limit and one in-flight request. Branch reads run asynchronously
at concurrency four with individual deadlines. Bounded child-process calls use
SIGKILL at expiry so signal handlers cannot keep a query pending. Dependency
version probes use the same forced-termination rule at their 2.5-second deadline. Tests separate host responsiveness
from core sampling duration. Native integration fixtures use an isolated editor
profile and `berth-test-*` socket; they require an agreed foreground window.

Codex screen observation runs after the inventory state lock is released and only
returns a display overlay. `agents/codex-screen.ts` parses the visible grid;
`registry/codex-screen.ts` verifies the producer and unchanged metadata around
capture. A separate optional `terminalPreview` field holds a bounded visible prompt
excerpt, never persisted as `topic`. It is resampled without caching and has lower
display priority than verified text; hover identifies its source. Footer UUIDs alone
are candidates, never recovery authority. The selection adapter
independently verifies the native profile, top-level rollout and unchanged producer
before persisting identity and typed lifecycle/prompt records. Unknown selection
suspends observer-owned recovery. No agent configuration is modified. Regression
coverage includes stale output, hidden/truncated footer, retained unread while
working, hook waits, process mismatch and no metadata mutation. The opt-in native
viewport fixture uses a local model endpoint, no hooks and an unaware launcher.

Lifecycle timestamps use `agents/activity-timing.ts`: validated hooks supply receipt
time; exact-bound Codex events supply their own timestamp. `activityTiming` is
live metadata, excluded from snapshots. State writes without explicit timing clear
old evidence. Screen-only state overrides suppress timing. The view formats relative
and local absolute time only in hover, using existing refreshes and copy actions.

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
      "origin": "vscode",
      "serverStart": "1793367307-35689",
      "sessionId": "$0"
    }
  ]
}
```

- Readers reject an unknown `version`; writers only write the current one.
- `conversation` and `origin` are always present; unknown is `""` / `"none"`.
- `serverStart` names the tmux server lifetime the session was seen in
  (`#{start_time}-#{pid}`); absent in snapshots from 0.2 and earlier, whose
  sessions are not normally carried forward (spec §5.3). Conflicting or failed
  records are explicitly retained until recovery or Forget.
- Optional `sessionId` records the immutable tmux session identity. Together with
  `serverStart`, it matches normal-closure markers without confusing renames or
  a reused session name. Without it, matching lifetime, agent and conversation
  are required before a live row can replace that record.
- Optional `retained` preserves a stopped record across external name collisions
  and partial recovery. Renaming or ending the distinct live session preserves it.
- Live-only `restoreSource` hashes the saved lifetime, session ID, name, agent,
  folder, conversation and profile. Restore stamps it before launch so the rebuilt session
  can replace exactly its source record despite its new tmux identity. Normal
  snapshots then use the rebuilt session's actual lifetime and session ID.
- A snapshot is written to a temporary directory and renamed into place, so a
  reader never sees a partial one.
- Snapshot publication and identity mutations share the synchronous reentrant
  state lock. Publication order cannot regress when a caller supplies an old time.
- `argvVerified` records launch arguments supplied by Berth, read as an OS
  argument vector, or explicitly reviewed. Legacy replay options require Review
  Recovery Options before resume. `process-arguments.ts` reads Linux procfs or
  uses an inline system-Perl syscall bridge on 64-bit macOS. The bridge follows
  XNU executable-path alignment, returns argv only and bounds memory/time.
- Optional `profile` stores the agent directory selectors, never credentials.
  It participates in recovery-record identity; stale tmux selectors are removed
  before launching the saved profile.
- Optional `ownerWorkspace` stores the registered workspace key. Legacy records
  without it are not automatically claimed by an editor window.
- Optional `bindingIssue`, `recovery`, `recoveryAt` and `recoveryDetail` preserve
  conflict and recovery evidence. Pane/process ownership remains live-only.
- Scrollback files sit beside it as `scrollback/<name>.txt`.

### Native field transport

`tmux/fields.ts` encodes separators and the equals escape prefix inside tmux,
before records are emitted, and decodes once after printable-tilde framing.
Session, pane, client and scalar identity/path readers share this contract.
The format avoids percent directives because `display-message` expands dates. Nested substitutions support tmux 3.0; versions
without `session_path` use the active pane path. Scalar readers preserve boundary
whitespace. `process-directory.ts` reads a producer's cwd through Linux procfs or
the system-Perl Darwin proc-info bridge; discovery and explicit adoption consume
that same value rather than decoding `lsof` display text.
Literal paths embedded in hook formats escape `#` before tmux expansion; shell
quoting remains a separate step. `formatLiteral` is shared by closure markers
and installed CLI hook commands. Runtime socket/session placeholders remain
formats. Tests execute every installed hook both immediately and after sourcing
the generated configuration, and verify last-session closure evidence.

### Process and profile ownership

Recovery compares the saved server identity with the selected tmux endpoint's
actual `start_time` and PID. Lock tickets and host claims carry a boot/process-birth
fingerprint; legacy records compare process birth with the record creation time.
An unverifiable process does not silently authorize takeover. Process birth uses
`ps lstart` (second resolution); same-second PID reuse remains a limitation.

Agent profile resolution belongs to `agents/roots.ts`. Hook install, status,
uninstall and title reads consume it. Names are display values, never binding
authority. `agents/profile.ts` captures only supported directory selectors, stores
them with exact conversation IDs, and applies them to tmux launch/resume. Unknown
legacy profiles require explicit selection; title and hook reads never substitute
the host profile. Producer lifetime remains live-only. Generated OpenCode hooks
persist Electron's Node-mode requirement when installed under that runtime.

Detach targets observed tmux clients. End kills the requested tmux session.
Neither command disposes editor terminals using cached session names. A direct
attach process exits naturally; a shell wrapper may stay open. Polling clears
host references whose tmux client no longer exists.

### 2.2 `berth ls --json`

An array; one object per tmux session:

```json
{ "name": "web-api", "managed": true, "agent": "claude", "cwd": "/abs/path",
  "conversation": "9f1c…", "origin": "vscode", "state": "waiting", "note": "",
  "attachedClients": 1, "live": true }
```

`live: false` rows come from the newest snapshot (stopped sessions). Unmanaged
rows carry `managed: false` and empty Berth fields.

Connection rows add optional `connections` entries (`pid`, `terminal`, `application`,
`ancestors`) and `conversationTitle`. Client ancestry is captured once per list
operation from the OS process table. The VS Code host supplies all live terminal
PIDs, so manual attachments and client switches use the same matching rule.
Conversation-title readers accept only an exact bound ID and read agent stores
without modifying them. Missing stores and unsupported formats return no title.
`agents/jsonl-titles.ts` walks complete JSONL records backward in 64 KiB chunks,
retaining at most the current record across chunk boundaries. Claude/Qoder custom
titles and the batched Codex name index share this reader. It stops once all
requested names have been found; it does not treat sampled windows as complete.

Inventory supplies a derived cache directory under Berth state. Cache entries
contain requested IDs/names and a source fingerprint, not message records. An
unchanged source reuses its result across workers. Any change invalidates it and
requires a new scan; an in-place rewrite that grows the file is not mistaken for
an append. Open-file and pathname checks reject a result if the source changes
during inspection. Atomic cache replacement supports overlapping readers, and
cache errors fall back to the source without altering recovery or agent stores.

Acceptance covers manual same-window attachment, multiple clients, unknown
hosts, detached working agents, stale host bookkeeping, exact title lookup,
renamed titles, missing stores and two conversations in the same directory.

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
- Restore uses the choosing/ticket ordering of [Lamport’s bakery algorithm](https://lamport.azurewebsites.net/pubs/bakery.pdf), adapted to local filesystem records (source checked 2026-11-01): publish a unique choosing record,
  atomically publish its numeric ticket, then wait for choosing contenders and
  lower (ticket, ID) pairs. Dead owners are ignored. Each caller removes only
  its UUID record. Legacy live directory locks are respected during migration;
  simultaneous old/new writers are not supported during an upgrade.
- Runtime session-closed hooks write closure markers keyed by server lifetime
  and tmux session ID. Snapshot filtering uses those markers, not empty inventory.
- Socket identity retains conventional system-directory keys and hashes canonical
  custom endpoints. Custom basename-only legacy state requires explicit restore.


## 3. Agent adapters

Commands per agent are defined in [spec §8](spec.md#8-agent-adapters). An
adapter is a module in `packages/core/src/agents/` exposing: `launch`
template, `resume` template, how a conversation id is obtained, how native
hook events map to `@berth_state`, and which original launch arguments are
kept on resume.

### 3.1 Hook events → state

| Agent | → `working` | → `waiting` | → `done` | Conversation id |
|---|---|---|---|---|
| Claude Code | `UserPromptSubmit`, `PostToolBatch` | `PermissionRequest`, permission `Notification` | `Stop` | `SessionStart` |
| Codex CLI | `UserPromptSubmit`, `PostToolUse` | `PermissionRequest` | `Stop` | `SessionStart` |
| Gemini CLI | `BeforeAgent`; `BeforeModel` ends an existing wait | `Notification` with `ToolPermission` | `AfterAgent` | `SessionStart` |
| OpenCode | Busy/retry `session.status`, approved `permission.replied` | `permission.asked` | Successful `session.idle` | `session.created`, `session.updated` |
| Copilot CLI | `userPromptSubmitted` | Permission `notification` | `agentStop` | `sessionStart` |
| Cursor CLI | `beforeSubmitPrompt` | Not mapped | `stop` with `status: completed` | `sessionStart` |
| Kimi CLI | `UserPromptSubmit`, `PermissionResult` | `PermissionRequest` | `Stop` | `SessionStart` |
| Qoder CLI | `UserPromptSubmit`, `PostToolUse`, non-interrupted `PostToolUseFailure` | `PermissionRequest` | `Stop` | `SessionStart` |

`Interrupt` (Codex and Kimi), `StopFailure` (Claude, Kimi and Qoder), and Qoder
`PostToolUseFailure` with `is_interrupt: true` clear activity and note without
marking the turn done. The payload condition only applies to registered events. OpenCode
errors and rejected permissions also clear activity; a following idle event
preserves that outcome until busy/retry starts another turn. Its plugin forwards
root-session events sequentially and ignores status-idle and unknown replies.

This table describes the registered mappings in
[the adapter registry](../packages/core/src/agents/registry.ts). A mapping does
not prove delivery on a particular installed version; the agent/version
acceptance matrix remains separate. Codex CLI 0.166.0 lists newly installed
non-managed hooks as untrusted. Its native `/hooks` browser owns trust review;
Berth installation messages and session details expose that next step. The
[official hook documentation](https://learn.chatgpt.com/docs/hooks) describes
this requirement (checked 2026-11-01). Berth does not write trust state or inject
a bypass flag.

Hook health parses JSON or TOML and checks the required event set and command
targets. The generated OpenCode plugin has its own structural check. A marker
alone is insufficient. Inventory, setup diagnostics, installation offers and
bell fallback consume this shared health result. Runtime compatibility remains
a separate adapter acceptance check.

### 3.2 Arguments kept on resume

Resume rebuilds the command from the resume template plus the original
arguments that configure the session (model, profile, sandbox / approval
mode, added directories). It drops arguments that start new work: an initial
prompt, `--continue`, a different session id, one-shot / print modes. Each
adapter lists retained and discarded options with their arity. Retained options
support flags, required values and variadic values. Discarded selectors may also
have optional values. Unknown options fail closed into the recovery-options review
flow; they are not scanned for nested flags. The parser owns missing-value checks
for both automatic recovery and explicit recovery-option edits.

## 4. Edge cases every implementation must handle

1. tmux not installed, or installed but no server running (after reboot).
2. Two `ensure` calls at once (two terminals opening after a reboot).
3. A recorded cwd that no longer exists: `ensure` skips it, `doctor` reports it.
4. The agent binary missing at restore: skip with an installation/retry instruction; do not substitute a shell.
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
- The test helper refuses server-wide teardown or abrupt termination unless the
  effective endpoint starts with `berth-test-`. An explicit socket path takes
  precedence over a socket name and must pass the guard itself.
- Teardown kills only the test's own server. Interruption tests signal only the
  isolated server PID with SIGKILL; orderly `kill-server` can fire close hooks
  and must not be used as a crash simulation.
- Waits poll tmux state with a deadline; no fixed sleeps.

### 5.2 Files and environment

- `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` point into a per-test temporary
  directory. Hook install / uninstall tests run against agent config files
  created there. Parent Berth configuration, state, socket-path and agent-profile
  selectors are removed before test-specific values are applied.
- With `BERTH_KEEP_SANDBOX=1`, tests keep their temporary directory and print
  its path for inspection.

### 5.3 VS Code

`registry/environment.ts` checks the host without reading session inventory.
The CLI `environment --json` is transported asynchronously by the extension;
`doctor` skips discovery when tmux/platform prerequisites fail. Startup gates
inventory and layout onboarding on these base checks. Explicit launcher checks
preserve terminal-owned scripts; a selected built-in agent is checked only when
there is no custom launcher. The optional standalone scope checks PATH Node/npm,
while the extension checks its actual editor runtime.
Optional `lsof` and `sqlite3` findings describe the affected Codex capabilities
without changing environment readiness. Native Windows activation returns a
setup view before constructing any Unix backend or host registration.

`.github/workflows/verify.yml` builds on macOS ARM/Intel, Linux and Windows.
Unix jobs run the runtime suite; Windows runs the activation boundary and
onboarding tests. Linux also launches the built extension in an Xvfb desktop.
This is not a WSL, Remote-SSH or system notification click test. Release jobs
depend on this matrix. Remote hosts route notifications through the editor API;
local notification helpers must exit successfully within three seconds or the
extension falls back to an editor notification.

`dependency-install.ts` returns package-manager argument arrays without executing
them. The extension confirms the host and command, runs a native task with a unique
execution token, and rechecks on task completion, including failure or cancellation.
It does not install a package manager or change shell initialization. Installation
commands follow the [tmux installation guide](https://github.com/tmux/tmux/wiki/Installing)
and [Homebrew Node formula](https://formulae.brew.sh/formula/node); other Node
installations use the [official download guidance](https://nodejs.org/en/download)
(checked 2026-11-07). Tests inject executable/version/access probes and inspect
plans without installing system packages.


- The extension's logic lives in a view model and a controller that never
  import `vscode`; they talk to the editor through a small host interface.
  `npm test` runs them against a fake host and a test tmux server (§5.1), which
  covers V1–V7 without opening an editor window.
- Layout preparation uses `profileSetup.ts` and a bundled detached bootstrap
  worker. The desktop adapter accepts local `file:` and `vscode-userdata:`
  storage, reads the native registry without modifying it, and identifies owned
  Profiles by ID and token. The native `_files.newWindow` command reuses the
  current window to create the absent Profile; reopening the already open
  workspace directly would bypass creation. After installation, the destination
  restores the exact saved workspace. Existing owned Profiles use their native
  Profile-entry command. These native internals require version-specific checks.
  The worker writes settings only to a new resource, snapshots the installed
  Berth payload and installs it through the native CLI. Same-token retries preserve
  subsequent user settings. Native settings watchers may start after the worker
  creates the file; the worker refreshes its modification time until the destination
  acknowledges the token. A configuration-change listener completes activation.
  Workspace restoration is limited to first preparation. Source settings and
  legacy journals remain untouched.
  `profileBootstrap.test.ts` covers destination ownership, retries, installation
  failure and path boundaries; native acceptance must additionally verify reload,
  source/shared settings, workspace restoration and extension availability.
- Find a Session passes an asynchronous session-list promise to native Quick Pick;
  branch enrichment is separate and only used for sidebar inventory.
- Connection labels prefer the application declared by a matching live host
  registration, then process/terminal evidence. The native host fixture checks
  the bundled CLI's returned application against the editor's own application name.
- Attach-hook effects run under the shared state lock and require a current
  client tty in the event session; the current client supplies terminal type.
  A stale event cannot mark a different pane or consume a hook-install hint.
- Attachment ownership checks query live core inventory; cached presentation rows
  do not authorize metadata writes. Controller regressions cover both management
  transitions between inventory and main/side attachment.
- Native attachment acceptance keeps an independent tmux control client attached
  while main, side and manually opened VS Code terminals detach. The remaining
  client PID must match that independent client; the session must stay alive.
- `.vscode-test.hosts.mjs` verifies live workspace claims in isolated editor
  processes. Use one absolute temporary `BERTH_TEST_HOST_ROOT` named `berth-test-*`.
  Start `BERTH_TEST_HOST_PHASE=leader`; after its `leader-ready` marker, run `other`
  and `follower` in sequence while the leader remains open. Wait for all three to
  exit, then run `restart`. The profiles are separate; workspace/session state and
  the test tmux endpoint are shared. `other` has the same folder basename at a
  different path. Each invocation uses `vscode-test --config .vscode-test.hosts.mjs`;
  `BERTH_TEST_VSCODE_PATH` selects a previously verified editor installation.
- `test/native/layout-profile.mjs` tests the installed candidate in an isolated
  Linux desktop. It creates/cancels through native Profiles, selects Extensions
  → Default to retain the installed VSIX offline, switches into Berth and back,
  and checks original/all-profile settings and legacy journal bytes. Use the
  clipboard runner's executable, CLI, VSIX and viewport variables; set
  `BERTH_TEST_SOURCE_PROFILE=Original` for a named-source scenario. The runner
  bootstraps that profile in a separate editor process before installing into it.
  Earlier in-place layout fixtures are retired; their failures remain in the
  [target-boundary receipt](assets/code-review/configuration-target-review.json).
- `test/native/clipboard.mjs` drives the real editor through Playwright Electron.
  Use an isolated display, `BERTH_TEST_VSCODE_PATH` and `BERTH_TEST_VIEWPORT`
  (`1440x900` or `1280x800`), with a separate invocation for each viewport.
  It creates private user data, extension storage and a test-only tmux server,
  reads the native clipboard, checks copy-button focus, Escape returning to
  the row and first pointer re-entry after closing. It also checks native Find
  cancellation, no-match results, keyboard opening and pasting the copied folder
  into a scratch file, saving it and reading it back. Set `BERTH_TEST_VSIX` and
  `BERTH_TEST_VSCODE_CLI_PATH` to absolute candidate/CLI paths to install and test
  the package without `extensionDevelopmentPath`; otherwise it loads the development extension.
  This proves interactions, not visual
  quality or accessibility beyond the stated keyboard checks.
- `npm run test:vscode` runs a real VS Code instance through `@vscode/test-cli`
  with a temporary `--user-data-dir`, `--extensions-dir`, workspace and test
  tmux socket, so settings writes stay throwaway. Its child environment clears
  inherited variables before retaining only basic execution/display settings and
  assigning temporary HOME/XDG roots; parent credentials, profile selectors and
  tmux/editor IPC variables do not enter the test editor. It opens a window, so it is
  run deliberately, not as part of `npm test`.
- Remote-SSH, Dev Containers and WSL are covered by manual acceptance (§6),
  not automated.
- `npm run test:webview -w berth` runs the production webview bundle in
  background Chrome through Playwright, using models from `buildTree` and
  isolated browser contexts. A loopback server serves only fixture HTML and
  the required assets. Cases use the browser clock for timing, semantic
  locators and automatic waits; failed cases retain traces. Set
  `BERTH_REVIEW_OUTPUT` to keep evidence in a chosen directory. The suite
  covers pointer transit, text selection and clipboard copy, keyboard entry
  and return, dismissal messages, source updates, scrolling and resizing.
  Browser automation does not certify native host keybinding dispatch or
  screen-reader speech. See the [session details review](session-details-review.md).

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
conversation. This provider-backed journey currently covers Claude Code.

Usage is kept low on purpose, to limit cost and avoid tripping provider
abuse controls: the smallest model, one short prompt (about one request per
run), nothing sent after resuming, no retries, and at most one run every six
hours unless `BERTH_LIVE_FORCE=1`. Hooks are passed with `--settings`, so the
user's agent settings are not modified; the agent still records the
conversation in its own history as it always does. Runs only with
`BERTH_LIVE=1`.

`BERTH_CLAUDE_LOCAL=1 node --test packages/core/dist/test/live/claude-local.test.js`
uses a temporary Claude profile, synthetic API key and loopback Messages endpoint.
Only the empty fixture directory receives trust. The test covers exact-ID resume,
a failed API turn, a successful subsequent turn and an approved shell command
with verified output while the next model response is held. It also checks
cancellation, manual denial with denied-command file absence, idle reconciliation
and subsequent turns on the same conversation. Inventory queries one recorded
Claude profile per pass outside the lock, then revalidates ownership and activity
revision before clearing stale activity; see CR44 in the code review.

`BERTH_CODEX_LOCAL=1 node --test packages/core/dist/test/live/codex-local.test.js`
runs the installed Codex CLI against a loopback-only model fixture. It verifies
binding, two working/done turns, server loss, exact-ID `ensure`, a third turn
and the recovery acknowledgement. It then approves a harmless tool call, checks
post-tool working state, interrupts the pending model response and submits a
new turn. It also rejects a second command, verifies that its output file does
not exist and checks the next prompt on the same conversation. HOME,
configuration, history and tmux are isolated. The fixture bypasses trust only for its own inspected test hooks; it
does not certify native trust-review UI or external inference. Codex `Interrupt`
clears state and note without emitting done.
Independent title-generation requests receive separate fixture responses.

`BERTH_KIMI_LOCAL=1 node --test packages/core/dist/test/live/kimi-local.test.js`
uses installed Kimi with an isolated profile and loopback Chat Completions
fixture. It creates a custom agent, completes a turn, kills the isolated tmux
server, resumes the exact conversation and verifies the custom agent prompt.
It then interrupts a pending turn, approves and rejects tool requests, checks
command side effects, injects a provider failure and completes subsequent turns.
The fixture skips a native update prompt without installing an update; it does
not certify external inference. CLI update checks may contact
the vendor even though model requests stay local.


`BERTH_OPENCODE_LOCAL=1 node --test packages/core/dist/test/live/opencode-local.test.js`
checks native OpenCode initial binding, restored history and exact-ID
acknowledgement after a subsequent turn. It also checks held model work,
interruption, injected authentication failure, approval with proof-file contents,
rejection with file absence, and successful subsequent turns on the same ID. `BERTH_OPENCODE_BIN_DIR` can point to
an isolated CLI installation's binary directory. Bootstrap may download plugin
dependencies independently of the loopback model fixture. To isolate that step,
prepare a separate directory with `npm install --prefix <fixture-dir>
--ignore-scripts @opencode-ai/plugin@<tested-version>` and set
`BERTH_OPENCODE_FIXTURE_DEPS` to it; the test copies its manifest, lock and
installed dependencies into the temporary profile. No daily profile is used.


`BERTH_GEMINI_LOCAL=1 node --test packages/core/dist/test/live/gemini-local.test.js`
checks Gemini custom-home hook installation, binding, successful completion,
exact-ID/history recovery from a different selected home, tool approval and
rejection, a second pending approval after the first is accepted, cancellation,
provider failure in both error verbosity modes, and
successful next turns. `BERTH_GEMINI_BIN_DIR` selects an isolated binary directory.
Settings, state, credentials and model traffic use a temporary profile and
loopback fixture. Input uses bracketed paste and respects Gemini 0.66.0's
40 ms paste-submit guard before Enter; rendered input alone is not submit readiness.
`agents/gemini-state.ts` captures a verified hook transcript
cursor and reads typed native cancellation/error records. A terminal error can
clear done only after the loop-end hook; it cannot clear ongoing work. `registry/native-state.ts`
shares profile scheduling and ownership/revision validation with Claude native
observations. The cursor is live-only; it cannot authorize recovery or binding.

`BERTH_COPILOT_LOCAL=1 node --test packages/core/dist/test/live/copilot-local.test.js`
checks native Copilot binding, completion, profile preservation and exact-ID/history
recovery, provider failure, cancellation and successful next turns with an offline
loopback provider. `BERTH_COPILOT_BIN_DIR` selects the
binary directory. Only the generated temporary folder receives one-process trust.
Copilot 1.0.105 acknowledges resumed identity on the first submitted prompt;
opening its history alone is not confirmation. Tool cases cover approval, denial
with feedback, proof of non-execution, two pending approvals and model continuation
after all decisions. The fixture reads the command inside the active approval card before submitting
a decision. Concurrent tools can present their cards in either order; transcript
text does not identify the current decision target.

`agents/transcript-cursor.ts` owns bounded append-only reads, header identity,
profile-root containment, inode and prefix validation for native JSONL readers.
The Copilot reader recognizes the native 1.0.105 root turn-end/session-error
or user-initiated abort sequence; error hooks during retries are not terminal evidence.
Approval requests and completions match by request/tool IDs. Only a subsequent
model turn with no observed pending approvals can change waiting to working.
Native observations carry their intended state through the existing ownership
and revision checks. Unknown approval shapes do not produce a transition.

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
- **C10** An unbound agent is skipped with explicit recovery guidance. Shell
  sessions reopen without a conversation ID.
- **C11** `hooks install` / `uninstall` per agent are idempotent and leave
  unrelated hook entries intact, for every hook format (nested JSON, flat
  JSON, Copilot's own file, Kimi's TOML block, the OpenCode plugin).
- **C12** Every edge case in §4 has a test.
- **C17** After the tmux server ends, a session started before `ensure`
  runs does not erase the others from the snapshot; a session ended in the
  same server is not restored; `forget` drops a stopped one and refuses a
  running one.
- **C16** A session started without Berth whose pane runs an agent (also
  behind a launcher shell or an interpreter) becomes managed with that agent,
  the agent's command line and directory; it is in the next snapshot and comes
  back; a pane running no agent is left alone; `BERTH_AUTO_ADOPT=0` turns it off.
- **C14** With `berth tmux install`, a bell in a session whose agent has no
  installed hooks sets `waiting` / `bell`; one whose installed hooks report
  waiting is left alone unless native hook trust is independent of file configuration.
  Existing explicit waiting details survive a bell; showing the session clears
  only a bell-raised `waiting`.
- **C15** Starting or adopting a session for an agent whose hooks are missing
  prints the install command on stderr; session rows report `hooks`
  (`installed`, `missing`, `broken`, `unknown`, `none`); a non-VS Code client attaching is told
  once per agent per tmux server.
- **C13** Every baseline adapter passes its unit tests (§5.4) and its spec §8
  row records its source (help-checked, official docs, or cmux).
- **L1** (live, manual trigger) Every installed baseline agent resumes its own
  conversation after the server is killed.

### Milestone 2 — Berth for VS Code

- **V1** The session view shows the cards of spec §6, grouped by cwd: line
  one the agent's icon, name and state badge; line two the notification while
  waiting or done, else the topic. Connection markers stay at line one's far right,
  after the fixed state/unread slot; multiple connections use a backing outline, when `berth.view.details` is on. No third or empty
  reserved line; connection and activity metadata remain icon-only at every width, with numeric
  a stacked multi-connection mark and a fixed activity slot. Exact client
  identities and counts belong to hover details. Window membership, active
  terminal and selection are independent; hover retains full connection values.
  The hover card's lines each have an icon; the
  waiting-count badge.
- **V2** Selecting a row focuses its matching Berth Editor terminal or opens
  one without switching/disconnecting another session. For unowned connections
  in this window, confirm the Editor attachment before detaching captured source
  clients; revalidate source PID/TTY and destination session before each detach.
  Failed attachment preserves original connections; switched/disappeared sources
  are skipped. Do not dispose source terminals or kill their shells or sessions.
  External connections open directly in a local Editor without a confirmation
  prompt, preserving external clients. Repeated selection reuses the owned view;
  handoff must not leave an incidental +1. Genuine external or explicit side-view
  connections remain counted. Unknown PIDs defer a new attachment only when the
  target already has clients. A detached target and a verified owned view remain
  usable; only identified local clients qualify as handoff sources. Stopped sessions
  rebuild first; open to the side explicitly adds a view. Agent identity does
  not change these rules. Explorer follows only local folders.
  Reload acceptance: with native persistence enabled, open multiple Berth Editor
  terminals and a side view, reload, and verify the same native terminals remain
  connected without focus changes, extra clients or a fallback tab. Recreated
  extension hosts recover ownership from explicit creation metadata, or the
  matching marker in a verified live terminal process when native revival omits
  that metadata. Cache process evidence only for that terminal object and PID;
  discard it when the terminal disappears. Resolve current sessions from live PIDs. Unknown terminal identities defer startup;
  mismatched owner tokens must not confer Berth ownership.
- **V3** New / attach / detach / rename / kill / adopt act on the test server;
  a custom launcher runs in the session terminal in the chosen folder with its
  placeholders filled; the terminal then learns its session from tmux, and a
  session the launcher did not stamp is adopted with the chosen agent and the
  directory of its active pane.
- **V4** On startup, missing `vscode`-origin sessions are rebuilt and one is
  shown in the session terminal; sessions of other origins are not.
- **V5** Native tabs show state through `${progress}` and `${sequence}`.
- **V6** Waiting and done produce an in-editor notification. Native helper launch
  failures are contained by `notifications.ts`; missing executables and denied
  launches cannot interrupt the host or the in-editor action. macOS helper
  discovery uses PATH inspection rather than a synchronous `which` subprocess.
- **V7** Native layout profile import and switching preserve original profile
  settings, all-profile values and legacy journals. Cancellation changes nothing;
  switching back selects the original profile without restoring cached settings.
- **V10** *Go to Next Session Needing You* shows waiting sessions first, then
  unread ones, in name order, wrapping around.
- **V12** A plain shell never goes through the custom launcher; a launcher
  without `{agent}` is started without asking, and its session is adopted with
  the agent running in its pane. *New Session* takes the shown session's
  folder, else the only workspace folder, and asks only otherwise.
- **V13** Groups carry their place relative to the workspace (workspace,
  inside, outside) and are ordered by it; only the workspace folder's group is
  flattened; *New Session* lists agents in `berth.newSession.order` first.
- **V11** Missing hooks never prompt during inventory refresh or window reload;
  session details explain missing bindings. Explicit setup/readiness checks offer
  hook installation only for supported agents with an identified profile.
- **V8** (manual) The same flows work in Remote-SSH, a Dev Container and WSL.
- **V9** (manual) OS notifications appear and focus the session when clicked.
- **V14** (visual) The sessions view, rendered from a model built by the
  model code, looks right in dark, light and high-contrast themes: colours
  only on waiting and unread, dimmed stopped cards, indent guides, the
  selected card, and the hover card above the list. Checked headless with
  theme variables standing in for VS Code's, then in VS Code itself.
  Unread uses a 12px blue `pass-filled` Codicon, a blue normal-weight title
  (theme foreground when selected), and stronger supporting text; waiting retains amber with its actionable note, and working stays muted.
  Check both review viewports and focused selection: the fixed activity and host
  slots must not move. Visual changes must preserve the unread lifecycle.
- **V15** (manual, in VS Code) The view follows `workbench.tree.indent`,
  `workbench.tree.renderIndentGuides`, `berth.hover.delay`,
  `berth.view.details` and theme changes without reloading; right-click shows
  VS Code's menu with the card's actions; up/down, Home/End, Enter,
  left/right and Shift+F10 work; a screen reader reads each card's state.

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
- **R5** Releases go through `.github/workflows/release.yml`: pushing a tag
  `vX.Y.Z` (or `vX.Y.Z-pre`, published under `next` as a prerelease) checks the
  tag against both package versions, runs `npm test` on macOS, builds both
  distributable archives and extracts the matching changelog entry before any
  registry write, then runs publish dry-run and publication with the same
  explicit local archive path (`./out/...`), and publishes
  `@berthdev/berth` through npm trusted publishing (no stored token,
  provenance attached; a version already on npm is skipped), and creates the
  GitHub release with the npm tarball and the `.vsix`; a release that is not
  a prerelease then publishes the `.vsix` to the VS Code Marketplace through
  its trusted publishing (`vsce publish --oidc`, vsce 4.1.0 or later; a
  version already there is skipped). (human) Each registry trusts this
  repository and workflow once: npm with `npm trust github`, the Marketplace
  with a Trusted Publishing policy on the `berthdev` publisher.
- **R6** (human) Run the manual cases V8, V9, I5 following
  [manual-acceptance.md](manual-acceptance.md), and `npm run test:vscode`,
  before each release.

## 7. Prior art used

Resume commands and hook-event semantics come from cmux (GPL-3.0-or-later,
reference commit in spec §8) and AI Terminal Sessions (MIT), checked against
each CLI where installed. Agents not checked follow cmux's logic for that
agent. No code is copied from either; facts about third-party CLIs are
restated in Berth's own words, and each adapter module notes its source.

### Passive Codex binding

Discovery probes at most two eligible processes per inventory, rotating the probe
window; each `lsof` invocation has a 750 ms deadline and a 256 KiB output cap.
Only numeric writable descriptors owned by the exact producer are considered.
A single top-level CLI rollout must have a matching session-meta ID, inode and
filename; the metadata read is capped at 1 MiB. Recheck descriptor ownership,
process lifetime, single-producer ownership and tmux generation before publishing.
The profile comes from the observed rollout root, never directory recency.
Unsupported/shared-daemon clients stay unknown. `codex-binding.test.ts` exercises
first-install binding without hooks, malformed/foreign records, conflicting IDs,
multiple writers and reused process lifetimes. These are synthetic producer tests,
not a claim that every native Codex build exposes the required descriptor.

### Late binding across CLI adapters

`late-binding.ts` owns the allowlist of root-turn events. `handleHook` accepts
first identity only after producer ancestry and pane ownership checks, rejects
child-agent fields and differing aliases, and keeps recovery acknowledgement on
the start-event path. Persist newly bound IDs and their profiles before returning.
Test each non-deferred adapter through a synthetic producer and real tmux, plus
foreign IDs, subagent payloads, unrelated hook callers and pending recovery.

### tmux name compatibility in attachment tests

Native attachment fixtures must use names accepted across supported tmux
versions. tmux 3.8 rejects Tab in session names while 3.6a accepts it. Use
spaces, tilde and equals in native session names; retain control-character
coverage in the field codec and directory-path tests. This keeps attachment
transport coverage independent of upstream name validation.
