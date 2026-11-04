# Whole-code review: findings and repairs

## Terminal persistence across reload — 2026-11-04

Berth previously opted out of native terminal persistence with `isTransient: true`
and kept ownership only in extension-host memory. Terminals now use native
persistence and carry a durable workspace owner token in their explicit creation
environment. Reconnection re-adopts only matching terminals with verified live
session ancestry. Startup samples restored terminals before considering a fallback
and defers while PID identification is pending. Existing side views remain owned.

The public terminal persistence setting remains authoritative. Terminals created
by 0.4.3 retain their original transient options: after loading this fix, reopening
a session creates a persistent terminal for subsequent reloads. Native reload
acceptance remains manual; no live user window is reloaded by automation.
Build and ten targeted ownership, startup and navigation checks passed.

## Unified Editor creation entry — 2026-11-03

The Editor toolbar exposes one Berth creation dropdown before the native plus
(`navigation@-1`). It invokes the same current-folder and choose-folder commands
as the sidebar. Duplicate native terminal-profile contributions, providers,
activation events and adoption callbacks were removed. Editor/tab context menus
keep direct commands; terminal content right-click has no creation entry.
Blank tab-bar and empty-group context injection remains unavailable through
stable APIs. The native plus stays an ordinary-terminal surface.

The Berth brand uses the selected folded lowercase-b design, vectorized as a
project asset. The new-session toolbar action uses a separate bubble-plus glyph.
This replaces both the earlier wave/terminal mark and the interim layout icon.
Sidebar and extension icon share the brand geometry; the toolbar action has
explicit light/dark SVGs. Real 16px previews were rendered on both backgrounds;
native placement remains subject to manual reload acceptance.

The diagnostic menu and picker say “Diagnose Problems”; existing command IDs
are retained for shortcuts. Prior native-profile validation applies to the
removed implementation, not a retained public entry point.

## Stable terminal navigation — 2026-11-03

Baseline: `47fec56` plus local changes, rechecked at 23:07 +08:00.
Spec §6 defines the navigation contract. The previous preserve-and-duplicate
Panel policy is superseded by local connection handoff.

Selection reuses an owned Editor terminal or attaches a new one. After confirming
its PID and exact session, it detaches captured unowned clients from this VS Code
window. Each source PID/TTY and the destination are revalidated before detach;
changed sources are skipped. Shells, agent sessions, owned side views and external
clients are preserved. Failed attachment leaves original clients connected.
No terminal is identified by display name or moved using ambiguous active-Panel
commands. This removes incidental +1 connections without hiding real multi-client
counts. Selecting external sessions opens an Editor attachment directly, without
a confirmation dialog. Pending PID identification defers attachment.

Build and 13 targeted checks passed: seven core identity/failure checks and six
navigation/handoff checks, including a real isolated tmux transfer preserving
the external client and live session. Native VS Code focus/tab lifecycle remains
pending manual acceptance.

## Connection identity and compact rows — 2026-11-03

Baseline: `47fec56b5643f5848d4e8097547986a2aa249839` plus local changes,
rechecked at 14:02 +08:00. The specification owns the connection and row contracts.

- Live client identities and displayed counts previously came from separate
  tmux reads. A zero older count plus an unmatched new client could render as
  detached. Counts now come from the client sample; positive client evidence
  wins over a conflicting count. Strict inventory queries reject read failures.
- One pending terminal PID could block every subsequent refresh. PID reads now
  have a bounded wait, preserve an explicit readiness result, and cannot mutate
  an already-published sample when a late promise resolves. Terminal lifecycle
  events request refresh, and PID identity is sampled again after inventory.
- A live registered host was rejected because macOS `kern.boottime` differed
  in microseconds between processes. Boot UUIDs now identify the boot session.
  Compatibility checks for older host/lock records require exact PID and process
  birth; their old boot-clock estimate can drift in both seconds and microseconds. Read-only native checks accepted the same live host and
  classified its attached session as this-window after this change.
- Connection markers stay on the title line. Window and terminal glyphs are
  shared with hover details; working uses a spinning glyph instead of a menu-like
  ellipsis. Empty subtitles reserve no line. Connection and activity metadata are icon-only
  at every width; hover supplies text. Host identity occupies the far-right slot,
  with a fixed activity slot immediately to its left. A muted backing outline
  denotes multiple connections; hover lists each connection. Hover, connection
  changes and idle transitions leave both
  icon slots stationary. The identity browser suite passed 22 checks; four
  host-artwork checks passed with the stacked indicator. Dark/light rendered
  rows were inspected across both required viewport sizes.

Regression coverage lives in `connections.test.ts`, `followup-regressions.test.ts`,
`identity.test.ts`, `inventory.test.ts` and the browser identity/icon suites.
The exact sequence behind the earlier screenshot was not recorded; the live
host rejection and synthetic inconsistent-sample path are independently verified.
The initial connection repair full run passed 284 tests with seven opt-in native
cases skipped. Subsequent legacy producer migration and native waiting handling
passed all 30 affected tests; icon-only rows passed 60 browser checks. A verified
native waiting record had been ignored by the idle-only reconciler; native
waiting now stops the working animation without answering the agent prompt.
Browser checks: 78 passed across the existing two viewport projects; eight icon
cases were rerun after narrowing an ambiguous test selector. The local extension
and both existing CLI installations were checked against their package payloads.
Native editor reload and interactive acceptance remain manual.



## CLI first-install coverage — 2026-11-02

Baseline: `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus working-tree changes.
The common hook handler previously discarded identity on turn events when no
start event had been recorded. It now fills an empty binding after verifying
producer ancestry and pane ownership, captures the profile and snapshots before
returning. Conflicting profiles and existing IDs are preserved. Turn events do
not confirm a pending recovery. Qoder is deferred by request.

| CLI | Missed-start event accepted | Passive adoption without integration |
| --- | --- | --- |
| Claude Code | UserPromptSubmit / Stop | Not implemented; PID registry alone needs current-thread validation |
| Codex CLI | UserPromptSubmit / Stop | Direct rollout writer only; shared-daemon TUI unresolved |
| Gemini CLI | BeforeAgent / AfterAgent | Not implemented |
| OpenCode | session.status / session.idle | Not implemented; plugin still requires a verified root-session event |
| GitHub Copilot CLI | userPromptSubmitted / agentStop | Not implemented |
| Cursor CLI | beforeSubmitPrompt / stop | Not implemented |
| Kimi CLI | UserPromptSubmit / Stop | Not implemented |

The synthetic producer/tmux tests cover every row's missed-start binding for
both unmanaged and adopted sessions, unrelated callers, child-agent payloads,
conflicting profiles, ID preservation and pending recovery. They do not prove
that a running native CLI reloads newly installed hooks. The full first-install
request remains open until native evidence or a verified integration activation
path covers each row. See the [receipt](assets/code-review/late-binding-review.json).

Event schemas were checked against the official
[Claude Code hooks reference](https://code.claude.com/docs/en/hooks),
[Gemini hooks reference](https://geminicli.com/docs/hooks/reference/),
[Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
and [Cursor hooks reference](https://cursor.com/docs/hooks).
Kimi's local upstream hook event constructors and Berth's OpenCode plugin
provide the other payload contracts. Codex retains the registered event schema
from the existing adapter review. These sources establish event semantics,
not passive PID-to-conversation discovery.


## Passive binding and live details — 2026-11-02

Baseline: `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus working-tree changes.
Codex can now bind without a hook when its verified interactive process holds
exactly one writable CLI rollout and the header, inode, process lifetime and
single-producer checks agree. Conflicting IDs and profiles remain unchanged.
Live details omit internal recovery explanations and the readiness button;
context-menu diagnosis and stopped-session recovery remain available.

**Current native limitation:** Codex CLI 0.166.0 in shared-daemon mode did not
expose a verified TUI-to-thread mapping in the inspected process descriptors,
logs or protocol interfaces. The current conversation remains unbound. Synthetic
writer fixtures do not establish acceptance for this native configuration.

