# Principle review

This review checks Berth's current features and interaction surfaces against the
[product principles](spec.md#22-product-principles): build on what already works,
and stay minimal and sufficient. It lists where Berth already follows them and
which surfaces were trimmed. The specification owns behaviour; a recommended change
takes effect only after the spec is revised.

## Scope and baseline

Reviewed on 2026-11-09 at release 0.4.6 (`11eb9be`): the VS Code extension's
28 commands, 9 settings, view title, context and editor menus, the sessions
view and the creation flow. The visual assessment uses the
rendered isolated-editor capture of 2026-11-07; the interface has not changed
since, apart from the folder drop line.

## Building on what already works

| Need | Provided by | Berth's part |
|---|---|---|
| Keep agents running; attach from several terminals | tmux sessions, clients and options | Read and stamp session metadata; install hooks |
| Conversations, resume, activity events | Each agent CLI and its hooks | Verify identity before resuming |
| Terminals beside files, diffs and browsers | VS Code editor terminals and extensions | Open the right session in the right terminal |
| Search, notifications, layout | Quick pick, notifications, Profiles | Supply the items and the preset |
| Window and pane restoration | iTerm2 | Reattach each restored pane |

Berth draws two surfaces itself, each with a recorded reason. The sessions view
needs two-line rows, which VS Code's tree cannot show (spec §6). The details card
must be enterable and copyable, which a native hover tooltip does not allow
([session details review](session-details-review.md)).

One mechanism is heavy for what it buys. Preparing the layout Profile without
VS Code's create-Profile dialog uses a helper that survives the window reload
and reads the native Profile registry. It serves a first-run experience the
spec requires, so it stays; any further work on it should first check whether
VS Code's own Profile import now meets that requirement.

## Findings

Changes below take effect in the release after 0.4.6.

| Priority | Surface | Finding | Outcome |
|---|---|---|---|
| High | Session context menu | *Show Session* and *Open in This Window* ran the same action (`controller.show`) and both appeared on every session, since 0.4.3. | One entry, *Open*. `berth.openHere` stays registered for existing key bindings. |
| Medium | Context menu of a stopped agent session | At least eight entries, of which four or five concerned recovery. *Choose Recovery Folder*, *Choose Recovery Profile* and *Review Recovery Options* appeared on every stopped session, although *Check Recovery Readiness* already offers each one when its blocker exists. | Each repair action appears only while its blocker holds. The core reports a missing folder on the stopped row (`cwdMissing`), so the menu does not inspect paths. |
| Medium | Command palette | *Inspect Earlier Layout Backup* serves only users of the retired in-place layout, yet appeared for everyone. | Listed only when a legacy journal or legacy state exists; a damaged journal counts. |
| Low | Command palette | *Refresh* was listed although the view updates on terminal events and every 2 seconds, and a failed refresh shows its own Retry. | Kept in the view's overflow menu only. |
| Low | View title | *New Session* and *New Session in Folder* sit side by side. | Kept. One starts in the inferred folder, the other always asks; both are frequent, and moving one into the overflow adds a click. |
| Low | Settings | `berth.layout.managedProfile` is internal state shown in the Settings UI. It is a setting because the prepared Profile must confirm Berth's settings loaded, and only settings are both per-Profile and readable across the switch. | Kept; its description already says Berth manages it. Revisit if VS Code offers per-Profile extension state readable before activation. |

Kept after review: `berth.hover.delay` exists because VS Code does not let an
extension change `workbench.hover.delay` for its own views (spec §6); `berth.tmuxSocket`
serves users with a non-default tmux server; the other settings cover choices
that differ between users.

## Experience

The rendered view stays within the host's look: two lines per row, theme colours,
Codicons and native terminals, with no Berth-specific chrome around the editor.
Creation now inspects the launcher in the same step as creating
([iterations](iterations.md#session-responsiveness-investigation)).

Open questions that need a user task before changing anything: whether the
connection markers controlled by `berth.view.details` help users identify
sessions, and whether *Adopt as Agent Session…* is still reached now that
discovery adopts recognised agents automatically.
