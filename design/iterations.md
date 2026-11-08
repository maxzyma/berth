# Iterations toward a complete Berth

This is the execution plan for the [product review](product-review.md).
Behavior belongs to [the spec](spec.md); this file records scope, dependencies,
acceptance and delivery state. A green browser matrix is not a completed product.

## Completion boundary

A developer can discover an existing agent, identify its conversation, open it,
answer it, leave it running, recover it after interruption, and deliberately
end or forget it without guessing what happened. This works in the supported
host and agent matrix, with explicit handling of unsupported cases.

Keep the product small: one inventory, one details surface, host-native commands
and settings, and one core that owns session truth. No chat interface, terminal
emulator, worktree manager, analytics dashboard or duplicate Git interface.
A plain tmux/agent-native workflow remains appropriate for users who do not need
cross-host session management.

## Extension boundary

Extension work must follow the
[core launch principle](spec.md#21-core-principle-terminal-led-launch-evidence-based-discovery):
the terminal runs the user's launcher and Berth discovers its result. The launcher
remains independent of Berth. A launch-result callback protocol is not an approved
roadmap item; session management must not depend on one. Agent-callable interfaces
may expose existing verified session operations without taking ownership of agent
startup. Autonomous dispatch and content handoff require a separate product
proposal that preserves this boundary.

The current plan does not include a separate plugin platform, extension SDK or
MCP service. Prioritize reliable session discovery, identity, activity and
recovery. Add support for new agents and hosts through the existing adapters;
serve concrete automation needs through existing CLI operations first. Revisit
an additional interface only when a specific workflow cannot be served by these
mechanisms, with its scope and maintenance cost justified separately.

## Session responsiveness investigation

**State:** Fixed in the locally installed candidate; the daily window needs reload.
The core removes confirmed stale UUID tickets and avoids `ps` for nonexistent
PIDs while retaining exact identity checks for live owners. Creation uses an
asynchronous core CLI worker and preserves the transaction and snapshot. Local
activation no longer waits for full discovery; terminal lifecycle revisions
reject stale inventory. Successful creation adds its verified row immediately.
Explorer follow returns focus to its triggering terminal and cancels obsolete
requests rather than focusing the older main terminal.

Pre-fix baseline (superseded): `593b1e9` plus local candidate worktree,
2026-11-07 23:05 +0800. Three inventory samples against 12 sessions took about
6–10 seconds. One sample started 2,082 `ps` processes; a call-site trace attributed
2,048 to ticket checks. Of 410 ticket records, 407 had nonexistent owner PIDs.
The old scan ignored those records without removing them and inspected each via
`ps` before checking existence. Worker timeout causing more stale tickets remains
an unverified amplification hypothesis.

Post-fix samples on the same host, now with 11 sessions: 1,361 ms / 45 `ps` calls
and 1,317 ms / 28 calls. These are individual samples with a changed session count,
not percentiles or a controlled end-to-end comparison. An isolated real-tmux
case with 500 dead tickets and snapshot hooks created a usable shell; creation
returned in 335 ms and `exit` removed its session in 14 ms. The closure snapshot
was verified and the unrelated session survived. These times exclude editor
rendering. A regression fixture now keeps a waiting command alive when its
pseudo-terminal supplies EOF; it no longer relies on the old idle-placeholder bug.

The final native API run in the isolated VS Code window passed creation plus
Berth opening, rapid terminal switching, file focus in another editor group,
exit, list reconciliation and preservation of the other session. Creation plus
opening measured 1,410 / 1,273 ms; terminal exit measured 308 ms. This verifies
API-observed focus and lifecycle, not a visual review of the rendered marker or
an automated traversal of the New Session picker.

The serial suite ran 383 cases: 370 passed, 11 skipped, and two failed. One was
the obsolete assertion that a dead ticket remains on disk; its replacement
retains the six-process mutual-exclusion check and requires reclamation. The
other was a version-probe failure that passed in isolation; the initial failed
probe's cause was not captured. Both and the new lock, worker and focus cases
passed the final five-case focused run. The full suite was not rerun after the
test-only assertion update.

Earlier candidate (superseded): `berth-vscode-0.4.5-responsive.vsix`, SHA-256
`3861e8f8761b2d07a1ed699055c5e5ca2dd7b050cd70473907e166be73aea894`.
That candidate was verified in both installations before the later updates.
Selection and the active-terminal marker remain distinct. Existing persistence
and recovery gates still apply; this is not a formal release.


Lifecycle update, baseline `593b1e9` plus candidate worktree, verified
2026-11-08 00:50 +0800: terminal open/close events now request a separate
coalesced `ls --json --known-only` read. Full discovery no longer gates membership
updates. Lifecycle revisions and publication order reject obsolete results;
known-session reads preserve sampled activity and do not emit notifications.
The full inventory also no longer computes and discards a duplicate list.

One same-host comparison of 11 sessions measured 129 ms for the known-session
read and 1,121 ms for full inspection. In the isolated editor, the actual sidebar
New Session / Shell picker and subsequent `exit` were exercised against both
candidates. The previous candidate measured 1,584 ms from command invocation to
the row appearing and 1,418 ms from sending `exit` to removal from the view model.
The new candidate measured 1,496 ms and 422 ms respectively. These are single
samples, not percentiles; creation improvement is small. The measurement includes
automated picker acceptance and observes the model sent to the sidebar, not pixel
paint timing. Creation remains a follow-up performance target.

All 68 controller/transport cases and the new real-tmux lifecycle case passed.
The latter verifies removal after closure evidence, preservation of an unattached
live session and recovery after server death. Build, whitespace and public-content
checks passed. Lifecycle candidate (superseded):
`berth-vscode-0.4.5-lifecycle.vsix`, SHA-256
`15f208e54477a2f9b7b66b794605768811b71c812c7af93b9a9c454b24112240`.
Both installed bundles match the archive; temporary native diagnostic commands
were removed. The isolated editor was reloaded. The daily editor needs reload.
No formal release was performed.

Creation follow-up, baseline `593b1e9` plus candidate worktree, 2026-11-08:
built-in creation now includes workspace ownership in the first snapshot.
Attachment completion acknowledges current activity and reads the row without
repeating that snapshot; a changed workspace still takes the normal ownership
update path. First attachment skips existing-client handoff inspection and does
not detach clients arriving concurrently. Existing-session opening keeps its
handoff checks. An already-ready environment no longer triggers full inventory
again before each creation.

Native diagnostic timing before these changes: preparation 360 ms, opening
314 ms (including 114 ms handoff inspection), completion 351 ms, command-to-row
1,240 ms. The final candidate measured preparation 602 ms, opening 285 ms,
completion 135 ms and command-to-row 1,340 ms; exit-to-row-removal was 210 ms.
Intermediate command-to-row samples were 1,254 and 1,341 ms. The removed repeated
work is verified, but these samples do not establish lower end-to-end latency;
preparation cost and contention remain an investigation target. Measurements
include picker acceptance and observe the view model, not native pixel painting.

The controller/transport regression run passed 69 cases. After the final
first-attachment change, the three affected shell, ownership and existing-client
handoff cases passed. The new ownership test proves the initial recovery record
contains its owner, unchanged completion adds no snapshot, and changed ownership
is still saved. Build and public-content checks passed. Creation candidate (superseded):
`berth-vscode-0.4.5-create.vsix`, SHA-256
`cb4ec8eb56ee70e22892608a9880ac45897cffd3746d06362dc53dbefc205b63`.
Daily and isolated installed bundles match this archive; native diagnostic
commands were removed. The daily editor needs reload. No formal release.

Selection background follow-up, `593b1e9` plus candidate worktree,
2026-11-08: the terminal accent used host activity, while the background used
only the last clicked row. Verified terminal changes now select the corresponding
row, including a newly created unmanaged shell. Unrelated inventory preserves
explicit selection; opening a file clears the terminal accent without clearing
selection. Keyboard focus and scroll are not moved. This resolves the identified
background synchronization defect; the unmanaged marker fix remains in place.

Ten targeted Chrome cases passed across dark/light themes at 1440×900 and
1280×800. Four switching cases were then rerun to capture the unfocused sidebar
background; all passed. The dark and light rendered captures were visually
reviewed. Current candidate: `berth-vscode-0.4.5-selection.vsix`, SHA-256
`6cad79c281fa71dfa81396686f0a9f5a432cafd97c4c245960932bb112ae45cf`.
Installed payloads match the archive (the editor adds package metadata). The
isolated window was reloaded; daily-window acceptance needs reload. No formal
release. This change does not establish an end-to-end creation speed improvement.

Creation preparation follow-up, `593b1e9` plus candidate worktree, 2026-11-08:
profiling `berth new` showed most of its time in the snapshot it requires:
discovery read the whole process table and every pane's process arguments, and
every managed pane was captured again. The creation snapshot now skips discovery
and keeps each other live session's newest saved scrollback when its identity
matches (spec §5.3). Session metadata is written in one tmux call; a value's
final `;` is escaped, which also stops tmux from truncating such values.
Attachment confirmation compares the terminal PID with the session's client PIDs
before reading process ancestry.

On an isolated server with 12 shell sessions, `berth new` took 379–588 ms
(median 547 ms, five samples) before and 181–352 ms (median 204 ms) after. These
are CLI samples, not editor command-to-row timings. Three new regressions cover
the creation snapshot, metadata separators and attachment; the full suite passed
(378 passed, 11 skipped, 0 failed). Candidate:
`berth-vscode-0.4.5-create2.vsix`, SHA-256
`711522b22287e80e181ee90fb2b2e6cd5103d0be76bc0ca8486d6578884c4617`, installed
locally; the daily editor needs reload. No formal release.

Hook setup and maintenance, same baseline, 2026-11-08: hooks written by
`berth tmux install` record the runtime and CLI that ran the installer. A
standalone CLI that is never upgraded keeps running old code against current
state, and a removed runtime silently disables the hooks; setup also depended on
users reading the README. VS Code now installs tmux hooks with the editor runtime
and the Berth-owned runtime file and repairs a block whose targets are gone. A
setup reminder offers missing or unusable agent hooks and absent or foreign tmux
hooks after startup (agents in live sessions) and after creating an agent
session, in one notification with remembered answers (spec §8). The README no
longer presents the standalone CLI as required. Diagnose Problems shows the tmux
hook state.

Chosen session names (rename, `--name`) now accept CJK, spaces and other
characters tmux keeps; only `:`, `.`, control characters and surrounding spaces
are refused, explained while typing. Default folder-derived names are unchanged.
Rename runs through the core CLI outside the editor event loop and takes a change
snapshot that keeps saved scrollback by session identity under the new name.

New regressions cover hook block inspection, the reminder policy, rename input,
transport and snapshot, and a CJK-named session through rename, snapshot and
rebuild after server loss; the full suite passed (386 passed, 11 skipped, 0 failed).
On the development machine the tmux block recorded an older standalone CLI; it
was replaced through the runtime command, the configuration parsed, inspection
reported current and the hook command started. Agent and tmux hooks there are
healthy, so the reminder and the repair notice still need native review on a
machine with missing or stale hooks. Candidate: `berth-vscode-0.4.5-names.vsix`,
SHA-256 `cece28a95d0e0f8c121f7f5fd6d300e14b6d3045d410c77bc03845571362fb04`,
installed locally; the daily editor needs reload. No formal release.

Conversation naming, `4d23e49` plus candidate worktree, 2026-11-08: a rename
reached tmux and the terminal title but not the agent's conversation name.
Each of the eight adapters was checked against primary evidence (spec §4.2.1).
Codex is named through its app-server `thread/name/set` over the running
daemon's control socket, which speaks WebSocket; plain JSON lines through
`codex app-server proxy` receive no reply, and the socket link can exceed the
Unix socket path limit, so Berth connects to its target. Against an isolated
Codex 0.166 daemon, `berth rename` updated the thread name in 132 ms; while the
daemon is stopped the rename stays pending for the next Codex hook. Claude Code
(SessionStart, UserPromptSubmit) and Qoder (UserPromptSubmit) receive the name
as hook output `sessionTitle`; Berth's OpenCode plugin applies it through its
SDK client. Qoder recovery now passes `--name`, as its launch already did.
Copilot, Kimi Code, Gemini and Cursor offer no path that avoids the agent's
terminal for a session Berth runs; Copilot's `--name` names only new sessions
and is unverified on the recorded version. Binding never pushes a default name
over the agent's title. Whether running agent UIs show a new name immediately
was not observed.

State lock waits, same day: a window reload reattaches every editor terminal;
each `client-attached` hook ran discovery under the state lock (about 0.5 s
with 14 sessions), so startup restore, which waits 3 s, reported "another
restore is running". Reattaching managed sessions no longer runs discovery;
startup restore retries a busy state; lock timeouts name the holding process;
editor-host waits are capped at 5 s.

New regressions cover the WebSocket exchange, rename naming, Claude, Qoder and
OpenCode hook naming, delayed Codex delivery, binding without naming, managed
reattach without discovery, busy startup and the lock wait cap; the full suite
passed (395 passed, 11 skipped, 0 failed). Candidate:
`berth-vscode-0.4.5-allnaming.vsix`, SHA-256 `c897c7dd29f91359d9690863e319b5c63a0c848e11e5cbb03447db84ccc7f3d6`, installed
locally; the daily editor needs reload. No formal release.

## Automatic Berth layout preparation

**State:** Local candidate. On macOS VS Code 1.143.1, the isolated native
command path creates the independent Profile, loads the preset, installs Berth,
restores the original folder and reuses the same Profile on a second invocation.
Source settings remain byte-for-byte unchanged. Focused bootstrap checks and seven onboarding tests pass. Failed Use leaves
onboarding eligible after reload; only Keep persists an opt-out. The older
acknowledgement boolean is ignored because it was written before setup succeeded. This is command-path evidence, not visual acceptance or
a completed cross-platform release gate.

Remaining acceptance: dirty-editor cancellation, untitled workspaces, all-profile
overrides, installer failure after native switching, named source Profiles, and
other editor versions. Multi-root restoration and JSONC preservation passed in
the native candidate journey below. The older
manual-import native runner does not validate this bootstrap.

Selecting Use must automatically prepare and activate the preset in the same
window. Verify absent, existing, already-active and same-name user-created
Profiles; cancellation of dirty-editor prompts; interrupted preparation and
retry; multi-root/untitled workspaces; unchanged source/shared settings; and
availability of the installed Berth extension after switching. Merely creating
an empty Profile or opening a creation/import screen is a failure.

Investigation baseline: `593b1e9` plus local layout changes, 2026-11-07.
VS Code 1.143.1 creates an empty missing Profile during window opening with
`forceProfile`; CLI extension installation with `--profile` requires that
Profile to exist (isolated probe returned `Profile 'Berth' not found`). These are
different paths. Native import offers configuration review, not unattended
preset creation. Reopening an already open workspace bypasses Profile creation
in the native window manager. The adapter must initialize within the same window
and then restore the exact workspace; it must not fall back to manual creation.
Native desktop extension storage uses `vscode-userdata:` as well as `file:`;
rejecting the former incorrectly rejects supported local windows.

The pre-0.4.0 implementation applied layout settings directly and opened the
sessions container. It did not create an independent Profile. The later native
acceptance runner explicitly clicks Create; its passing result does not verify
unattended setup. Source inspection at the same VS Code commit confirms that
[Profile URLs](https://github.com/microsoft/vscode/blob/e646868227c3e3a9e3f24277c8c7220be42c0be7/src/vs/workbench/contrib/userDataProfile/browser/userDataProfile.ts)
open the Profiles editor, while
[createAndEnterProfile](https://github.com/microsoft/vscode/blob/e646868227c3e3a9e3f24277c8c7220be42c0be7/src/vs/workbench/services/userDataProfile/browser/userDataProfileManagement.ts)
is an internal service rather than an exposed extension command. The selected
design retains an independent Profile and automatic preparation; direct changes
to the source Profile are outside the onboarding contract.

## Candidate native acceptance

Window-close follow-up (2026-11-07, baseline `593b1e9` plus local changes):
VS Code 1.143.1 failed to attach saved PTYs after window close and launched
default shells; Berth then opened the detached managed session. The prepared
Profile now enables persistence across window close as well as application exit.
Verified prepared Profiles receive missing settings once, preserving explicit
overrides. Existing fallback shells are retained because their titles do not
prove ownership. The follow-up candidate is installed only in the isolated
acceptance environment. The build and 69 affected controller, Profile and persistence
checks passed. One native File-menu close/reopen round preserved the four-terminal
count (three pre-existing fallback shells and one managed attachment), all three
tmux pane PIDs, and one client attached to the intended managed session. The
prepared Profile has both persistence settings. Existing fallback shells still
logged missing-PTY warnings; they were not deleted. This verifies the managed
attachment in this round, not cleanup of historical native terminal state.
The earlier candidate hash below does not describe this follow-up build.
The local full regression after the persistence change passed 364 tests with
11 expected skips and no failures. The window-revival archive hash is
`b036f519353ebc7faf904f12fbed403df3e680eb8deaa8fc872d5379e88940f8`;
all 33 installed payload files matched it (installation metadata excluded).

Notification follow-up: a system banner was reported visible, but its click/Open
outcome was reported ineffective. Runtime inspection found the named target active
with a matching tmux client, so application focus and user action attribution
remain unresolved. Inspection also found that helper success omitted the editor
Open action. The candidate now retains that action in the originating window
independently of OS delivery, with foreground suppression unchanged. This change
passed all six targeted notification tests. Its isolated installed archive hash is
`229daebb419652b015793669b4dab8ec2a778595077b05349b46fce14a13816e`;
all 33 payload files matched. Native reacceptance is pending; the full regression
above predates this change.

**State:** Release acceptance remains open. Baseline `593b1e9` plus local changes,
2026-11-07 12:27 +0800; VS Code 1.143.1 on macOS arm64.
The isolated installation uses temporary HOME, state and tmux endpoints, with
in-memory secret storage. No production agent credentials are required.

The candidate VSIX SHA-256 is
`8cafee9c5f72dac590bdad5da1279ddf529f5c5ea3da863c8ae682426c5acf0e`.
The isolated installed payload matches all 33 packaged files, excluding only
VS Code's added manifest installation metadata.

Native testing found and corrected these defects:

- Environment preflight rejected Shell's intentional empty launch command.
  It now accepts tmux's default shell while rejecting missing explicit overrides.
- A version process that ignored termination could outlive its deadline. Dependency
  probes now use forced termination after the existing timeout.
- Profile reuse parsed user settings as JSON, rejecting valid comments and trailing
  commas. It now reads JSONC without rewriting the file and rejects malformed input.
- The JSONC dependency's CommonJS entry left unresolved modules in the packaged
  extension. Both extension and bootstrap builds now prefer the package's module
  entry; a test loads the actual bootstrap bundle in a separate process.
- Native terminal revival omitted creation metadata, causing startup to overlook
  a live local session and open another detached session. Window presence now
  includes verified terminal-PID/tmux-client mappings. Reuse additionally requires
  the matching owner marker from creation metadata or the live process; foreign
  and missing markers cannot establish ownership. The process check is bounded
  and never logs the environment.
- Install confirmation omitted the selected package manager's absolute path.
  It now displays the executable and target host before execution.
- Native Windows activation constructed Unix host registration before its
  environment check. It now offers remote-host guidance before backend access.
- System notifications treated process spawn as successful delivery. Helpers now
  have a three-second deadline and must exit successfully; failure falls back to
  the editor. Remote extension hosts use editor notifications directly.
- A clean Linux installation lacked optional `lsof` and `sqlite3`. Diagnostics
  now explain the affected Codex capabilities without blocking basic use.
- A stale native terminal with an unresolved PID blocked every session open.
  Controller and host checks now scope the wait to new attachments whose target
  already has clients. Detached targets and verified owned views remain usable;
  unknown terminals never become handoff sources.

Completed native cases: automatic layout preparation, four packaged integration
cases, both Shell creation routes, empty and matching session search, details
open/close, terminal-preserving window reload, working/done/unread transitions,
and file browsing in a separate editor group. Normal installed-window Profile
round trips preserved an unsaved draft, the multi-root workspace and JSONC
comments without creating another Profile.

The missing-tmux journey passed cancellation without execution and approved-task
execution followed by a real tmux version recheck. The package manager was an
isolated fixture; this does not certify a real package installation. Optional
standalone Node/npm diagnostics were visible. An earlier environment probe
resolved system Homebrew through VS Code's login-shell PATH; Homebrew rejected
this host OS before installing a package. The corrected test supplies an exact
isolated PATH and verifies the executable in the confirmation before proceeding.

Browser coverage passed 110 cases at both declared viewports. Five isolated native
Claude/Codex lifecycle cases passed against a loopback model fixture. Before the final controller guard change,
complete macOS regression passed 362 tests, with 11 skipped and no failures.
Ubuntu 24.04 ARM64 with Node 22.22.0 passed 359, with 14 skipped and no failures.
VS Code 1.145.2 on the same Linux VM passed all four native integration cases
(activation, file/terminal group placement, real attachment/detach and settings);
the separate cross-process ownership case was not enabled in that runner.
The first Linux run failed four Codex cases because the clean host lacked `lsof`
and `sqlite3`; after installing these prerequisites, the affected nine cases and
the complete suite passed. The release matrix now installs these test prerequisites.
After narrowing the controller guard, all 64 affected controller, ownership and
platform tests passed on each OS. The packaged native notification journey then
passed with a genuinely unresolved sibling terminal: the background editor
fallback appeared and Open attached the exact target. Clipboard and unchanged
webview evidence were reused.
Version parsing/cache assertions use an injected deterministic probe; timeout
and other native probes retain subprocess coverage. An earlier full run hit the
one-second boot-identity probe deadline. The focused rerun and final full run
passed; the timeout remains recorded rather than claimed to be eliminated.

The packaged restart test now preserves exactly one attached terminal, workspace
and Profile after CDP browser close and application restart. Selecting the revived
session again keeps its PID and terminal count; before ownership recovery was
added, selection replaced that process. Before the fix, this
same journey opened a second detached session. Three focused startup and three ownership regressions passed, including a real
process marker check and rejection of foreign markers. The later user-operated File-menu close/reopen round is recorded above;
application quit remains distinct from window close. Earlier forced
fixture restarts left stale shell tabs; those mixed-fixture observations are not
used as evidence for the clean restart result.

Native clipboard round trips passed for the session name, a long path with spaces
and Unicode, and a conversation ID. Each value was copied from details and pasted
into a real scratch editor; the original system clipboard was restored.
Before notification permission was enabled, the helper returned exit 3. The package
showed the editor fallback, and Open attached the exact session, verified by the
native terminal PID matching the tmux client. A terminal-name assertion was not
used as the identity oracle.

iTerm2 3.7.0 passed isolated attach, `user.berthSession` marking, detach, reattach
with the same pane process, and session survival after the test shell exited.
The test window was closed and both pre-existing windows remained open.

Remote-SSH 0.128.0 connected the macOS client to the isolated Ubuntu host. Native
open, reload, repeated selection and application close/reconnect retained the
remote pane process and restored one client. A verified background client received
the editor notification. Profile preparation was not attempted on the server.
The final installed candidate also passed remote reload and reuse. The temporary
Linux VM and remote editor were removed after acceptance; the local isolated
candidate window remains available. No daily iTerm2 window was restarted.

Plain-shell launch fix (2026-11-07, base `593b1e9` plus local candidate):
new and recovered shell sessions respawned the temporary staging command because
no replacement command was supplied to tmux. The native symptom was an attached
terminal with a blank screen and a Node/Electron idle process. Both paths now use
one helper that explicitly starts the configured default shell in login mode.
A regression executes input in both a fresh shell and one rebuilt from a snapshot,
and checks the working directory. All 33 affected creation, recovery, transaction
and frontend tests passed. The reported empty sessions were replaced with real
shells and their prompts verified; the first empty-string repair exited instead
of starting a shell, so those two sessions were recreated. No agent conversation
was running in those staging processes. The local VSIX (SHA-256
`63282796d41b48dd6483a78c0cd97283f68756ae45b2adabcc61bbdae89b4591`)
was installed into the daily and isolated editor extension directories; bundled
CLI and extension bytes match the package. Reload remains necessary for active
windows. Notification attachment alone is not
accepted as proof that a terminal is usable.

Native iTerm2 follow-up (2026-11-07 21:42 +0800, base `593b1e9` plus local
candidate): concurrent attach exposed a hook identity bug. Current-client formats
could name another client; client hooks now pass `hook_client`, resolve its live
session and tty, and revalidate under the lock. Terminal identification arrived
about three seconds late for inactive split panes; a bounded five-second wait
outside the lock preserves unknown values without guessing. All four native panes
received the correct binding, and 24 affected core tests passed.

Application-menu Quit and restart passed once with two windows, three tabs and
four panes, unchanged tmux pane PIDs and one client per session. This exercised
synthetic shell sessions, not agent conversation rebuilding.

Crash recovery has a verified native-save boundary (2026-11-07 21:49 +0800,
base `593b1e9` plus the same local candidate). Before a save, the restoration
database still named terminated processes from the previous quit. Forced exit
then reopened that saved layout and placed surviving clients in an orphan window;
Berth AutoLaunch added duplicate attachments to the restored shells. Disabling
AutoLaunch reproduced the extra native window, without duplicate attachments.
After activating then hiding the isolated application, the database held the live
terminal identities. Forced exit and restart then preserved the two windows,
three tabs, four pane bindings, client ttys and original tmux pane PIDs. The
[source save trigger](https://github.com/gnachman/iTerm2/blob/v3.7.0/sources/AppKit/iTermApplicationDelegate.m)
is `applicationDidResignActive:`; the
[orphan adopter](https://github.com/gnachman/iTerm2/blob/v3.7.0/sources/Tasks/iTermOrphanServerAdopter.m)
opens surviving unclaimed processes separately. This explains the failing and
passing conditions; it does not claim that crashes before a native save are fixed.
No daily instance was quit. Test runtime: macOS 26.6.2, iTerm2 3.7.0, Node 26.13.0.

A local core guard now accepts the startup ttys already running tmux in the same
iTerm2 instance and returns no automatic attach command when one is a live client
of the target session. The adapter takes one snapshot before restoring any pane;
manual attachment remains available. Fourteen affected tests passed and the full
local suite passed 367 cases with 11 opt-in skips. The strict-query
refinement then passed the same 14 affected tests. Native stale-save crash retest
remains required before this guard is accepted. The final VSIX must be rebuilt
after that check.

Remaining in this acceptance scope: system-notification activation, the editor
Open retest, and the native stale-save crash test of the duplicate-client guard.
The notification retest uses a fresh target with no client. Its isolated editor
still reports focused after application switching, so that observation cannot
serve as a background system-notification test. Machine reboot remains optional.
Windows/WSL desktop and a new remote CI-matrix run are excluded from this round
by maintainer decision (2026-11-07); neither is recorded as passed. Historical fallback-shell warnings
remain in the mixed local fixture; safe handling and clean-fixture coverage remain
to be assessed. Foreground operation is authorized. The desktop-control connector
still fails to start after its service was restarted; the visible Computer Use
Accessibility permission is enabled. After the user enabled notification permission,
the helper returned exit 0 and the user saw a banner, but click activation remains
unverified. No system permission database was reset.
The Windows CI job checks build and activation boundaries, not a live WSL desktop;
the new CI matrix has not yet run remotely. Remote and iTerm2 checks need the
isolated environments specified in [manual acceptance](manual-acceptance.md).
Do not mark this candidate release-ready until those results are recorded.

## Environment setup and repair

**State:** Local candidate, based on `593b1e9` plus working changes,
2026-11-07. Environment checks run before inventory and session creation, including
an empty installation. The editor uses its own Node runtime; standalone checks
include PATH Node and npm. Platform, configured tmux, storage and the selected
launcher are checked without creating a tmux server. Custom scripts remain owned
by the terminal. Berth-owned hook runtime files are repaired automatically.

System dependency installation requires an explicit command review and uses an
existing package manager in the extension host. Completion triggers a fresh
check; an installer exit is not treated as proof of readiness. A runtime owned
by another installation prefix is not silently replaced.

Focused evidence: nine environment tests, seven onboarding tests, two inventory
transport/diagnostic tests, ten capability/hook-health regressions and 28 doctor
regressions passed. Build passed. Isolated native VS Code verified healthy startup
and task completion correlation using a harmless process, not a package install.
Remaining acceptance: native missing-dependency review, cancellation, privileged
installer interaction and remote-host installation. No system packages were
installed during these checks. The local VSIX is installed for manual reload;
this candidate has not been released.

## Editor creation entry

A single Berth button precedes the native plus in terminal Editor toolbars.
Its current-folder and choose-folder actions share the sidebar creation flow.
Editor/tab context menus retain direct actions; terminal content right-click
has none. The native plus dropdown contains no duplicate Berth profiles.

Blank tab-bar and empty Editor group context menus have no stable extension
point. Toolbar placement and theme variants await manual reload acceptance.

## Current correctness gate

First-install adoption remains open across CLI adapters. The common missed-start
hook defect is repaired for seven agents, with Qoder deferred. Next acceptance:
for each CLI, start a conversation before installing Berth; verify either an
exact native PID-to-current-thread mapping or integration activation during the
running conversation, then repeat with two same-directory sessions, a native
conversation switch and a different profile. No directory-recency fallback is
allowed. See [CLI coverage and remaining gaps](code-review.md).

Passive Codex binding covers verified direct rollout writers and existing complete
native session-ID footers cross-checked against the TUI profile and root rollout.
The latter passes a two-client shared-server binding/summary/recovery fixture.
Default shared-daemon TUIs without a current identity signal remain unresolved
for exact binding and recovery. Their visible prompt can now supply a temporary
subtitle independently of identity; it is neither cached nor stored as task text.
Zero-configuration first-install adoption is not closed. Live details no longer
ask users to repair missing internal identity evidence; see the
[binding review](code-review.md#passive-binding-and-live-details--2026-11-02).

Installation/upgrade prompts are now demand-driven and verified legacy bindings
are completed durably; see the [quiet-upgrade receipt](assets/code-review/quiet-upgrade-repairs.json).
Native onboarding/upgrade and OS notification delivery still need acceptance.

Session selection and recovery-binding classification are repaired; see the
[state repair receipt](assets/code-review/session-state-repairs.json). Local packages
are updated; native active-terminal interaction remains unverified.

CR73 local-user recovery passes a real shared-profile two-window fixture.
CR81 prevents unreadable saved output from being discarded during snapshot carry-forward
and recovery configuration edits; see the [review](code-review.md). The CR81
VSIX and npm package pass isolated installation, file comparison and four installed
CLI checks. The affected Linux suite passes 31 tests and installed native UI passes
at both viewport sizes. The
macOS regression has one unresolved CR51 diagnosis failure; a focused rerun
passed without establishing the cause.
CR74–CR75 are resolved by replacing automatic layout writes/restoration with an
independent native Profile. Creation, cancellation, replacement cancellation,
switching and restart return pass on Linux from Default and a named Profile at
both viewport sizes; original/shared settings and legacy journals are preserved.
See the [replacement evidence](assets/code-review/layout-profile-replacement.json).
Remote and macOS native Profile acceptance remain open. Qoder native acceptance
is deferred from this iteration at the user's request.

CR70–CR71 now pass native Linux editor acceptance for layout restoration and
attachment ownership. Layout recovery also passes across two editor processes.
Linux workspace claims and restart now pass across native editor processes.
Remote Profile workflow, iTerm2 and remaining host/agent acceptance stay in T9;
see the [review and evidence](code-review.md#native-editor-state-and-attachment).

The [whole-code review](code-review.md) records CR1–CR73 repairs, including current
terminal presentation after attachment, launch intent scoped to its terminal and
executable PATH checks shared by diagnosis and recovery. Relative recovery commands and diagnostics now resolve against each session
directory. Editor hook installation is asynchronous and serializes requests
within its host. Hook configuration writes publish complete files atomically
and retain the original on write failure. The current repair receipt records deterministic verification. Linux Node 20/tmux 3.4 regression and installed core checks pass. Native editor/iTerm
lifecycle and the other agent versions still require acceptance.
CR34/CR36 state transitions and CR35 live-update focus now pass their native
and browser cases. Native approval rejection now passes, including proof that the denied command
did not execute and the next prompt retained its conversation. Kimi CR37/CR38 now pass native custom-agent recovery and interruption checks;
Kimi approval, rejection and provider-failure cases now pass the local native
fixture. Qoder tool-outcome and failed-turn mappings pass adapter and generated-hook
checks; [native preflight](assets/code-review/qoder-native-preflight.json) exits before
SessionStart because the isolated profile is not logged in. Native delivery and
profile propagation remain unverified and deferred. OpenCode 1.19.5 now passes initial binding and exact-ID recovery confirmation
after the next native update. Native working, approval, rejection, interruption
and provider-failure paths also pass, with successful next turns. An idle TUI
without an identity event still cannot acknowledge recovery.
Gemini 0.66.0 passes custom-home binding, completion and exact-ID/history recovery.
CR59 now reconciles native cancellation records to idle, including late completion
hooks, and verifies a successful next turn. CR60 resumes working after tool
approval; CR61 distinguishes failed provider requests from successful completion.
Their native fixture checks approval, rejection and both error verbosity modes.
Copilot 1.0.105 now has a native binding/completion and exact-ID/history recovery
fixture; CR64 adds provider-failure and cancellation recovery with successful
next turns. CR65 verifies tool approval, denial with non-execution proof, and multiple
pending approvals before model continuation. CR62 preserves documented
recovery options. CR63 enforces child-process inspection deadlines when graceful
termination is ignored. CR66 fixes runtime/platform test entry assumptions; CR67 fixes tmux 3.4 field transport.
CR68 preserves literal paths through tmux hook format expansion.
CR69 preserves user tmux configuration and reports live-hook failures.
CR72 preserves the verified application name from a matching live host registration.
The current extension candidate uses native layout Profiles; core retains live
attachment metadata checks. They pass isolated installation, complete file
comparison and installed CLI checks. The remaining host/platform/agent acceptance belongs to T9.
Do not replace the daily editor or call the product complete from isolated checks.

## Execution order

| Batch | Tasks | User outcome | Exit condition |
|---|---|---|---|
| A — Trust | T1, T2, T3 | Identity and action results cannot silently drift | Adversarial identity/recovery/failed-action tests pass |
| B — Orientation | T4, T5, T6 | Find the right session and understand it without technical decoding | Window ownership, task-first information and keyboard journeys pass |
| C — Readiness | T7, T8 | Setup and supported-agent behavior are explicit | Health/adapter tests and bounded sampling checks pass |
| D — Delivery | T9 | Installation and the full host journey meet the contract | Targeted checks, complete regression, native acceptance and package verification |

The batches describe dependencies, not separate permission gates. Update the
spec before each behavior change; revise an earlier decision when new evidence
shows it fails. Do not add a proposed feature merely to close a checklist item.

## T1 — Bind a conversation to its actual producer

**State:** Implemented: all-pane/independent-branch inspection, atomic pane ownership, adapter/process/ID guards, persisted conflicts and guarded re-adoption. A named stand-in process exercised bind and fork hooks through a real tmux pane. Verified first hooks can adopt before polling; owned creation stages metadata before execution. Unknown process formats cannot replace an existing ID. Real Claude and local-model Codex journeys pass; remaining agent-version coverage stays open. **Priority:** blocks trustworthy restore.
**Owner:** core discovery, hooks and snapshot metadata. **Depends on:** none.

The diagnostic baseline allowed another pane to overwrite a conversation ID
without changing the agent type. That failure is superseded by producer guards;
the original baseline remains in the review evidence. One row represents one
independent producer.

- Define a single independent agent producer for each managed session. Track
  enough live producer identity to reject unrelated or stale hook events.
- Detect conflicting independent agents and expose the conflict; do not pick
  one by active pane, recency or directory similarity and auto-resume it.
- Keep subagents of the same parent from becoming independent session owners.
  Preserve existing IDs while evidence is incomplete.
- Do not expand v1 into restoration of arbitrary multi-pane process layouts.

**Acceptance:** two panes/two agents, two instances of one agent, delayed hooks
from an exited process, fork/resume ID changes, shell promotion and a normal
single-agent session. No accepted fixture may combine one adapter with another
producer's conversation ID. Conflicts stay attachable and explain the recovery
limit without silently destroying metadata.

## T2 — Confirm recovery and make failure actionable

**State:** Implemented: requested/confirmed/failed/unconfirmed recovery, explicit preflight skips, preserved diagnostic panes, exact-ID Retry Recovery, Choose Recovery Folder and intentional end. Failure-injection, real Claude and local-model Codex recovery tests pass; native host/reboot and remaining agent acceptance stay open. **Priority:** blocks trustworthy restore.
**Owner:** core restore/state and host presentation. **Depends on:** T1.

- Separate request issued, confirmed by the expected agent/ID, failed and
  confirmation unavailable. A live tmux session alone is not confirmation.
- Handle missing cwd/binary, rejected ID, process exit and missing hooks as
  distinct causes. Offer the relevant retry, locate-folder, native picker or
  explicit start-new action; do not silently substitute a new conversation.
- Preserve the failed attempt's identity across refresh/restart; guard against
  concurrent retry and accidental duplicate sessions.
- Distinguish closing a terminal, detaching, ending a process and forgetting a
  stopped restore record. Explicitly ended sessions must not resurrect.

**Acceptance:** successful exact-ID acknowledgement; wrong ID; unknown event;
agent exit before acknowledgement; no acknowledgement; missing cwd/binary;
two concurrent retries; reboot with several conversations in one directory;
intentional end followed by restart. Failure feedback must state the next action.

## T3 — Commit action effects only after success

**State:** Implemented: attachment acknowledgement before unread/origin effects, matching side-open behavior, scoped manual-client detach, rename persistence/rollback and host-reference refresh, shared natural ordering and error handling. VS Code 1.144.0 integration passed real main/side/manual attachment and local detach. Main selections and detach are serialized with delayed/failing-host tests and the current native attachment suite. Linux workspace restart and competing startup claims now pass across editor processes. Cross-host journeys remain pending. **Priority:** high.
**Owner:** controller plus core session operations. **Depends on:** T1 identity contract.

- Preserve unread state and restore ownership when opening fails. Commit these
  effects after the attachment succeeds, including Open to the Side.
- Rename as one operation across tmux, snapshot and host references. An invalid
  or conflicting name leaves the prior state intact; external rename is detected.
- Make Detach's scope match its behavior for manual and Berth-created terminals;
  do not disconnect another host under a local-close label.
- Use natural ordering in startup selection as well as rows and attention
  navigation. Handle navigation failures through the same action error path.

**Acceptance:** injected host-open/switch failure preserves unread and owner;
rename then immediate restart retains the new name; host references follow it;
collision is non-destructive; side-open uses the same ownership policy;
manual-terminal detach affects only its declared scope; startup chooses 2 before 13.

## T4 — Identify the host and restore to the right workspace

**State:** Implemented: workspace URI identity, durable restore ownership, live PID/workspace registration and one startup claimant per workspace. Legacy records require explicit opening. Native Linux editor processes now verify competing same-workspace claims, same-basename workspace separation and restart takeover. Remote acceptance remains pending.
**Owner:** core host registry/restore ownership and thin host adapters. **Depends on:** T3.

- Register verified host identity and workspace context locally; derive display
  names from registration, not a session's cwd or historical origin.
- Keep live clients and restore owner separate. Multiple clients remain visible;
  an owner remains meaningful when no client is attached.
- Define behavior for two editor windows, the same workspace opened twice,
  stale registrations and legacy snapshots containing only a host type.
- Restore once into an eligible owner. Where ownership cannot be established,
  keep the session available and explain the choice instead of stealing it.

**Acceptance:** two projects with the same basename; two editor windows;
simultaneous editor/iTerm2 clients; host restart; dead registry entry; legacy
snapshot; remote extension host isolation. A label never claims an unverified workspace.

## T5 — Reduce visual decoding and support value actions

**State:** Implemented: task/title deduplication, shared branch placement, recovery visibility and host-backed value copying. Browser matrix and visual review cover themes, narrow layouts, focus, scrolling and copy failure; installed Linux OS clipboard copy/paste passes at both target viewport sizes;
screen-reader acceptance remains pending.
**Owner:** model, shared details renderer and theme styles. **Depends on:** T2/T4 semantics.

- Preserve the stable session name and product identity. Prefer the actionable
  notification or useful conversation/task description as supporting text.
  Suppress duplicate descriptions and repeated group-wide metadata.
- Keep common branch/folder information at the appropriate group level; show
  connection detail when it distinguishes a session. Maintain a consistent
  visible vocabulary for detached, stopped, waiting and unconfirmed recovery.
- Lead details with user-relevant values and available actions. Technical ID and
  device diagnostics remain accessible, with compact Copy actions for complete
  values, rather than occupying the strongest visual hierarchy.
- Copy works through the host clipboard, acknowledges success/failure, does not
  open the underlying terminal, and remains keyboard-accessible.

**Acceptance:** varied realistic content, long/duplicate/missing titles, multiple
clients and every state at 240/300/420 px; dark/light/high-contrast themes; focus,
selection, pointer transit and copy error recovery; no obscured controls or
horizontal overflow. Existing captures are baseline evidence, not a usability study.

## T6 — Reach a known session with little effort

**State:** Implemented: one native Find a Session picker using the guarded open action. Exact identity and natural ordering tested at 5/20/100 entries; native Linux keyboard selection, cancellation and no-match interaction pass at both target viewport sizes.
**Owner:** host-native session picker and shared ordering. **Depends on:** T1/T5.

Use one native quick-pick command to search the current inventory by session name,
conversation title and folder. Selecting a result uses the existing open action.
Keep the current keyboard/tree and next-attention navigation; add neither a
query language nor a second sidebar navigation system.

**Acceptance:** same-name descriptions in different folders, mixed live/stopped
entries, cancelled picker, no matches, stale/removed selection, keyboard-only
selection, and failure feedback. Test inventories of 5, 20 and 100 sessions;
verify exact destination and keep context when the picker is cancelled.

## T7 — Make setup and health understandable

**State:** Implemented: Diagnose Problems, explicit binding/recovery findings, missing executables and tmux-version diagnostics, PATH-independent hook installation and native layout Profile creation/switching and read-only legacy backup inspection. The new workflow passes isolated Linux native acceptance while preserving source/shared settings. Initial agent-version/capability diagnosis (CR51) passes focused tests; CR54 resolver regressions pass. Upgrade and full setup interaction remain pending.
**Owner:** core doctor/capabilities and host commands. **Depends on:** T2/T8 capability model.

- Use one small host-native health entry to explain missing tmux, agent binary,
  hooks, unsupported versions and recovery readiness; reuse core findings.
- Separate an empty inventory from failed discovery or unavailable dependencies.
- Installing/repairing hooks preserves unrelated configuration and reports the
  exact result. It must survive PATH/runtime changes and extension upgrades.
- Reconcile older hook installations against the current adapter event set without
  overwriting unrelated hooks. Verify activation in already-running agents, including
  native trust requirements. A discovered terminal with no verified profile must
  not be treated as proof that state and prompt events are available.
- Recognized Codex SessionStart/Stop installations now receive missing lifecycle
  events through a non-destructive CLI upgrade, checked once per default or verified
  profile per VS Code activation. Absent, disabled, customized and malformed
  configurations are not silently replaced. The isolated native fixture verifies
  a next turn after upgrading an already-running, unbound session, followed by
  waiting, completion, interruption and recovery. This fixture bypasses trust only
  inside its isolated profile; real-session trust review and event delivery remain
  separate acceptance steps. Live diagnosis confirms shared-daemon hooks can run
  with a stale foreign tmux environment and fail Berth's terminal routing; ancestry
  validation also assumes a direct TUI parent. The independent native-selection
  adapter now bypasses this attribution defect without weakening hook guards:
  complete footer ID, native process profile and exact root rollout must agree.
  Same-directory dual-client binding, prompt/completion and exact recovery pass
  against an explicit shared server with stale terminal environment. This does not
  close default-footer zero-configuration binding.
  The verified 0.166.0 hook payload supplies conversation/turn IDs but no TUI PID,
  client connection identity or session-specific terminal environment. The generated
  protocol and inspected TUI logs do not provide the missing client-to-thread map.
  The missing hook association does not block every status-discovery approach.
  Passive current-viewport Working display is implemented separately from exact
  conversation binding, with a hook-free native fixture and a read-only live
  shared-daemon observation. It never searches scrollback or writes lifecycle
  metadata. Native Codex 0.162.1
  exposes `status` and full `session-id` in its configurable status line. Consume
  this identity only when it is already exposed; never require a Berth-aware launcher
  or silently change agent configuration. The current user requires zero configuration
  changes; the fixture's explicit footer is not an acceptance result for that setup. Truncated, hidden or ambiguous identity
  must not authorize transcript summaries or recovery. Native Waiting can mean a
  background terminal, not a request for user action.
  Once identity is verified, associate conversation-scoped events with live terminal
  bindings rather than the shared daemon's inherited environment. A payload ID alone,
  daemon PID, cwd, prompt match or latest activity is not a terminal association.
  Acceptance must include stale foreign daemon environment, two same-directory
  clients, switching conversations, child views, narrow viewports, overlays, stale
  screen content and process reuse. Keep state, summary and recovery acceptance
  separate. The upstream `--no-daemon` option is a user-selected workaround, not
  Berth's default or a reason to stop a running shared daemon. See the research
  evidence in [code review](code-review.md#codex-legacy-hook-upgrade--2026-11-04).
- Keep layout Profile creation optional and separate from basic setup.
  Return through native Profile selection; preserve original/shared settings.

**Acceptance:** clean install, existing unmanaged sessions, missing CLI/tmux,
declined hooks, malformed config, repeated install, package upgrade, and Profile
creation/cancellation/switching across restart. Setup never claims recoverability from icon
presence or hook-file existence alone.

## T8 — Bound inspection and declare adapter capabilities

**State:** Implemented: bounded process inspection, batched Codex title reads, asynchronous editor inventory/branch sampling and a coalesced refresh. Adapter source/version evidence remains separate from live verification. Native lifecycle fixtures cover the versions recorded in the adapter capability table. Copilot 1.0.105 has binding/completion/recovery, provider-failure and cancellation evidence; CR65 adds tool approval/rejection and multiple pending approvals. CR63 adds forced child-process deadline checks. Remaining versions and remote evidence are pending.
**Owner:** core adapter/readers/sampling. **Depends on:** T1/T2.

- Describe verified binding, naming, state and recovery capabilities per adapter
  and version. Unsupported operations return an explicit capability result.
- Keep title lookup read-only and ID-specific; handle rotated/changed stores,
  late renames and optional tooling without binding to a different conversation.
- Measure process/file inspection at 5/20/100 sessions. Coalesce refresh work;
  avoid rescanning the same process table/store for every row or blocking user
  actions behind slow child processes. Bound failures and timeouts.
- Prefer native APIs where they avoid unstable store coupling without adding a
  service requirement to ordinary listing.

**Acceptance:** one in-flight inventory request with a coalesced follow-up;
bounded child processes; extension-host events can run while sampling is pending.
An isolated real-tmux probe sampled 5/20/100 sessions in 80.4/72.1/394.8 ms
(one sample each, synthetic exact-ID title index). The 100-session result led to
moving editor sampling off the extension-host event loop. A delayed-child test
checks that host events run first; it is not a native command-latency measurement.
Agent acceptance still requires true lifecycle/binding/resume on named installed
versions. Stand-ins, protocol probes and native checks retain separate labels.

## T9 — Verify the whole product and ship the exact candidate

**State:** CR1–CR73 implemented for the tested local-user scope and CR76 preserves prototype-like scrollback keys CR77–CR78 preserve copy focus and first pointer re-entry, CR79 rejects stale attachment effects and CR80 keeps search sampling off the host thread and CR81 preserves snapshots on saved-output read failures; CR74–CR75 are resolved by the native Profile replacement, with Linux creation/cancel/switch/restart checks passing. The current extension/core packages pass isolated installation, file comparison and installed CLI checks. CR81 affected Linux tests and native UI pass; its full macOS run retains one unresolved CR51 failure. Earlier complete macOS/Linux regression, native Linux attachment/layout, layout recovery across processes and workspace startup ownership pass. Local same-profile layout concurrency passes. Linux native copy and Escape focus pass both viewport sizes. [Installed native checks](assets/code-review/installed-native-review.json) also pass copy/paste/save and Find on the candidate VSIX. Escape/Close followed by pointer re-entry also passes. Broader native focus/accessibility, remote Profile workflow, iTerm2 and remaining agent/version acceptance are open. The candidate is installed locally; the editor window is not reloaded by automation and no remote publication is claimed.
**Owner:** integration/packaging and host adapters. **Depends on:** T1–T8.

Run install → discover → inspect → find/open → attend → detach → restore →
rename → end/forget → upgrade/uninstall. Include mouse and keyboard, both target
viewports, theme/zoom, OS clipboard, native menus, editor and iTerm2 restart,
reboot and supported remote environments. Use isolated data and no user-session
termination. Foreground-dependent checks require the user's agreed time window.

Record source/build hashes and actual outcomes. Package/install only the tested
candidate. Do not call an adapter, host or recovery path verified when its live
check was skipped. A remaining critical identity or recovery defect blocks a
stable-complete claim; a documented unsupported optional environment does not
justify unrelated features.

## Public discovery and sponsorship

**State:** channel research complete; outreach sequence proposed, no posts sent.
See [channel evidence and venue requirements](channel-research.md).

1. Prepare one short synthetic-session demo and a clean-install walkthrough for
   the supported VS Code/tmux path. Preserve the limitations in the release notes.
2. Use V2EX Share Your Creations and a current ClaudeCode showcase as the first
   candidate venues. Post separately and collect reproducible feedback before
   broadening distribution. Actual Claude involvement must be described accurately.
3. Consider Show HN after the advertised first-use path is verified. The maintainer
   must write and post personally under its current no-generated-text policy.
4. Treat Product Hunt and social amplification as later options, not required
   launch steps. Measure independent successful use rather than star counts.

The maintainer's [Ko-fi page](https://ko-fi.com/maxzyma) is connected for payments.
Use `ko_fi: maxzyma` in `.github/FUNDING.yml` and a short support link at the end
of the root README. The sponsorship boundary is defined in the [spec](spec.md).
Additional funding platforms remain deferred.

## Deliberately outside this iteration

Cloud sync, remote control service, team collaboration, embedded browser,
chat/composer, model selection, worktree/Git operations, dashboards and a second
settings UI. Reconsider only when an observed user task cannot be completed with
the existing host and the core session contract.

[Review](product-review.md) · [Spec](spec.md) · [Implementation](implementation.md)