Read-only recheck on 2026-11-03 (Berth `47fec56` plus local changes): the
running daemon reports 0.166.0. Its freshly generated experimental schema exposes
thread identity/status but no verified local TUI PID-to-active-thread relation.
Local log storage includes process identity, but the sampled live TUI records
have no structured thread identity; daemon thread records do not identify which
terminal displays them. Thread attachments inspected here describe worktrees and
pull requests, not terminal connections. This evidence does not establish that
all possible native integration paths are unavailable. A passive solution still
needs authoritative client-to-current-thread evidence; directory recency and
loaded-thread membership are insufficient. The official
[App Server protocol](https://learn.chatgpt.com/docs/app-server) documents thread
listing and reading, which alone do not supply that missing relation.

Validation: 96 affected core/controller tests and 14 browser checks passed.
The browser checks covered both required viewport sizes; rendered live details
were inspected. See the [candidate receipt](assets/code-review/native-binding-review.json).


The working tree implements CR1–CR73 for the tested local-user configuration
scope and CR76–CR81 for scrollback, details interactions, attachment events and asynchronous search. CR74–CR75 are resolved by retiring in-place layout writes in favor of an independent native Profile. The [CR81 receipt](assets/code-review/scrollback-read-repairs.json) records the
saved-output candidate and affected checks. The [layout Profile receipt](assets/code-review/layout-profile-replacement.json) records the current candidate. The earlier
[search receipt](assets/code-review/native-search-repairs.json) retains search verification; the [attachment-event receipt](assets/code-review/attachment-event-repairs.json) retains unchanged core regression; [re-entry checks](assets/code-review/details-reentry-repairs.json) retain unchanged webview evidence; the [scrollback receipt](assets/code-review/scrollback-key-repairs.json) retains the unchanged core regression. The [shared-profile receipt](assets/code-review/shared-profile-layout-review.json)
retains local two-window recovery evidence; the
[target-boundary receipt](assets/code-review/configuration-target-review.json)
records the failing all-profile and distinct-profile cases. The
[installed native receipt](assets/code-review/installed-native-review.json) verifies
copy, paste/save, Escape focus, pointer re-entry and Find on the installed candidate
at both viewport sizes. Broader focus/accessibility, iTerm2, remote and remaining
agent/version paths still need acceptance. The daily
editor is unchanged. Earlier [host-name](assets/code-review/host-name-repairs.json)
and [workspace lifecycle](assets/code-review/host-lifecycle-review.json) receipts
retain native ownership evidence. The earlier deadline timeout in the
[tmux installation receipt](assets/code-review/tmux-installation-repairs.json)
still has no established cause.

## Quiet installation and upgrade

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` with working-tree changes,
reviewed 2026-11-02, startup opened the session view, offered layout creation and
reported old layout backups; inventory separately offered hook installation per
profile. These unsolicited entry points are removed. Legacy-layout disclosure
now occurs only on an explicit layout-creation request, before proceeding.

Existing bindings can be completed by a producer-verified event carrying the
recorded conversation ID. Missing profile data is captured without replacing a
known profile; repaired records are snapshotted before the hook returns. Ordinary
unrelated events do not trigger migration snapshots. Refresh alone neither clears
warnings nor modifies agent hook configuration.

Notification routing suppresses the current visible terminal and foreground
completion popups. Waiting sessions elsewhere remain actionable. Background events
choose one notification channel, with an editor fallback only when the OS helper
cannot launch. OS delivery is not inferred from process launch.

The [quiet-upgrade receipt](assets/code-review/quiet-upgrade-repairs.json) records
94 passing affected tests and installed-package comparison. Native new-install,
upgrade interaction and actual OS delivery remain unverified; the daily editor
was not reloaded or controlled.

## Session selection and recovery binding

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` with working-tree changes,
reviewed 2026-11-02, window membership set both selection styling and
`aria-selected` on every locally attached row. Selection now follows explicit
row activation; a separate marker follows the active terminal's verified client
ancestry. Non-terminal editor tabs suppress that marker.

Discovery also classified missing process-lifetime records as producer changes.
Missing evidence now retains the conversation under a verification warning;
confirmed mismatches remain conflicts. A producer-verified hook with the same ID
can clear these warnings; a different-ID lifecycle event cannot. No warning is
cleared merely because discovery found a process. Live rows omit internal recovery diagnostics, with no list warning icon.
Stopped details and the context menu offer Check Recovery Readiness, which reports
fresh binding, hook, profile, launch-option and setup findings. Repair actions
reuse existing controls without automatically resuming a stopped session.
Stopped rows expose the verification requirement before resuming.

The [repair receipt](assets/code-review/session-state-repairs.json) retains the
74-test core/controller baseline and records 50 current readiness/controller tests,
54 browser identity/hover checks across two viewport sizes, and installed-file
comparison. Rendered details were inspected for readable recovery status and the
check button. The daily editor was not reloaded or controlled; native terminal
selection and readiness Quick Pick interaction remain unverified.

## Saved output read failures

### CR81 — P1: unreadable saved output is discarded during carry-forward (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` with working-tree
changes, reviewed 2026-11-01, snapshot carry-forward and the folder/profile/options
edit paths caught every scrollback read failure and published missing or empty
output. Later retention could remove the source snapshot.

`SnapshotStore.optionalScrollback` now treats only `ENOENT` as missing output.
Other read errors propagate before publication and pruning. Recovery edits share
the same reader. Four deterministic directory-read fixtures failed before the
repair; each now checks failure preservation and successful continuation after
removing the unreadable entry. The [receipt](assets/code-review/scrollback-read-repairs.json)
records verification. The full macOS regression has one CR51 version-diagnosis
failure (expected warning, received info); a focused rerun passed, but the cause
is unresolved. The assertion now includes the observed finding. The CR81 VSIX and npm package pass isolated installation, complete file comparison
and four installed CLI checks. The affected Linux suite passes 31 tests; installed native UI passes at both viewport sizes.

## Qoder native acceptance preflight

Qoder CLI 1.0.48 exits before SessionStart in the isolated, unauthenticated
`--config-dir` probe. The [preflight receipt](assets/code-review/qoder-native-preflight.json)
records the login error and absence of hook delivery. This establishes an
acceptance prerequisite, not a hook failure. Native binding, profile propagation
and exact-ID recovery remain unverified. Current [Qoder documentation](https://docs.qoder.com/cli/custom-models)
routes custom models through an account-dependent wizard; it does not establish
an offline fixture for the installed release.

## Native session search

### CR80 — P2: Find a Session runs synchronous inventory before opening its picker (repaired)

The command called the core's synchronous `list` on the extension-host thread
before opening Quick Pick. Slow process inspection therefore blocked other host
callbacks and delayed the picker, although sidebar refresh already used a child
process. This finding comes from the command path and synchronous core calls;
no native latency measurement is claimed.

Find now supplies Quick Pick with a promise from the shared asynchronous session
sampler. Branch decoration remains a sidebar concern and does not delay search.
The sampler retains output validation and its forced child-process deadline.
A delayed fixture proves the host can process another event before inventory
finishes. Real VS Code checks at both target sizes cover an empty search result,
Escape cancellation without attaching, and keyboard selection that attaches the
chosen session. The [receipt](assets/code-review/native-search-repairs.json)
records these results separately from native rendering and broad accessibility.

## Delayed attachment events

### CR79 — P1: a stale hook can mark a pane with the wrong recovery target (repaired)

`attached` trusted the event's session, tty and terminal type after the client
had left. A delayed iTerm2 event could overwrite the pane's session marker and
change the old session's origin, even though the client now showed a different
session. The failing regression writes a marker to a fixture output with no
matching live client and incorrectly changes the session origin.

Attachment processing now holds the shared state lock, checks the tty against
the named session's current clients, and uses tmux's current terminal type.
Detached or switched clients return before discovery, pane marking, state replay,
origin changes or hook hints. Tests cover stale events, terminal-type disagreement
and a real control client switching between two isolated tmux sessions. They do
not assert atomicity against a client switching after the final observation.

The [receipt](assets/code-review/attachment-event-repairs.json) records regression
and installed-CLI checks. iTerm2 API availability was confirmed read-only, but
native iTerm2 scripting/restart acceptance remains open; existing API credentials
were absent and no authentication prompt or foreground action was initiated.

## Native clipboard focus

### CR77 — P2: pending clipboard requests discard keyboard focus (repaired)

Copy disabled its focused button while awaiting the host clipboard result.
The real editor's asynchronous acknowledgement left focus on the document body;
Escape then closed details without returning to the row. An immediate microtask
response in the browser fixture hid the pending-state failure.

Copy now uses `aria-disabled` with a duplicate-activation guard. The button stays
focusable during the request and keeps focus after success or failure. A deferred
acknowledgement regression covers both outcomes and duplicate activation. The
native editor verifies mouse copy, keyboard copy, actual clipboard contents and
Escape focus return in separate 1440×900 and 1280×800 instances. The
[receipt](assets/code-review/native-copy-focus-repairs.json) distinguishes these
checks from visual or full accessibility acceptance.

### CR78 — P2: the first pointer re-entry after closing details is suppressed (repaired)

Closing from inside details returned keyboard focus to its row and marked that
row as dismissed. The pointer was already outside the row, so moving away did
not produce another row-leave event to clear the marker. The first later entry
was ignored. Changing viewport size exposed the problem but was not required:
four browser cases reproduced it without resizing, using Escape and Close in
both viewports.

An explicit mouse entry with pointer movement now clears the dismissed marker.
Focus changes, movement within the same row and a stationary pointer exposed by
hiding the card remain suppressed. The [receipt](assets/code-review/details-reentry-repairs.json)
records 52 copy/hover regression passes and real-editor copy, focus and re-entry
journeys in both viewports. The earlier failed sequential probe is superseded by
these root-cause-specific tests; its original evidence remains in the CR77 receipt.

## Scrollback keys

### CR76 — P2: a valid session name silently loses its saved scrollback (repaired)

The collector assigned scrollback to a plain object using each session name as a
property. Assigning a string at `__proto__` invokes the inherited setter instead
of creating an own property. The snapshot therefore included the session record
but omitted its scrollback file. The same assignment also dropped retained
scrollback after a server restart.

The collector now constructs the index from explicit key/value entries with
`Object.fromEntries`. Captured and retained sessions use the same construction;
prototype-like names remain ordinary own properties. A failing baseline and
regressions cover `__proto__`, `constructor` and `toString`, including retention
after the isolated tmux server exits. Installed core and extension-bundled CLI
tests also verify `snapshot` and `show` against a real pane.

## Shared-profile configuration coherence

### CR73 — P1: stale window settings can erase recovery data (local-user repair verified)

Two native editor windows shared one profile but had separate configuration
caches. After A applied the layout, B still read `${process}` from the extension
API while the profile file contained `${sequence}`. Revert classified the old
value as a user edit, skipped restoration and emptied the journal. A subsequent
Apply could also capture an obsolete backup. The original failing observations
and candidate hashes remain in the [receipt](assets/code-review/shared-profile-layout-review.json).

The repair refreshes the editor's local-user configuration inside the shared
layout lock before capturing backups or deciding which values to preserve.
Removing Berth's absent reserved key through the configuration API awaits the
editor's edit-and-reload path; it never writes a marker value. Refresh failure
stops the operation and retains recovery data. The
[implementation](implementation.md) links the upstream configuration and editing
paths behind this mechanism. Native evidence is for VS Code 1.144.0; upstream
source links describe the mechanism rather than a guarantee for every version.

The native two-window fixture passes sequential and overlapping Apply/Revert,
preserves a later user edit, verifies the complete settings object and leaves an
empty Revert byte-identical. Independent profile-file reads check stored results.
Both extension hosts share storage and have distinct process IDs. A separate
two-process restart test passes. Extension tests pass on macOS and Linux, including
refresh rejection and recovery retry. These are command/API tests, not rendered
UI, clipboard or focus acceptance.

The refresh key targets local-user configuration. VS Code can route other keys
to remote-user or application/all-profile configuration, each with a separate
reload path. Those targets need a dedicated fixture and recovery design review
before extending this verdict. In particular, a successful local refresh alone
does not establish freshness for a key stored in either other target.

## Configuration target boundaries

### CR74 — P1: all-profile settings captured stale backups (retired workflow)

A named editor profile can keep ordinary layout settings locally while applying
its terminal title to all profiles. In the native fixture, a first Apply/Revert
restored `${process}` on disk, but the applying window still observed
`${sequence}`. A subsequent Apply captured `${sequence}` as the original title.
The overlapping Revert returned success and left that incorrect title in the
shared settings file. The local-user refresh added for CR73 does not reload the
separate application configuration model.

The [target-boundary receipt](assets/code-review/configuration-target-review.json)
records this failure against the CR73 candidate. The fixture verifies an actual
named-profile settings write before testing recovery. The first probe incorrectly
assumed that a named profile would change `globalStorageUri`; that failed fixture
assertion is excluded from the product-failure result. In this build, both hosts
use the default global-storage directory even when ordinary settings are written
to the named profile. Therefore, the journal directory cannot itself identify
profile-local setting ownership. The independent-profile failure is recorded separately as CR75.

The approved replacement removes automatic settings writes and restoration. Native
Profile import owns creation and native switching owns return. Existing all-profile
settings remain unchanged and can override the template. The old failure remains
recorded against its original candidate; it is not evidence about the new workflow.

### CR75 — P1: different profiles consumed one shared recovery journal (retired workflow)

Two windows open different named profiles and set their titles to
`first-original` and `second-original`. Independent reads confirm two separate
profile settings files. A applies the layout, then B applies it. Both use the same
file-backed journal, so B retains A's original title. A reverts and empties the
journal; B's Revert then has nothing to restore. The final profile titles are
`first-original` and `${sequence}` instead of both originals.

This is a target-ownership error in the file-backed recovery design, independent
of the stale-cache problem. `context.globalStorageUri` gives both profiles the
same journal location in the tested editor. The
[target-boundary receipt](assets/code-review/configuration-target-review.json)
records the separate native failure against the retired implementation. Legacy journals
are now read-only and available through Inspect Earlier Layout Backup; they are
never automatically applied to a possibly different Profile.

The [replacement receipt](assets/code-review/layout-profile-replacement.json) records
Linux VS Code 1.144.0 checks from Default and a named source Profile at 1440×900
and 1280×800. Import cancellation, creation, same-name replacement cancellation,
switching and restart return pass. Original, shared settings and legacy journal
bytes remain unchanged. The native import uses Extensions → Default to reuse the
installed VSIX; Marketplace installation, macOS native and remote acceptance remain
unverified. Qoder acceptance is deferred at the user's request.

## Registered host names

### CR72 — P2: a matched live host could still appear as an unknown terminal (repaired)

The connection collector matched a client to a live host registration and copied
its workspace label, but discarded its application name. A control-client probe
with a valid registered host returned an empty application instead of the
registered editor name. The row could therefore show “Other terminal” despite
having a verified host identity.

The collector now prefers the matched registration's nonblank application name,
then falls back to process ancestry and terminal type. Unrelated registrations
supply neither application nor workspace; blank or non-string names cannot
suppress the existing fallback. A real Linux editor fixture checks that the
bundled CLI returns the editor's registered application name.

The [host-name repair receipt](assets/code-review/host-name-repairs.json) records
macOS/Linux complete regression, the native editor suite, four workspace lifecycle
phases and candidate installation checks. It also records the failing baseline
and verifies that the current packaged files match the isolated installations.

## Native workspace lifecycle acceptance

The current candidate passes four Linux editor phases using isolated profiles
and shared workspace/session state: a live leader owns the startup claim; a
second window for the same workspace does not attach its detached session; a
workspace with the same folder basename at a different path receives a separate
claim without opening the leader's session; a new editor after both claimants
exit reopens the original workspace session. The
[initial receipt](assets/code-review/host-lifecycle-review.json) records the first
fixture baseline. The [host-name receipt](assets/code-review/host-name-repairs.json)
reruns these phases for the current candidate, with an application-name assertion.

A client-name probe also passes on macOS and Linux using the name stored by tmux,
including its literal control-character escape. Tmux normalizes the input name;
the probe does not treat the pre-normalized input as the session's identity.
No runtime repair was needed for these checks. This evidence does not cover two
windows sharing one editor profile's layout settings, native clipboard/focus,
iTerm2 or a remote extension host.

## Native editor state and attachment

Review baseline: HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working
tree, 2026-11-01 12:12 UTC. The isolated host used VS Code 1.144.0 on Linux
arm64, Node 22.23.4 and tmux 3.4. These checks cover functional integration;
they do not constitute visual, accessibility, macOS or multi-window acceptance.

### CR70 — P1: editor setting updates could erase layout recovery state (repaired)

Apply stored its backup and applied values through separate editor memento
updates; Revert read those values back. Native probes on VS Code 1.144.0 observed
missing backup and applied-value keys after awaited setting writes. Revert then
left `${sequence}` instead of the original `${process}`. An independent probe
retained 12 keys with memento writes alone, but retained 10 when editor setting
updates were interleaved. A local accumulator and command queue did not remove
this storage interaction.

The layout host now owns an atomic, schema-checked journal in extension global
storage. It records the original settings and each intended write before changing
editor settings. Revert compares current values to those intentions, preserves
later user edits and retains retry state after an error. Legacy backups migrate
once; an empty journal after successful Revert prevents their reimport. Confirmation
precedes the transaction, which reads settings again rather than saving a stale
pre-dialog snapshot.

The shared ticket lock now supports awaited operations and serializes windows
using the same journal. The existing synchronous session path retains nested-lock
behavior. Tests cover a rejected write that already changed its setting, interrupted
Revert, corrupt data, legacy migration and reconstruction. A separate-process lock
fixture verifies exclusion, timeout, owner death and error cleanup.

The native editor suite passes all seven cases. A two-process fixture applies
in one editor, exits it, then restores the original settings in a new editor.
Complete macOS regression passes 247 tests with 7 conditional skips; Linux passes
246 with 8 skips. The candidate extension and core install in isolation, match
all packaged files and pass installed CLI checks. These results do not establish
native multi-window, visual, accessibility or iTerm2 acceptance.

### CR71 — P1: stale inventory suppressed attachment ownership (repaired)

`Controller.attached` checked `this.row(name)?.managed`, while `row` preferred
cached inventory over current session metadata. Inventory could capture a newly
created unmanaged session before its launcher or hook stamped agent metadata;
opening it then skipped origin and workspace ownership writes.
A deterministic controller probe caches an unmanaged tmux session, adds its
agent metadata, then calls `show`: `@berth_origin` remains empty. The native
editor suite independently reached the same empty-origin assertion after an
acknowledged terminal attachment.

Workspace startup restores explicitly owned sessions, so lost ownership could
prevent reopening after restart. The shared attachment action now consults
current live core session truth. Four regressions cover main and side attachment
after agent metadata is added or removed. All 47 controller tests pass on macOS
and Linux; the native Linux editor attachment case passes, including preservation
of an independent tmux client during local detach. The complete native suite and packaged candidate now include this repair.

## Tmux installation integrity

### CR69 — P1: installation could remove user settings and hide live-update failures (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, the installed CR68 CLI removed a user setting located between quoted
marker strings in other tmux commands. It searched for marker substrings rather
than standalone lines. The same installed candidate returned success when a
fixture tmux rejected every live hook update. Direct file overwrites also allowed
an interrupted write to replace the configuration with incomplete contents.

Managed-block parsing now requires one ordered pair of standalone marker lines.
Unpaired, reversed and repeated markers fail before writes. Unrelated text and
whitespace are preserved. Reinstallation replaces the block in place so later
user settings retain their execution order. Tmux and agent hooks share the atomic configuration
writer in `config/write.ts`, preserving symlinks and permission modes. Failed
staged writes retain the previous file and remove their temporary artifact.

Live hook updates propagate errors. The message distinguishes completed file
changes from a failed running-server update and directs the user to retry.
Tests verify install/uninstall retries and idempotence as well as preservation,
malformed markers, injected disk failure and rejected live hook commands.

## Hook path identity

### CR68 — P2: format-looking paths broke closure evidence and installed hooks (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, an isolated native probe closed the last session normally but failed
to create its closure marker when the state directory contained `#{session_name}`.
Shell quoting did not prevent tmux from expanding the path as a format. Without
that evidence, normal closure could be mistaken for server loss. Installed hooks
embedded the CLI and Node paths through the same unescaped format boundary.

Literal path fragments now escape hash characters before tmux evaluates the
command; shell quoting separately protects argument boundaries. Explicit socket,
session and lifetime placeholders remain active. Tests cover format expressions,
short aliases, doubled hashes, command-looking text, spaces and quotes. They
verify exact closure evidence and absence from recovery inventory, then execute
all six installed hooks both immediately and after reloading the configuration.
The expected socket and session arguments must reach the fixture CLI unchanged.

## Linux compatibility

### CR67 — P1: tmux 3.4 inventory output could not be parsed (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, Ubuntu 24.04 with tmux 3.4 emitted the unit-separator framing byte
as literal `\037`. Every normal session listing failed field-count validation.
The upstream [command output implementation](https://github.com/tmux/tmux/blob/3.4/server-client.c)
applies visual escaping before printing command replies.

The codec now frames fields with printable `~`, escapes it inside values, and
uses `=HH` escapes. Session and pane scalar reads use the same codec. Its syntax
avoids percent date directives interpreted by `display-message`. Decoding once
preserves literal escape-looking text. Nested substitutions retain tmux 3.0
compatibility. Tests cover discovery, metadata, snapshots, pane directories and
client identity, including separators, whitespace and literal percent/equal text.

### CR66 — P2: the test entry did not support the declared runtime/platform (repaired)

On the same baseline, Node 20 exited before executing the recursive glob passed
to `node --test`. Three controller fixtures passed BSD-only arguments to Linux
`script`; another depended on the launcher shell implicitly replacing itself.
These failures prevented Linux acceptance from checking the product.

The test launcher enumerates compiled test paths explicitly. PTY fixtures select
platform-specific arguments and the cwd fixture explicitly replaces its launcher.
Protocol stubs use the current framing. Development requires Node 22 because the
locked VS Code integration tools require it; the packaged core CLI keeps its
Node 20 runtime contract, exercised by Linux regression.

## Copilot tool decisions

### CR65 — P2: resolved approvals still appeared waiting (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, native Copilot 1.0.105 executed an approved command and sent its
result to the model while Berth still showed waiting. Denying a tool with feedback
also continued model work without clearing the wait. The adapter had no signal
for work resuming after a decision.

Native inspection now pairs approval requests and completions by request/tool IDs.
A subsequent assistant turn can resume working only after all observed requests
have completed. One tool result cannot clear another outstanding approval.
The existing producer, profile, cursor and state-revision checks apply to the
working transition as well as terminal outcomes.

The native fixture verifies the approved file's contents, absence of the denied
file, a remaining approval after the first decision, and both outputs after the
second decision. It identifies the command inside the active card: concurrent
tools can present their approval cards in either order, so transcript order is
not a reliable decision target. Capability diagnostics now record native evidence
for Copilot 1.0.105; other versions still require their own verification.

## Copilot terminal outcomes

### CR64 — P2: failed and cancelled Copilot turns stayed working (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, Copilot 1.0.105 returned to its composer after a loopback provider's
HTTP 401 and after Ctrl+C, while Berth still showed working. Neither path emitted
`agentStop`. Each provider retry emitted `errorOccurred` with `recoverable: true`,
including the final failed attempt, so the hook payload alone could not identify
the terminal outcome. The [official hook reference](https://docs.github.com/en/copilot/reference/hooks-reference)
describes the error payload but does not make it a turn-completion signal.

The prompt hook now captures a cursor in the bound profile's exact session event
file. Native inspection requires a current root turn-end followed by a session
error or user-initiated abort. Retry hooks and successful turn-end records alone
cannot clear activity. Later prompts, wrong IDs/profiles, partial records and
mismatched turns fail closed. The shared reader retains inode/prefix checks,
bounded reads and the existing producer lifetime/state revision checks.

The native fixture covers failure, cancellation and successful next turns under
the same conversation ID. CR65 covers tool approval/rejection. Gemini's
native fixture checks the shared reader through its existing approval, rejection,
cancellation, provider-failure and recovery paths.

## Recovery options and inspection deadlines

Baseline: HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree,
checked 2026-11-01. The review followed discovery and producer/profile binding,
recovery argument reconstruction, hook/state handling, inspection transport,
refresh serialization and details/clipboard ownership. No new rendered-page
or native-host acceptance is claimed for this pass.

### CR62 — P2: documented Copilot options blocked recovery (repaired)

A native Copilot 1.0.105 session launched with `--no-auto-update`,
`--disable-client-telemetry` and `--disable-builtin-mcps` bound and completed a
turn, but recovery stopped at `skipped-unverified-arguments`. The adapter did
not describe those options. It now preserves these settings and the supported
model, reasoning and tool restrictions. It consumes startup prompts, names and
selectors without replaying them. Unknown syntax still requires explicit review.

Native recovery preserves the conversation ID, selected profile and earlier
prompt history. Copilot emits its resume identity hook on the first submitted
prompt, so displaying restored history alone does not confirm recovery.
The adapter's source label also no longer attributes Gemini's version acceptance
to Copilot. Full Copilot lifecycle acceptance remains pending.

### CR63 — P2: inspection deadlines depended on graceful child exit (repaired)

Inventory and Git inspection used the default SIGTERM timeout signal. A child
that ignored SIGTERM kept the single-flight refresh pending. A deterministic
Git stand-in with a two-second deadline returned only after its own four-second
exit timer (4.426 seconds measured). Such a process with no exit could prevent
future inventory updates.

Inspection calls now use SIGKILL at their existing deadlines. The same review
covered tmux clients, process metadata, title queries and controller fallbacks;
parent-process inspection now has a deadline too. Interactive attachment keeps
its normal lifetime. Regression fixtures exercise a SIGTERM-ignoring inventory
worker and Git executable, assert bounded return and preserve session rows when
branch inspection fails. These checks do not establish a total deadline for a
refresh containing arbitrarily many sessions or prove native-host responsiveness.

## Gemini tool and failure outcomes

### CR60 — P2: approved tools left the session waiting (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, native Gemini 0.66.0 completed an approved shell tool and sent its
result to the model while Berth still displayed waiting. The adapter consumed
permission notifications but had no event for work resuming after approval.

The adapter now installs `BeforeModel`. A verified hook changes an existing
wait to working and clears the permission note. It leaves idle, done and already
working states alone, so an unrelated model hook cannot reopen a completed turn.
Individual tool completion events remain ignored because other approvals may
still be pending. Native tests verify the approved command's output, the held
post-tool model request, rejection without command execution, and the same ID.

### CR61 — P1: failed provider requests appeared completed (repaired)

The same baseline emitted `AfterAgent` after an injected HTTP 401. Berth mapped
that event to done even though Gemini displayed a failed request. `AfterAgent`
acknowledges loop termination; it does not establish success.

The native transcript reader now recognizes a terminal error or Gemini's failure
summary after the current request cursor, and can clear done after the loop-end
hook. It keeps active work unchanged when only an error record exists. A later
successful response invalidates the earlier error. Both full and reduced error
verbosity use the same identity, file, prefix and revision checks as cancellation.

## Gemini profile identity and cancellation

### CR58 — P1: Gemini recovery lost its custom home (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, profile capture and root resolution ignored `GEMINI_CLI_HOME`.
Hook installation could write the default profile while the agent read another,
and recovery could search the wrong conversation store.

Root resolution now reads the selected home's `.gemini` child. Profile capture,
explicit folder selection and recovery preserve that home selector and remove
an unrelated inherited selector when restoring a default profile. The profile
regression failed before the change. Native Gemini 0.66.0 against a loopback
model endpoint now binds, completes a turn and restores the same conversation
and history even when the restoring host selects a different home.

### CR59 — P1: cancelled Gemini requests retained working or done state (repaired)

Baseline: HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree,
checked 2026-11-01. Native Gemini 0.66.0 acknowledged cancellation while Berth
retained working. The abort branch can skip `AfterAgent`; another observed path
emitted completion after cancellation and left done. The old completion hook
mapping could not distinguish these outcomes.

Gemini's recorder writes a typed `info` cancellation event to its JSONL transcript.
On a verified `BeforeAgent`, Berth captures the file identity and byte offset in
the bound profile. Inventory reads only new records and accepts cancellation
only after checking conversation identity, file identity and the captured prefix.
It recognizes the native rewind record that follows cancellation. User/model text
with the same words, partial records, a later user message and unknown schemas
cannot clear activity. A bounded tail read handles large responses.

The existing native-observation owner revalidates the producer, pane, lifetime,
session incarnation and activity revision before clearing working, waiting or
Gemini's late done. New requests replace the cursor; snapshots never restore it.
Tests cover stale and foreign events, replacement files, later turns, malformed
records and observation races. Native Gemini now cancels to idle and completes a
subsequent turn with the same conversation. Tool approval, rejection and provider-error coverage is recorded in CR60–CR61.

## Hook configuration integrity

### CR57 — P1: interrupted hook writes could destroy user configuration (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, JSON, TOML and plugin hook writers called `writeFileSync` on the
original file. A deterministic partial-write failure left only the synthetic
partial bytes in an existing settings file, removing its unrelated configuration.

The shared writer now stages the complete content in the target directory and
renames it into place. Write or rename failure preserves the previous file and
cleans the temporary file. Replacement follows an existing symlink to its target,
keeps the symlink itself and existing POSIX permission bits, and rejects dangling
symlinks. New files use mode 0600. Readers that opened the old file keep seeing
its complete old content until they reopen it.

Three fault/identity tests cover partial writes, failed rename, symlinks, modes,
open readers, install/uninstall preservation and temporary-file cleanup. Existing
format tests exercise the common writer for JSON, TOML and plugin output. This
provides per-file replacement; it does not serialize external editors or make a
multi-file installation transactional.

## Hook installation responsiveness

### CR56 — P2: hook installation blocked extension-host events (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, `installBundledHooks` used `spawnSync` with a 30-second timeout.
A synthetic installer that delayed its result by 300 ms blocked the host for
339 ms; a previously queued host timer could not run during the installation.

The editor now awaits an asynchronous installer process, with forced termination
and a 1 MiB output cap. A host-local queue serializes runtime refresh and installer
execution so later requests cannot replace the runtime while an earlier request
is starting. Errors preserve the child diagnostic and release the queue.
Six focused tests cover responsiveness, ordered execution, recovery after failure,
PATH-independent installation, preserved unrelated hooks and installed-hook delivery
to isolated tmux. This queue does not claim coordination with other processes.

## Attachment, launch ownership and executable resolution

Baseline: HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree,
checked 2026-11-01. The [pre-repair receipt](assets/code-review/current-review.json)
and [probe script](assets/code-review/current-review-probes.mjs) record the three
original reproductions. That script asserts the old defects and is historical
evidence, not the current acceptance runner. Current regressions are in
`packages/vscode/test/controller.test.ts` and `packages/core/test/tools.test.ts`.

### CR52 — P2: opening a session restored obsolete terminal activity (repaired)

`Controller.showNow` cleared a bell-generated wait, then presented the cached
inventory state. The probe confirmed idle core metadata followed by a final
OSC waiting sequence. A completion between refresh and selection had the same
stale-state risk.

Main and side attachment now invoke core `presentCurrentState`, which reads and
presents activity under the shared state lock. Bell inspection and clearing also
share that lock, preventing a newer hook from being cleared between the read
and write. Regressions cover bell acknowledgement and completion during attachment
for both opening modes, and check the emitted OSC output and current metadata.

### CR53 — P2: failed custom launches left an active adoption intent (repaired)

`Controller.newSession` assigned a pending intent before its queued action and
retained it after terminal failure. A later fresh session could inherit the old
agent choice. The pre-repair probe adopted an unrelated sleep session as Codex.

Launch execution now clears the prior intent inside the serialized main action.
Only a successful terminal opening with a known process ID creates an intent.
The observation carries the terminal PID that produced its session name; settlement
checks that PID against both the intent and current host terminal. Explicit main
selection or detach cancels pending adoption. Regressions cover launch failure,
a mismatched terminal observation, queued failure, chosen-agent adoption and a
launcher that discovers its own agent. Native editor timing remains a host gate.

### CR54 — P2: PATH resolution selected unusable entries (repaired)

`resolveBinary` previously stopped at the first existing path. The probe confirmed
that a non-executable file masked a usable later binary even though the shell
could run it. Native state observation, version diagnosis, notifier selection and
integration tools all used this resolver.

Shared `executableOnPath` now requires an executable file, skips directories and
unusable PATH entries, follows usable symlinks and preserves explicit path lookup.
Doctor, version probing and recovery preflight use the same check. Tests cover
non-executable files, directories, symlinks, broken links, relative and absolute
paths, missing commands and notification fallback. The notification fixture now
has executable permissions, matching the capability it represents.

## Recovery command directory

### CR55 — P2: relative resume commands used the host directory (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, recovery preflight resolved `./resume-fixture` from the Berth process
directory while tmux ran it in the saved session directory. The
[pre-repair probe](assets/code-review/relative-resume-probe.mjs) confirmed direct
execution succeeded but `ensure` returned `skipped-missing-binary`. That script
asserts the old defect; current acceptance lives in core tests.

Executable lookup now accepts a launch directory. Recovery preflight and doctor
supply the session directory for relative commands and relative or empty PATH
entries. Version diagnosis resolves each session's configured executable,
deduplicates by resolved path and performs at most eight native queries.
Further executables report an unqueried state. Custom templates remain unexecuted.

The integration regression restores two same-named scripts in distinct directories,
checks their exact conversation IDs and reports a missing third script. It also
verifies an explicitly empty PATH reaches the agent. Internal staging now invokes
the known runtime path instead of relying on `sleep` in that PATH. Unit checks
cover relative/empty PATH entries, version query limits and distinct per-directory
CLI versions. Native editor and platform gates remain separate.

## Agent outcomes and version readiness

### CR50 — P1: Cursor cancellation and failure appeared successful (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, `metaForEvent` mapped every Cursor `stop` to done. The
[official stop schema](https://cursor.com/docs/hooks#stop), checked on that date,
distinguishes completed, aborted and error outcomes. Only explicit completed
now produces done; other or missing outcomes clear activity and its note without
success. Binding remains unchanged and a subsequent turn can complete normally.

Eighteen focused adapter/hook checks pass, including a synthetic hook journey
through real isolated tmux. This verifies mapping and integration, not Cursor's
native event delivery. The installed CLI is 2025.09.12-4852336; no native session
was invoked for this repair.

### CR51 — P2: Diagnose Problems lacked agent-version capability diagnosis (repaired; native setup pending)

The original finding at the baseline above described a tmux-only version check.
The current implementation queries standard launchers with bounded `--version`
probes, keeps custom launchers unknown and runs editor diagnosis in a child.
Eleven focused tests pass, including forced timeout, caching, configured PATH,
custom templates and editor event-loop availability. Native profile trust,
hook delivery and exact-ID recovery remain separate observations.

CR54 repairs the shared executable resolver used by this diagnosis. Package and
native setup acceptance remain pending.

## Optional notifications and manual acceptance

### CR48 — P1: a missing native notifier raises an unhandled child error (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, native notification subprocesses had no error listener. A subprocess
probe using the same pattern exited with an unhandled ENOENT when the helper did
not exist. On Linux this includes hosts without optional `notify-send`; launch
failure can escape into the extension host instead of leaving notification
presentation optional.

`notifications.ts` now contains launch errors and returns a launch acknowledgement
without claiming OS delivery. Missing and non-executable helper checks pass.
macOS helper discovery uses existing PATH resolution instead of blocking the host
with `which`. In-editor notification and Open behavior remain independent. Native
notification delivery and activation still require host acceptance.

### CR49 — P1: manual instructions did not isolate acceptance from daily use (repaired)

On the same baseline, the manual guide installed the CLI globally, isolated only
editor directories, omitted socket selection in local commands and used a
process-name-wide iTerm2 kill. Both language editions now use a temporary prefix,
clean HOME/XDG environment, named test endpoint and explicit CLI/tmux wrappers.
iTerm2 lifecycle checks require a disposable account and a verified single PID;
remote checks use a disposable environment and matching explicit socket selection.

Application activation and exact-session opening are recorded separately; bringing
an unrelated editor window forward is not evidence of opening the intended
session. Both editions' setup blocks passed bash/zsh syntax and child-environment
checks. These checks did not run installation commands, launch foreground windows
or exercise native notifications.

## Test endpoint and profile isolation

### CR47 — P1: inherited socket paths bypassed test isolation (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, core fixtures retained an inherited `BERTH_TMUX_SOCKET_PATH`. That
explicit path overrides the test's named socket, but server-wide teardown checked
only the name. A mocked transport confirmed that a test-prefixed name allowed a
kill command targeting a non-test path; no real server was used in that probe.
The native editor harness also inherited parent HOME, agent profile selectors and
Berth routing/configuration variables through test-electron's environment merge.

Teardown now validates the addressed endpoint: an explicit path must pass the
test-prefix check itself. Core fixtures clear inherited routing, configuration,
state, binary and profile selectors. The editor fixture explicitly removes parent
variables before preserving basic execution/display settings and assigning its own
HOME, XDG, state and socket roots. This accommodates test-electron's merge rather
than relying on omitted keys to unset inherited values.

Three focused checks cover endpoint precedence, core environment isolation and an
actual child process after the editor-runner merge. The complete suite passed with
sentinel parent Berth overrides injected: 198 passed, five native opt-in tests
skipped. Native editor UI acceptance remains separate; no window was opened.

## Long-conversation display names

### CR46 — P2: an intervening rename is replaced by an older title (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, a synthetic Claude transcript with an initial title, a later rename
and more than 512 KiB of subsequent records returned the initial title. The
latest rename lay beyond the first 64 KiB and before the last 512 KiB. The reader
concatenates those two windows and incorrectly treats their latest match as the
whole transcript's latest title. Claude and Qoder share this reader.

Claude and Qoder now search complete records backward until the latest title is
found. Codex single and batched index lookups share the reader, fixing the same
omission when a requested name falls outside the former index tail. Reads use
64 KiB chunks and retain only the current record across boundaries. UTF-8 and
records larger than a chunk are preserved; incomplete trailing records are ignored.

A derived cache under Berth state avoids re-reading unchanged histories across
inventory workers. Device/inode, size and nanosecond modification/change times
identify the source version. Growth, rewriting, truncation and replacement all
invalidate cached names. Rechecking the open file and pathname rejects a result
changed during the scan. Cache failures do not hide readable source titles. Only
IDs and names enter this cache; identity binding and recovery stay separate.

Sixteen focused checks cover these cases, including an injected rewrite during a
read and cache reuse from a fresh process. A 103,400,051-byte synthetic history
required about 76 ms for its first application scan and peaked at 55,376 KiB RSS;
the next scan read zero transcript bytes. This is a local fixture measurement,
with OS filesystem caching uncontrolled, not a disk-independent latency guarantee.

## Native observation concurrency and timeout

### CR45 — P2: overlapping observers discard current results and queries exceed timeout (repaired)

On the same baseline, a deterministic overlap changed only `nativeCheckedAt`
between observation and application. The identity comparison rejected the sample,
so overlapping editor windows could repeatedly prevent stale activity clearing.
Scheduling metadata is now excluded; activity revision, identity and ownership
checks remain intact. The regression reproduces two observers of the same turn.

A native-query fixture ignoring SIGTERM remained blocked beyond the 1.5-second
timeout. The query now requests SIGKILL on expiry, leaving activity unknown and
unchanged. Both regressions failed before the repair and pass afterward. Six
focused checks and the complete 188-pass regression run cover this candidate.
These changes are included in the CR46 isolated candidate package.

## Claude cancellation and denial

### CR44 — P1: cancelled or denied Claude turns retain activity (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, native Claude Code 2.1.310 returned a cancelled prompt to the composer
while Berth remained working. Manually denying a Bash approval returned the CLI
to its composer while Berth remained waiting. Diagnostic hooks observed only
`SessionStart` and `UserPromptSubmit` for cancellation, plus `PermissionRequest`
for denial; neither path emitted a terminal hook.

The early-cancellation transcript retained the user/API request and a last-prompt
record without an explicit interruption marker in the sampled record sequence.
A partial-response cancellation did write a structured `interruptedMessageId`,
but the early-cancellation path lacked it. A missing response or elapsed time
cannot establish cancellation.

Inventory now queries `claude agents --json` in the recorded profile, outside the
state lock. Only an unambiguous interactive idle record with matching conversation,
producer PID, lifetime and pane clears working/waiting. It preserves done and
never binds identity. Each activity write advances an opaque revision; a new turn
invalidates an earlier sample even if the state returns to working. Metadata,
server/session incarnation and process ownership are rechecked under the lock.
One least-recently attempted profile is queried per pass with a 1.5-second timeout;
failed or unsupported queries leave state unchanged without starving other profiles.

Native Claude Code 2.1.310 regression covers cancellation, denial with proof that
the command did not run, and subsequent successful turns on the same conversation.
An independent query from inside `UserPromptSubmit` observed busy before the hook
finished. Deterministic regressions cover an intervening done/working cycle,
changed conversation/producer, duplicate records, malformed output, stale process
start, profile scheduling and preservation of successful completion. These native
observations apply to the tested version; other versions still need acceptance.

## Claude failed turns and completed tool batches

### CR43 — P1: Claude API failures and completed approvals left stale state (repaired)

On the same baseline, an injected non-retryable HTTP 400 produced native
`StopFailure` while Berth stayed working. An approved Bash command wrote its
proof file and the CLI requested the next model response while Berth stayed
waiting. The adapter listened only for prompt submission, notification and stop.

Claude now reports waiting from `PermissionRequest` without waiting for a delayed
notification. Typed notifications use `notification_type`; text matching remains
only for payloads without that field. `PostToolBatch` resumes work after the
whole batch resolves, so one parallel tool completion cannot clear another
approval. `StopFailure` clears activity and its note while preserving identity.
These mappings follow the [official hook reference](https://code.claude.com/docs/en/hooks),
checked 2026-11-01, and native 2.1.310 event traces.

Native regression covers initial binding, recovery, API failure, successful next
turns and approval with proof-file contents. Adapter checks cover localized
permission messages, misleading non-permission text and individual tool events
that must leave a pending batch alone. Cancellation and denial are covered separately by CR44.

## OpenCode activity, cancellation and permission outcomes

### CR42 — P1: OpenCode failures appeared complete and activity was missing (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, native OpenCode 1.19.5 emitted busy status while Berth showed no
activity. An injected authentication failure emitted `session.error` followed
by `session.idle`; Berth ignored the error and reported done. User interruption
followed the same error/idle sequence. Rejecting a permission request instead
emitted `permission.replied` with `reply: reject`, then idle without an error.

The plugin now forwards busy/retry status, permission requests and approvals.
Errors and rejected permissions clear activity. Later idle events retain that
outcome until the next busy/retry event, so an aborted turn does not appear
complete. Unknown status/reply values leave state unchanged. Only observed root
sessions may forward activity; child and unknown identities remain excluded.

Native publishers do not await plugin callbacks. The plugin now serializes
hook subprocesses, handles pipe/spawn errors and kills a stalled hook after ten
seconds. A delayed-identity regression checks event order. Other generated-plugin
checks cover child isolation, unknown values, repeated idle after failure and a
missing runtime without rejection of the native callback.

The native fixture verifies recovery, a held model response, cancellation,
authentication failure, approved command output, rejected-command file absence,
and subsequent successful turns on the same conversation. It exercises the
installed CLI against a loopback model; external inference and native host UI
acceptance remain separate.

## OpenCode recovery acknowledgement

### CR41 — P1: restored OpenCode conversations never acknowledged recovery (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, OpenCode 1.19.5 restored the expected history and completed another
turn on the same conversation, but Berth retained `requested`. The plugin
forwarded identity only on `session.created`; reopening a stored session does
not emit creation again.

The adapter now also accepts `session.updated`, which carries native session
metadata. Updates from child sessions remain excluded, including children whose
creation this plugin instance never observed. Native recovery and a generated
plugin regression verify the expected ID and child isolation. The
[versioned session source](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/session/session.ts)
separates creation from retrieval. Native event capture confirms the update path.

An idle restored TUI may emit no session identity event. Berth keeps recovery
unconfirmed until a native update arrives, rather than inferring acknowledgement
from process existence. The fixture verifies confirmation after the next turn;
it does not claim immediate acknowledgement at TUI startup.

The initial startup timeout came from the isolated configuration bootstrap.
OpenCode waits for plugin dependency installation before loading local plugins.
Preinstalling the version-matched plugin dependency allowed the native fixture
to reach its composer and complete inference. Model requests used loopback;
bootstrap and built-in plugins may still make external requests.

## Qoder tool outcomes and failed turns

### CR40 — P1: Qoder retained approval requests after execution or turn failure (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, the Qoder adapter ignored `PostToolUse`, `PostToolUseFailure` and
`StopFailure`. Replaying a permission request followed by successful execution
or turn failure left both waiting state and the old approval message intact.

The adapter now returns to working after tool execution, including ordinary
tool failure. An interrupted tool failure or failed turn clears activity and
its note while preserving the conversation ID. This follows the documented
[Qoder event semantics](https://docs.qoder.com/cli/hooks), checked 2026-11-01.
Tests execute the installed hook commands against isolated tmux sessions;
they do not establish delivery by native Qoder 1.0.48. Native Qoder BYOK setup
requires a separate account/provider acceptance path.

## Kimi decision and failure transitions

### CR39 — P1: Kimi approval decisions and provider failures left stale activity (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, native Kimi 0.31.1 continued its model loop after tool approval while
Berth stayed waiting. An injected provider authentication failure also returned
the native CLI to its composer while Berth stayed working. The adapter had no
mapping for `PermissionResult` or `StopFailure`.

The adapter now returns to working on the observed decision event and clears
activity on turn failure. Clearing activity also clears previous notification
text, including when the ending event carries a message. It never emits done
for a failed or interrupted turn.

Native regression covers approval with verified file contents, rejection with
verified file absence, continued model work after both decisions, provider failure
and a successful subsequent turn on the same conversation. See Kimi's
[hook event reference](https://moonshotai.github.io/kimi-code/en/customization/hooks.html),
checked 2026-11-01. This closes the Kimi permission cases in the current local
fixture; external inference and native host acceptance remain separate.

## Kimi interruption

### CR38 — P1: cancelling a Kimi turn left working indicators active (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, Kimi 0.31.1 cancelled a pending model response after Escape while
Berth retained working state. Kimi emits `Interrupt` instead of `Stop` for this
case; the adapter had omitted it. The adapter now installs the interruption
hook and clears state and note without reporting completion.

The native loopback fixture verifies a custom-agent turn, exact-ID recovery
after tmux server loss, retained custom-agent instructions, interruption and a
subsequent successful turn. CR39 adds decision and provider-failure cases.
Sources: installed Kimi 0.31.1 and its [official hook events](https://moonshotai.github.io/kimi-code/en/customization/hooks.html),
checked 2026-11-01. The fixture dismisses the vendor's update prompt in its
isolated session; it never installs an update or changes the everyday profile.

## Kimi creation-only selectors

### CR37 — P1: restoring a custom-agent Kimi session failed at argument validation (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, the adapter retained `--agent` when building `kimi --session <id>`.
Installed Kimi 0.31.1 rejects that combination: it binds the agent at creation
and restores the binding from the saved session. This prevented recovery before
the agent even opened its conversation.

Recovery now discards `--agent` and repeated `--agent-file` selectors with their
values, while retaining model and permission restrictions. Regression cases
cover both spellings, repeated files and a selector value that resembles a
permission flag. The native loopback fixture now creates a custom-agent conversation and
restores the same ID after server loss. Its next model request contains the
original custom-agent instructions, proving that omitting the creation selector
preserves the agent binding.

## Lifecycle and details interaction repairs

The [diagnosis](assets/code-review/lifecycle-focus-review.json) records failures
at HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01. The latest receipt identifies the repaired source hashes.

### CR34 — P1: interrupting Codex left the session working (repaired)

The adapter omitted `Interrupt`. Escape stopped native Codex while Berth kept
working indicators. The adapter now registers this event; the dispatcher clears
state and note without reporting successful completion or changing conversation
identity. The native fixture verifies interruption and a subsequent completed
turn on the same conversation. See the [official hook contract](https://learn.chatgpt.com/docs/hooks).

### CR35 — P2: live details updates discarded keyboard focus (repaired)

Rebuilding details removed the focused copy button. The renderer now restores
focus to the same action and preserves scroll position during updates. Repeated
connection actions match by value; unique actions retain focus when their value
changes. If the action disappears, focus moves to the details content. Opening
a different card starts at the top. Browser tests cover both viewports, copying
after a state change, the missing-action fallback and multiple connection values.

### CR36 — P1: approved work continued to appear blocked on the user (repaired)

The adapter could enter waiting at `PermissionRequest` but had no post-tool
transition. A native command completed and the model continued while Berth still
requested attention. `PostToolUse` now restores working state from observed tool
completion. Permission notes use the payload message, tool description or tool
name fallback. Native Codex verification covers approval, tool completion and
continued model work; the follow-up fixture also covers denial, confirms the command output file is
absent and completes another turn on the same conversation.

## Codex state and recovery

### CR33 — P1: a later Codex turn retained the previous completion state (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, the Codex adapter registered only `SessionStart` and `Stop`. A second
prompt could not replace the previous done state, and approval requests had no
hook mapping. The adapter now maps the documented `UserPromptSubmit` and
`PermissionRequest` events to working and waiting. It retains `--no-alt-screen`
on exact-ID recovery; installed CLI 0.166.0 documents that option for resume.

Codex can trust events independently, so a complete hook file cannot suppress
bell fallback. A bell also preserves an existing explicit waiting state and its
explanation. Legacy two-event installations now fail completeness checks and
offer repair; newly added definitions still require native trust review.

[The native local test](../packages/core/test/live/codex-local.test.ts) runs the
installed CLI against a loopback model service in an isolated profile and tmux
server. It checks working/done across two turns, kills the server, calls `ensure`,
then checks a third turn and the exact conversation acknowledgement. Codex's
background title request receives its own fixture response and cannot count as
a user turn. Input waits for the rendered composer instead of depending on a
fixed delay. The test uses a trust bypass only for its own inspected hook commands;
production templates do not add it. No external model is called.

Unit checks cover the permission-event mapping, retained bell fallback and
preserved waiting details. CR34/CR36 extend the native fixture with approval
and interruption coverage; the follow-up fixture also covers rejection. Sources:
[official hook events](https://learn.chatgpt.com/docs/hooks), installed
`codex resume --help` and the recorded native test, checked 2026-11-01.

## Codex hook activation

### CR32 — P1: installation success omitted required native trust review (repaired)

At HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree on
2026-11-01, the extension claimed new Codex sessions could report state and IDs
after writing hook configuration. A local Codex 0.166.0 `hooks/list` probe in a
temporary profile reported both Berth events as enabled but `untrusted`, while
Berth's file-health result was `installed`. No model request was made. This
matches [Codex's documented trust requirement](https://learn.chatgpt.com/docs/hooks):
new or changed non-managed hook definitions require native review before running.

The core now supplies activation guidance to CLI installation output, extension
installation feedback and installed-session details. File health describes the
configuration; it does not claim that Codex has trusted it. Users review new or
changed Berth definitions in `/hooks`. Berth does not edit native trust records
or add a bypass option. Tests cover installation output, unchanged command policy,
inventory guidance and its presentation as information. Browser verification
covers [1440×900](assets/code-review/codex-trust-1440x900.png) and
[1280×800](assets/code-review/codex-trust-1280x800.png).

## Adapter argument semantics and hook health

The diagnostic baseline is HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a`
plus the working tree captured on 2026-11-01 in
[probe evidence](assets/code-review/adapter-followup.json). Those probes describe
the pre-repair behavior. The repair evidence above identifies the current sources.
CLI argument definitions were checked against installed Claude Code 2.1.310,
Codex 0.166.0, Kimi 0.31.1 and Qoder 1.0.48 help output.

### CR27 — P1: preserve the role of discarded option values (repaired)

The previous parser promoted the value in
`claude --append-system-prompt '--dangerously-skip-permissions'` to an active
permission switch. [The parser](../packages/core/src/agents/commands.ts) now
consumes each known option's arity before applying the replay policy. Unknown
syntax and missing values require Review Recovery Options even for verified OS
argv. Tests cover permission-looking values, equals syntax, optional resume
selectors and the standalone terminator; an end-to-end core check verifies that
unsupported syntax prevents launch until the user reviews the options.

### CR28 — P1: retain configuration and permission restrictions (repaired)

The [adapters](../packages/core/src/agents/registry.ts) now retain Claude's
`--strict-mcp-config` alongside the selected MCP configurations. The local CLI
review also covered tool restrictions, settings-source selection, restricted/safe
modes, Codex feature and sandbox/approval settings, Kimi permission modes and
Qoder tool/MCP restrictions. Unknown options require review. Tests compare the
resulting option vectors, including the exact-ID command and restriction flags.

### CR29 — P2: preserve variadic option values (repaired)

Claude's `--add-dir` and `--mcp-config` now retain their complete value lists.
Adapter arity distinguishes flags, required values, optional discarded selectors
and variadic values. Tests cover multiple values, repeated options, empty values,
following options and the terminator. Automatic recovery and the explicit
recovery-options editor share this parser and its missing-value validation.

### CR30 — P2: detect partial or broken hooks (repaired)

[Hook health](../packages/core/src/agents/hook-health.ts) validates required events,
matching Berth command targets and accessible runtime/script files. It parses
JSON and TOML; OpenCode uses a check against the generated plugin structure.
Foreign hook commands remain outside Berth's syntax checks. Missing, broken and
complete configurations have separate statuses. Inventory and setup diagnostics
offer repair for broken hooks; the bell fallback no longer treats them as a
working waiting-state integration. Installation checks its result and reports
configuration that remains disabled or incomplete instead of claiming success.

Regressions cover the supported file formats, missing runtime/script files,
partial events, disabled and malformed configuration, preserved third-party
hooks, repair, and bell fallback. The native bell test now triggers after setup;
its previous fixed delay could ring before profile binding and contaminate the
hooked-session assertion. Browser checks cover the repair warning and recovery
option review at both declared viewports. File health does not certify runtime
agent-version capability. Rendered evidence covers the hook warning at
[1280×800](assets/code-review/adapter-hooks-1280x800.png) and
[1440×900](assets/code-review/adapter-hooks-1440x900.png), and option review at
[1280×800](assets/code-review/adapter-options-1280x800.png) and
[1440×900](assets/code-review/adapter-options-1440x900.png).

### CR31 — P2: use one Kimi profile directory (repaired)

The previous profile display used `.kimi` while hook installation chose
`.kimi-code`. [The shared resolver](../packages/core/src/agents/roots.ts) now owns
both locations: an explicit `KIMI_CODE_HOME` wins; otherwise the current directory
wins, with legacy fallback only when that current directory is absent. Tests
cover neither directory, legacy only, both directories and an explicit override.

## Command-line follow-up

Baseline: HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the
CR15–CR22 working tree on 2026-11-01. These findings concern discovery and
argument replay, independent of exact conversation-ID validation.
[Command-line evidence](assets/code-review/command-followup.json) records the
probes, targeted checks and current source hashes.

### CR23 — P1: preserve external launch argument boundaries (repaired)

Discovery now reads an OS argument vector instead of reparsing `ps` display text.
Linux uses procfs; 64-bit macOS uses an inline system-Perl syscall bridge. The
[Darwin reader](../packages/core/src/process-arguments.ts) follows
[XNU executable-path alignment](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_exec.c)
and the [argc contract](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c).
It bounds reads and execution time and returns only argv, including empty values.
An empty argv0 is rejected; the reader does not skip empty argument entries into
the environment. No native compilation or npm binary dependency was introduced.

Known Berth launch options remain authoritative. Live legacy producers can refresh
unverified options from the OS. Stopped legacy records with replayable options
require Review Recovery Options (or `berth recovery-options`), including an
explicit choice of defaults. Invalid or unsupported options do not publish a
change. Argument control characters survive tmux metadata through JSON encoding.

Regressions cover spaces, quotes, empty values, newline/separator values, exited
processes, live legacy upgrade, explicit stopped-record review and empty argv0.
The final full suite passes 156 tests with one opt-in test skipped; a separate
Claude Code 2.1.310 journey passes start, response, server loss and exact-ID resume.
This machine exercised macOS; Linux's native reader still requires platform
acceptance. [Repair evidence](assets/code-review/command-repairs.json) records
candidate hashes and the narrower native/browser verification scope. The 70-case
browser matrix passes; rendered legacy-option details were inspected at
[1280×800](assets/code-review/recovery-options-1280x800.png) and
[1440×900](assets/code-review/recovery-options-1440x900.png).

### CR24 — P1: positional prompt text becomes a permission flag (repaired)

`keptArgs` previously scanned beyond the standalone `--` terminator. The prompt
`--dangerously-skip-permissions` could therefore become a real permission option
on resume. Parsing now stops at the terminator. Regression covers both Claude
permission flags and Codex sandbox arguments after it.

### CR25 — P2: an editor opening an agent-named file is misidentified (repaired)

Discovery treated the second word of every process as a possible interpreter
script. `vim /tmp/claude` was identified as Claude. Script-position matching now
requires a supported interpreter, with negative editor/viewer cases and a positive
shell-script case. These checks also pass in the final full regression.

### CR26 — P2: preserve native session, pane and client fields (repaired)

The original isolated probe returned two session rows for one directory containing
a newline. Session, pane and client lists now share
[one field codec](../packages/core/src/tmux/fields.ts): tmux encodes the escape prefix,
line breaks and separators before framing; consumers decode each field once.
Literal escape-looking text and leading/trailing whitespace remain intact.
Malformed records fail instead of inventing a session. CR67 extends the codec
to scalar name/path reads; metadata writes preserve their values.

On macOS, [process directory reads](../packages/core/src/process-directory.ts)
use `PROC_PIDVNODEPATHINFO`. `lsof` can render a control character and a literal
caret sequence identically, so its display output is not a directory identity.
The structure layout follows Apple's
[proc_info definitions](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h).
Discovery and explicit adoption consume the same producer directory. Linux uses
its process cwd link; CR67 records native Linux execution of the regression suite.

The declared tmux 3.0 minimum was checked against an isolated build of that release.
Its modifier implementation keeps only the final chained substitution, so the
codec uses nested substitutions instead. That version also lacks `session_path`;
the native-path fallback uses the active pane while managed producers retain their
own cwd. The compatibility tests cover those branches rather than relying on the
newer locally installed tmux.

Regressions include control characters and literal escapes, snapshot persistence,
a launcher and agent in different directories, explicit adoption, and a real
control client attached to a whitespace-containing name. Browser evidence from the
previous candidate is reused only for unchanged view/model sources. Packages are
validated in isolated directories; the daily editor is not replaced.

## Current findings: second follow-up

The diagnostic baseline is HEAD `dfb47bf8c321121b263cfc71016ffc0cc21b6a8a`
plus the working tree recorded on 2026-11-01 in
[second-follow-up evidence](assets/code-review/second-followup.json).
Those original defects no longer describe the repair candidate.
[Repair evidence](assets/code-review/second-followup-repairs.json) identifies the
current sources and verification scope. Specifications were revised before code.

### CR15 — P1: serialize state transactions

Snapshot collection, discovery, identity changes, Forget and recovery now share
one reentrant synchronous transaction lock. Snapshot publication preserves commit
order even when callers supply older timestamps. A regression interleaves a
newer snapshot at Forget's publication boundary and verifies the removed record
cannot become the newest recovery state.

### CR16 — P1: names are not binding authority

Removed the historical name-to-ID fallback. A verified start hook, verified native
evidence under the passive-binding contract, or explicit exact-ID binding establishes a conversation. A fresh session with the same name
as an old transcript remains unbound and cannot silently resume that transcript.

### CR17 — P1: invalidate identity when changing agent

Adoption validates the current producer on every call. Changing agent or producer
clears the old conversation, profile and recovery metadata, even before discovery
sets a conflict flag. Public stamping follows the same agent-transition rules.

### CR18 — P1: carry profile identity through launch and recovery

A whitelist of non-secret directory selectors is saved with the conversation.
Launch and resume install those values in the tmux session environment and remove
stale inherited selectors. Titles and hook status use the recorded profile.
Recovery requires an explicit profile choice for legacy records; a mismatched
profile hook cannot acknowledge the expected conversation. Tests cover two stores
with the same ID, stale tmux environment, explicit selection and mismatched hooks.
No credentials or arbitrary process environments are persisted.

### CR19 — P2: preserve the iTerm endpoint

Generated commands carry the canonical socket path with `-S` precedence, including
custom endpoints and the Berth configuration/state route. A real isolated tmux
endpoint test checks that the generated command reaches the intended server.

### CR20 — P2: require a ready iTerm shell prompt

AutoLaunch requires the marked pane, a shell job and a uniquely identified empty
editing prompt. It checks again in an iTerm transaction after recovery, before
sending text. Missing shell integration, busy programs and changed ownership defer
reattachment. Nine generated-Python cases cover those transitions; no native iTerm
interaction is claimed by that test.

### CR21 — P1: reject a replacement producer in the same pane

A real-process probe replaced a Claude producer without changing its pane. The
previous implementation retained the old conversation without a conflict.
Discovery now compares producer lifetime as well as pane identity; re-adoption
clears the old binding, and a verified start hook can establish the new one.
The regression replaces the process in an isolated tmux pane and checks both steps.

### CR22 — P1: Retry must honor name collisions

A probe placed a failed live Codex session under a name reserved by a saved Claude
conversation. Retry previously killed the live target and restored the old ID.
Retry now applies the same immutable-session collision gate before snapshotting
or killing anything. Its regression preserves the live server/session identity,
replacement conversation and original saved record.

### Verification and remaining scope

The complete core/editor model suite passes 150 tests with one opt-in test skipped.
The separate Claude Code 2.1.310 test passes a real start-hook, short response,
server loss and exact-conversation recovery journey. It uses an isolated tmux
server and injected settings; authentication and transcript storage use the local
Claude profile. This is one agent/version, not the full supported-agent matrix.

The 68-case browser matrix covers both 1440×900 and 1280×800. Rendered details were
inspected at both sizes, including profile paths, wrapping and copy controls.
Native clipboard, menus, multiple editor windows, iTerm restart and reboot remain
outside this evidence. Native VS Code execution requires an agreed foreground
window. Existing native results apply only to their earlier source baseline.

A repeated optional-title timeout was isolated to startup of freshly generated
executable test fixtures before their script body ran. The fixture now completes
a readiness execution before measuring batched queries. Production query timeouts
remain unchanged; the full suite passed with that fixture correction.

## Follow-up repairs

The CR9–CR14 diagnostic baseline was recorded on 2026-11-01 at HEAD
`dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` plus the working tree.
[Diagnostic evidence](assets/code-review/followup.json) preserves the original
hashes and probes. Those findings no longer describe this candidate.
[Follow-up repair evidence](assets/code-review/followup-repairs.json) records its
source hashes and checks. The [spec](spec.md#identity-boundaries-for-recovery-and-terminal-actions)
was updated before implementation.

### CR9 — P1: verify owner lifetime

Recovery now compares the selected tmux endpoint's actual server lifetime with
the saved one. [Process ownership](../packages/core/src/process-owner.ts) gives
restore tickets and host claims a boot/process-birth fingerprint; legacy records
compare process birth with record creation time. Verification failures do not
silently grant ownership. Reused-PID probes cover recovery, tickets and claims;
existing host and lock tests cover live owners and contention.

Process birth currently uses `ps lstart`, with second resolution. Same-second
PID reuse is not distinguished by the process fingerprint; this limitation does
not affect the deterministic stale-lifetime cases covered here.

### CR10 — P1: preserve stopped identity across name reuse

[Creation](../packages/core/src/registry/sessions.ts) reserves names held by
stopped records. [Snapshots](../packages/core/src/snapshot/take.ts) compare server
and session identity before replacing a saved record. External name collisions
show an actionable warning and retain the saved conversation across snapshots,
rename and End. Ensure reports `skipped-name-conflict`.

An explicit restore stamps a source-record fingerprint before starting the agent,
allowing its new tmux identity to replace exactly that saved record. Regression
coverage checks rejection, external collision, repeated snapshots, rename, End
and subsequent exact-ID recovery.

### CR11 — P1: clear obsolete recovery expectations on re-adoption

Re-adopting a conflicted session clears the previous conversation, recovery
status, timestamp, detail and presentation state together. Its verified producer
supplies cwd and argv. A descendant SessionStart can then bind the new ID.
Regression tests exercise failed, requested and unconfirmed recovery states;
existing producer checks continue to reject unrelated hooks.

### CR12 — P1: share the selected profile root

[Agent roots](../packages/core/src/agents/roots.ts) now supply hook installation,
status, removal, name binding and title reads. Custom Claude and Codex profiles
stay separate from default stores. Tests install/remove hooks under custom roots
and bind a same-named Claude conversation only from the selected profile.

The root contracts are documented by [Claude](https://code.claude.com/docs/en/claude-directory)
and [Codex](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs)
(checked 2026-11-01).

### CR13 — P2: retain the generated hook runtime contract

The generated OpenCode plugin persists `ELECTRON_RUN_AS_NODE=1` when installed
under Electron. Tests execute the generated module from an environment without
that variable, for both Electron and ordinary Node installations. A stand-in
runtime observes the child environment; no GUI executable is launched. This
checks the documented [Electron mode](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node),
not a real OpenCode version's event delivery.

### CR14 — P2: stop disposing terminals from cached session names

Detach acts on observed tmux clients; End kills the requested tmux session.
Neither action closes editor terminals by a cached name. Direct attach processes
exit naturally; wrappers may remain as ordinary shells. Host refresh clears
references when their clients vanish.

A real isolated tmux client switches from A to B while the fake editor host still
records A. Both Detach A and End A preserve the client on B, and a disposal spy
rejects any cached-name close. This is controller/core integration evidence;
native editor acceptance remains open.

### Verification boundary

The final full run passed 137 tests, with one opt-in real-agent test skipped.
The initial run had one optional Codex title-query timeout; its isolated probe
and final run passed. The intermittent cause remains unlocated and is retained
for investigation. A timeout leaves the optional title unknown; it does not
change the exact conversation ID.

The VSIX installed into an isolated profile and matched all 25 archived files.
The core package matched 105 built files; offline installation and CLI help passed.

The targeted browser journeys cover identity details, long content and recovery
at 1440×900 and 1280×800. Native terminal refresh/disposal, real-agent versions,
OS clipboard, menus/picker, multi-window, iTerm2 and restart acceptance remain in
[the iteration plan](iterations.md). Earlier native evidence does not certify
these changed lifecycle paths.

## Baseline and evidence

The diagnostic baseline was the uncommitted working tree at HEAD
`dfb47bf8c321121b263cfc71016ffc0cc21b6a8a` on 2026-11-01. Its
[source hashes and probe results](assets/code-review/evidence.json) identify the
code that exhibited the defects. Those findings no longer describe the repaired
candidate. [Repair evidence](assets/code-review/repairs.json) identifies the new
source, build, checks and packages; HEAD alone is insufficient for either tree.

The review covered core discovery, hook binding, creation, snapshots, restore,
locking, socket/workspace identity, terminal attachment, host refresh, setup,
clipboard transport, webview rendering and the generated iTerm2 adapter. Probes
and tests use isolated state and named test tmux servers. No daily editor or
user session was modified during repair verification.

## CR1 — P1: startup before discovery

The old hook handler discarded SessionStart while a session was still unmanaged;
owned creation also launched the agent before stamping metadata. Codex could
appear in the list without the exact conversation ID required for recovery.

[Hook handling](../packages/core/src/agents/hooks.ts) now permits first-start
adoption only when auto-adoption is enabled and the hook descends from the single
matching producer in that pane. Existing producer/conflict guards still apply.
[Owned launch](../packages/core/src/registry/launch.ts) holds a placeholder while
metadata is installed, then releases the agent. Stand-in Codex processes test
both unmanaged first-hook binding and an immediate hook during owned creation;
these tests do not certify real Codex hook versions.

## CR2 — P1: normal last exit versus interruption

The old snapshot logic treated an empty inventory as server loss and retained
the last normally ended session. [Runtime lifecycle tracking](../packages/core/src/snapshot/lifecycle.ts)
now records closure by server lifetime and immutable tmux session ID. It does
not change tmux.conf. Listing, snapshots and recovery exclude closed identities,
while abrupt server loss keeps recovery records. A missing session whose server
owner is still alive cannot race a closure hook that has not yet written its
marker. Legacy records without a session ID retain their previous behavior.

The regression holds the last closure hook at a barrier, calls ensure, releases
the hook and verifies the session remains ended. A separate abrupt-loss leg
verifies recovery. Tests now use SIGKILL on the isolated server PID to model a
crash: orderly `kill-server` can itself fire closure hooks.

## CR3 — P1: abandoned-lock replacement

The old shared-directory takeover could rename a newly acquired live lock after
checking an earlier dead owner. [Restore locking](../packages/core/src/restore/lock.ts)
now publishes a unique choosing/ticket record per caller, waits for lower
contenders, ignores dead owners and removes only its own record. There is no
shared stale lock pathname to replace. The local-filesystem ordering and source
are documented in [implementation §2.4](implementation.md#24-names-and-locks).
Ensure also reads the newest snapshot after acquiring the lock.

Six subprocesses contend for the lock over 24 critical sections. An exclusive
sentinel fails if any callbacks overlap. A dead contender is present throughout;
all live callers finish and remove only their own tickets. Legacy live locks
are respected, but simultaneous old/new-version writers during upgrade are not
supported. Network-filesystem lock semantics remain outside verified scope.

## CR4 — P1: invalid cwd fallback

The old preflight accepted any existing path, including a regular file; tmux
could start the pane in the home directory while metadata claimed another cwd.
[Directory validation](../packages/core/src/registry/directory.ts) requires an
accessible directory. Owned launch then compares the placeholder's actual cwd
with the requested directory before executing the agent. Creation, recovery
and health checks share the validation. The regular-file regression verifies
an actionable skip and no launched session.

## CR5 — P1: partial reconstruction

A failed respawn previously left `sleep` alive, stopped the remaining batch and
was later classified as `skipped-live`. [Owned launch](../packages/core/src/registry/launch.ts)
now captures the immutable session ID at creation and cleans up only that
attempt's placeholder. [Restore](../packages/core/src/restore/ensure.ts) returns
an individual failed result, continues unrelated records and persists the failed
identity as retryable. Failed cleanup leaves explicit failure metadata rather
than presenting the placeholder as successful recovery.

The fault-injection regression fails respawn for the first record: its placeholder
is removed, the second record launches, and a subsequent retry launches the first
with its saved identity. Failure cleanup is distinct from intentional user closure.

## CR6 — P1: endpoint isolation

The old state key used only a socket filename. Different custom directories
could therefore share snapshots, restore locks and workspace claims.
[Configuration](../packages/core/src/config/index.ts) now resolves full socket
endpoints, including inherited TMUX and TMUX_TMPDIR. Equivalent named/path
selectors converge; custom endpoints use a canonical path hash. Canonicalization
is stable before and after a socket directory is created, including symlinked
ancestors. Tmux subprocesses use the same context environment as state lookup.

Conventional system-directory keys remain compatible. Ambiguous custom-endpoint
basename history is retained but not silently imported: Diagnose Problems reports its
location and explicit restore is available after source verification. Tests cover
different same-basename endpoints, equivalent selectors, new directories,
conventional keys and legacy detection.

## CR7 — P2: overlapping main selections

Previously, two opens could commit in completion order and let an older slow
selection replace a newer selection. The [controller](../packages/vscode/src/controller.ts)
now serializes main selection, custom main launch and detach. The latest selection
is the final destination; an earlier failed action does not cancel the next one.
Independent side opens retain their separate role.

Controlled host tests cover a delayed first attachment, a failed first attachment,
and detach during a pending open. The native out-of-order attachment scenario
has not yet been rerun on this candidate; the controller ordering is tested without
foreground use.

## CR8 — P2: snapshot ordering

Lexical collision suffixes made `-9` sort newer than `-10` and `-11`.
[Snapshot storage](../packages/core/src/snapshot/store.ts) now compares normalized
timestamps and numeric sequences. A 101-write same-timestamp regression verifies
both newest selection and retention across the 9/10 and 99/100 boundaries.

## Architecture and remaining acceptance

The repairs give lifecycle closure, launch attempts and terminal selections
explicit ownership and ordering. Atomic file rename still protects snapshot
publication; it does not by itself make all session mutations transactional.
Avoid claiming broader concurrency guarantees than the tested contracts.

The core/host split, escaped rendering and clipboard acknowledgements remain.
Inventory runs off the extension event loop, but synchronous tmux/process work
still exists in startup and actions. Native latency measurement remains separate
from core sampling benchmarks.

Reuse the existing browser evidence for unchanged rendering. Rerun native
attachment/layout acceptance when a foreground window is available, then finish
OS clipboard, picker/menu, multi-window, iTerm2/reboot and named real-agent
checks. Install only the package whose source/build hashes are recorded; optional
remote environments require their own evidence.

[Iterations](iterations.md) · [Product review](product-review.md) · [Spec](spec.md)
