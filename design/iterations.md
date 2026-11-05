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

## Deliberately outside this iteration

Cloud sync, remote control service, team collaboration, embedded browser,
chat/composer, model selection, worktree/Git operations, dashboards and a second
settings UI. Reconsider only when an observed user task cannot be completed with
the existing host and the core session contract.

[Review](product-review.md) · [Spec](spec.md) · [Implementation](implementation.md)
