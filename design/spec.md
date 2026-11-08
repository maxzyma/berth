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

Berth targets people who already work across editor terminals and iTerm2 and
want those hosts to remain their session entry points. Persistence alone is
not a unique reason to choose it: tmux provides live process persistence, and
[cmux supports local tmux and agent restore](https://github.com/manaflow-ai/cmux/blob/main/docs/local-tmux.md).
Berth must earn its place through discovery, exact conversation binding and
host-specific reopening within the user's existing tools.

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
host can also be attached in the other. Reopening follows the recorded workspace
ownership and host-specific pane identity (§4.1, §6, §7); multiple hosts may remain
attached at once. Other terminals can attach to the same tmux sessions;
Berth does not claim exclusive cross-terminal sharing.

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
  release: launch, conversation binding and resume for each. Adapter fixtures
  establish command construction, not live compatibility. User-facing support
  claims must distinguish implemented adapters from agents whose binding and
  resume have been verified against the stated CLI version (§8).

### 2.1 Core principle: terminal-led launch, evidence-based discovery

The terminal executes the user's chosen command or custom script. The launcher
owns how the agent starts, which agent runs, its configuration and whether to
create or resume a conversation. Berth observes the resulting processes and tmux
connections, verifies identity and then manages the discovered session.
This is a required architectural boundary for existing and future features.

- A launcher need not know Berth exists. Do not require a Berth SDK, wrapper,
  callback, request token, result schema, environment marker or naming convention
  to discover and manage sessions within the supported tmux/agent scope.
- Do not couple discovery to a script name, script implementation, workspace
  layout or Berth-owned creation path. Sessions started outside Berth follow the
  same identity and management rules as sessions opened through its UI.
- Built-in launch templates remain an optional convenience. They must not
  supersede configured terminal launchers or become a prerequisite for management.
- Hooks and native evidence may improve conversation binding and activity
  reporting. Missing evidence means those particular facts are unknown; it must
  not turn launcher cooperation into a prerequisite or justify a guessed identity.
- CLI, MCP, plugins and future integrations must preserve this boundary. Queries
  may expose verified facts; executing a launcher does not prove agent readiness
  or task receipt. Autonomous dispatch and content handoff are not prerequisites
  for session management and must not make Berth the owner of agent startup.

Changes to this boundary require an explicit product decision from the maintainer
and a revision of this section before implementation. A feature proposal or an
implementation shortcut cannot implicitly override it. Launch behavior (§5.2),
frontend creation and extension proposals must be reviewed against this section.

### 2.2 Voluntary support

Maintainer sponsorship uses one shared destination: [Ko-fi](https://ko-fi.com/maxzyma).
Expose it through GitHub's Sponsor button and a short section at the end of the
root README. Keep sponsorship outside the product UI: no prompts, persistent
promotion, feature gates or paid-support commitments. The maintainer profile
uses the same avatar as GitHub so supporters can recognize its owner.

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
| **Managed session** | A session carrying Berth metadata (below). Created by `berth new`, adopted with `berth adopt`, or discovered running an agent (§4.3). |
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
| `@berth_argv` | Berth launch command or shell-quoted OS argument vector; control characters use the `berth-json:` JSON string encoding |
| `@berth_argvVerified` | `1` when arguments come from launch, exact process capture or explicit review |
| `@berth_conversation` | conversation id, or empty if not yet known |
| `@berth_origin` | `vscode` / `iterm2` / `none` |
| `@berth_state` | `working` / `waiting` (needs the user) / `done` / empty when inactive or unknown; written by hooks and verified native observations |
| `@berth_stateRevision` | opaque revision advanced on every activity write |
| `@berth_activityTiming` | live-only JSON: current state, optional turn start and state-event time; never restored |
| `@berth_nativeCheckedAt` | last native observation attempt; scheduling only, never restored |
| `@berth_nativeTranscript` | Gemini request cursor: canonical path, file identity, byte offset, prefix fingerprint and capture time; live-only |
| `@berth_nativeCodexSelection` | verified native footer ID, profile root and rollout revision; live-only, never restored |
| `@berth_note` | latest notification text from the agent, shown in session lists |
| `@berth_topic` | first line of the user's latest prompt, from a hook or the verified native Codex rollout; the session's subtitle |

### 4.1 Origin rules

- Stamped when a frontend creates a session, and re-stamped when a frontend
  attaches a session: opening a VS Code session from iTerm2 moves it to iTerm2.
  Attachment eligibility uses current core session metadata, not a cached view
  row. Metadata added or removed since inventory must affect both main and side
  attachment ownership.
- Never inferred from attached clients. A session can be attached from two
  terminals at once, or from none.
- `none` sessions are restored as processes but no frontend reopens them.

### 4.2 Conversation binding

One managed session represents one independent agent producer. Binding records
its pane and detectable process lifetime; discovery examines all panes and independent process branches, not
only the selected pane. Descendants of an agent are its subagents, not new
owners. Multiple independent agents, an adapter mismatch or a hook from a
non-owner pane must never overwrite conversation, task or lifecycle state.
Missing process-lifetime evidence on an existing conversation means its binding
needs verification; it is not proof that the producer changed. Discovery preserves
the original ID and blocks automatic recovery until a producer-verified hook
reports that same ID, or an authoritative start event establishes the conversation.
Existing change warnings without lifetime evidence are reclassified, not cleared.
Replacing the producer inside the same pane does not preserve its conversation
identity. Discovery marks the row conflicted until a verified new start event or
explicit re-adoption establishes the replacement. Public `stamp` agent changes
follow the same transition as adoption; manual conversation changes reset obsolete
recovery expectations and capture the current profile.

The session remains attachable and displays a binding conflict; snapshots keep
the conflict and automatic recovery skips it until the user separates the
agents and explicitly adopts the verified single producer again. Re-adoption
clears the old conversation binding and waits for authoritative identity evidence. Pane/process identity is live-only;
it is never reused after a server restart.

A lifecycle payload carrying a different conversation ID cannot update the
current conversation's state. Only a start event can replace the ID. When a
producer process is detectable, the hook must descend from that process;
a delayed hook from a different process is ignored. Unknown process formats
retain the pane-level guard and cannot replace a different existing ID: the
row reports a binding conflict instead. They are not process-verified. Verified
start events may update the ID after a native fork or clear operation.

Binding authority:

1. **Agent hook.** The agent reports its own id at session start (Claude Code
   `SessionStart`, which also fires on resume, clear, compact and fork, so the
   stamp follows id changes). The hook runs `berth hook <agent> <event>` and passes the producer guard.
2. **Verified native evidence.** Passive first-install binding may establish identity under the checks below.
3. **Unbound.** Automatic restore is skipped. When recovery is requested, offer
   the agent’s native conversation picker or an explicit new session. Berth never falls back to "most recent conversation in this directory".

Conversation names are display metadata. Berth may pass `--name` at launch, but
matching an old transcript title cannot establish a current conversation ID.
Fresh and externally launched sessions remain unbound until an authoritative
start hook, verified native evidence or explicit exact-ID binding establishes their identity. A later
name match cannot overwrite or fill that identity.

The same hooks keep `@berth_state` current from the agent's lifecycle events
(prompt submitted → `working`, needs approval → `waiting`, turn finished →
`done`). The prompt-submitted hook also records the first line of the prompt
as `@berth_topic` (at most 120 characters), when the agent's payload carries
it (`prompt`); it is metadata for display only and never enters snapshots.

Agents without Berth hooks can still ask for attention: a terminal bell in
their session (tmux `alert-bell`, hooked by `berth tmux install`) sets
`@berth_state` to `waiting` with note `bell`. Agents whose installed hooks
report `waiting` ignore the bell when no separate native trust decision is required.
Codex keeps the fallback because each hook may still be untrusted; agents with
no waiting event (Cursor CLI, OpenCode) also keep it. A bell preserves an existing
non-bell waiting state and its explanation. Showing the session in a
frontend clears a bell-raised `waiting`. After main or side attachment, the core
re-reads and presents current activity under its state lock. Cached inventory
state must not overwrite a newer hook or bell acknowledgement.

Hooks are written only by `berth hooks install <agent>`, are marked as Berth's,
and are removed by `berth hooks uninstall <agent>`.

Missing hooks mean lifecycle updates and future conversation binding may be
unavailable. An already bound ID remains resumable. Berth explains hook installation separately from
the current conversation binding: `berth new`
and `berth adopt` print the install command on stderr; a terminal other than
VS Code attaching to such a session shows it in tmux's status line, once per
agent per tmux server (sessions started by a custom launcher reach the user
this way); VS Code offers to install them (§6). Session rows carry the
agent's hook status so every frontend decides the same way. Installing still
needs the user's go-ahead, because it edits the agent's own configuration.

#### Late first-install binding

For Claude Code, Codex CLI, Gemini CLI, OpenCode, GitHub Copilot CLI, Cursor CLI
and Kimi CLI, a missed start event must not permanently prevent binding. A
registered top-level turn event carrying an explicit conversation ID may fill an
empty binding when the hook descends from the sole detected producer in the
owning pane. Preserve a different existing ID, reject child-agent evidence and
unknown events, and do not treat these events as recovery-start acknowledgements.
Capture the hook's profile and persist the binding before returning. This also
applies to previously unmanaged sessions when automatic adoption is enabled.
Qoder remains outside this iteration.

A late event requires the agent to load and execute its integration. Installing
hooks does not retroactively deliver events or establish the currently open ID.
Passive evidence and late events are complementary; neither may guess from a
conversation name, directory or last-used record.

#### Passive first-install binding

Hooks are one identity source, not the only source. For a Codex CLI process that
holds its active rollout file open for writing, discovery may read the bounded
session-meta header and bind its exact ID and profile. Require a single top-level
CLI rollout, matching filename/header IDs, a stable process lifetime, the same
single producer/pane and the same tmux session generation before publication.
Never use working-directory recency, a global loaded-thread list, a launch-time
resume argument alone, subagent rollouts or a shared daemon's file handles as
current TUI identity. Existing different IDs and conflicting profiles are preserved.
Probe failures leave identity unknown; they do not invalidate a known binding.

For shared-daemon Codex, the configured native `session-id` footer is an optional
selection source. It must contain one complete UUID in the current composer/footer,
not transcript text or a truncated title. Verify the sole live TUI producer and its
lifetime, derive the profile from that process's own writable native log database,
and look up only that exact ID in the profile's native thread database. The rollout
header must agree on the ID and identify a top-level CLI conversation: `source=cli`,
or the native TUI variant `source=vscode` with `originator=codex-tui`. Other editor
and subagent records remain rejected. An npm wrapper may supply the owner identity,
but profile descriptors must come from its sole direct native child with matching
CLI arguments. Recheck the
same footer selection, producer and metadata immediately before publication.
Never match a UUID prefix, directory recency or a daemon's arbitrary environment.

A verified native selection can establish or change the same producer's conversation.
Changing selection clears previous activity and prompt data; a different profile,
producer or conflicting recovery target remains rejected. A complete new ID without
a persisted root rollout is not yet recoverable. For bindings owned by this observer,
a hidden, truncated, child or otherwise unverified selection suspends recovery and
transcript-derived activity until verification returns; keep the last ID as historical
evidence, not as proof of current selection. Snapshot the suspension and verified
identity transitions. Native selection metadata is live-only.

Read the latest typed user-message and turn lifecycle records only from that verified
rollout. Bound reads, reject incomplete or changed files and root/child mismatches,
and guard publication with activity revision checks. Working screen evidence takes
precedence over a prior completed turn; a native background-terminal wait is not a
request for the user. Do not fabricate success from the absence of a running widget.
Native recovery acknowledgement must match both the expected ID and profile.

This is a version-tested fallback, not a universal Codex API. Enabling the native
footer requires explicit user choice and preserves existing status-line fields;
launch scripts remain unchanged. Existing `--remote`, remote-auth environment-name
and `--no-daemon` launch choices must be preserved on exact-ID resume. Without a
usable identity surface, activity display
can still work but exact binding, summary and recovery remain unavailable.

### 4.2.1 Session names and conversation titles

The tmux session name remains the stable session key and terminal title. A
launcher may choose it; detecting an agent never renames the session or imposes
a launcher. Agent conversation titles are separate display metadata, read only
from the exact bound conversation ID. Titles must not replace IDs for restore,
and a prompt excerpt must not be presented as an explicit conversation name.
When available, details show the conversation title and ID alongside the session
name. Missing or unreadable title data leaves the title absent. JSONL title readers
search records from the end until the latest matching names are found; disjoint
head/tail samples cannot establish the latest name. Memory holds read chunks and
at most one complete JSON record, not the whole conversation.

Derived title caches live in Berth's state directory, never in agent stores or
recovery snapshots. They contain only requested IDs/titles and a source fingerprint
(device, inode, size, nanosecond modification and change times). Unchanged sources
may reuse results across inventory workers. Any source change, including growth,
truncation, replacement or rewriting, invalidates the result; append-only behavior
is not assumed. Check the open file and pathname again before accepting a scan.
Cache read/write failure falls back to direct inspection and never blocks sessions.

Existing launch-time name propagation (Claude Code and Qoder) is preserved.
A launcher that supports resume must resolve its own named session to an exact
conversation, or report that it cannot; it must not silently resume the latest
conversation in the directory. Berth never rewrites agent databases to force
name agreement. Native agent naming support, where available, belongs to the
launcher or agent hook, not terminal discovery.

### 4.2.2 Live connections

Connections come from the current tmux client inventory, independently of
origin and agent state. The displayed client count and client identities use the
same successful client sample. A failed sample is not an empty sample: retain
the last inventory with its existing refresh-error indication. A positive
client identity always proves a connection even if an older count says zero.
Window membership is a separate check. Until terminal PIDs or process ancestry
are available, a connected session's window may be unknown; it is never detached
for that reason. Terminal PID collection is bounded so one unresolved terminal
cannot block the inventory refresh. Terminal lifecycle changes request refresh.
Local terminal and editor-group events update the active marker from known
terminal identities without waiting for agent discovery. This applies equally to
managed agent sessions, managed shells and unmanaged tmux sessions. Closing a view removes
its local membership immediately; session lifetime still comes from tmux.
Creation runs outside the editor event loop and retains its serialized core
transaction and required snapshot. Inventory results sampled before a terminal
lifecycle change are discarded and sampled again.
Lock scans remove tickets whose recorded process identity is confirmed dead;
unknown identity or access failure must not be treated as a dead owner. PID
existence is a cheap preliminary check, never a replacement for birth identity.

Host lifetime identity uses the OS boot-session identifier and process birth,
not a formatted boot-time clock reading. On macOS this is `kern.bootsessionuuid`;
on Linux it is `/proc/sys/kernel/random/boot_id`. Legacy macOS keys have no stable boot identifier; their upgrade compatibility
requires the exact live PID and process birth, not the drifting boot-clock
seconds or microseconds. New UUID records require the boot UUID as well. The same
compatibility applies to agent-producer identity and native activity checks.
Discovery may normalize an old identity and clear only the producer-changed
flag when the single live agent, pane, PID and process birth all match; it must
preserve conversation/profile identity and unrelated binding issues.
A verified Claude native `waiting` observation changes working to waiting for
user input; `idle` clears activity. This includes native choice prompts such as
usage-limit dialogs. Neither observation changes the conversation or answers
an agent prompt. Matching requires the exact PID, conversation and process birth.
Each connection has its client PID and terminal;
verified application names are shown when available. A matching live host
registration supplies its application name before process-name or terminal-type
fallbacks; an unrelated registration supplies neither application nor workspace. A frontend determines
which clients descend from terminals in its own window, including terminals
not created by Berth. Unknown hosts remain “Other terminal”; a working
directory is not evidence of a window identity.

The row uses icons only for connection and activity metadata; application names
and status explanations appear in hover details and accessible labels, not as
list text. Multiple connections use a stacked host outline; hover lists the
individual connections. Detached means the live
session has no attached client, not that its agent has stopped. Missing client
identity is not evidence of detachment.

Resume argument preservation parses option arity before selecting options to
replay. Values of discarded options cannot become flags. Retained variadic
options preserve their complete value list; paired restrictions such as Claude's
`--strict-mcp-config` travel with the selected configuration. Words after the
standalone `--` terminator remain positional input. Unknown option syntax or
missing values requires Review Recovery Options even when the OS argv is verified;
provenance does not prove that Berth understands the option semantics.

Copilot recovery preserves its model/reasoning options, explicit tool restrictions,
added directories and switches disabling telemetry, updates, built-in MCPs,
custom instructions or user questions. Startup prompts (`--interactive`/`-i`
and `--prompt`/`-p`), names and session selectors are consumed with their values
and omitted; the bound conversation ID is the sole recovery target. Option
arity is checked against native CLI help (1.0.105). Unsupported syntax continues
to require review rather than silently changing the recovered configuration.

Native tmux records use one reversible field transport for session, pane and
client lists and scalar identity/path reads. The escape prefix, newline, carriage return, tab, unit separator
and field separator are encoded
before tmux emits each record and decoded once after framing. Framing uses a
printable delimiter, encoded when it occurs inside a value, because tmux 3.4
escapes control bytes in command output. The escape syntax contains no percent
directives that `display-message` could interpret as date formatting. On tmux 3.0, which lacks `session_path`, the native path falls back to the
active pane path; a managed producer still records its own verified cwd. Paths and names
retain leading/trailing whitespace; a scalar reply removes only its final output
newline. Metadata writes do not silently replace identity characters. macOS
process directories come from `PROC_PIDVNODEPATHINFO`, not escaped `lsof` display
text; Linux uses the process cwd link. Discovery and explicit adoption consume the same producer cwd;
they do not substitute a launcher shell directory when the producer directory is
readable. The native reader reports failure instead of interpreting escaped display
text; the pane path remains the fallback when the producer directory is unavailable.

### 4.3 Discovery

Berth must not depend on how a session was started: a launcher needs no
knowledge of Berth. A live session without metadata, or one marked as a shell,
with exactly one independent agent across its panes is managed automatically: Berth finds the
agent among the pane's processes by program name, or by script name behind an interpreter (`node
<cli>`). The script position is considered only for a supported interpreter;
an editor opening a file named after an agent is not an agent producer. Some agents
run as a binary named after their version. It
records the agent, that process's command line as `argv`, that process's own
working directory as `cwd` (a launcher often starts the session elsewhere and
changes into the project; the pane's current path names the foreground
group's leader, which may be the launcher's shell), and origin `iterm2` when an iTerm2 client is attached,
else `none`. An existing host origin is preserved when a managed shell starts
an agent. A plain shell remains a shell; an existing non-shell agent binding
is not replaced by discovery.

Recovery arguments must come from the original argument vector, not whitespace
splitting of process-list display text. Linux reads `/proc/<pid>/cmdline`; macOS
reads `KERN_PROCARGS2` through the system Perl syscall bridge. Only argv leaves
the bridge; environment entries are neither returned nor saved. Reads are bounded,
fail closed on missing tools, permissions, malformed data or a departed process,
and preserve spaces, quotes and empty argument values. A detected producer whose
arguments cannot be verified carries a recovery conflict until a later successful
observation or explicit re-adoption. Process-table display text can identify a
candidate but never supply its recoverable options. No native compilation or
additional npm binary is required at installation time. Exact argument provenance
is recorded with snapshots. Live producers can refresh legacy arguments from the
OS. Stopped legacy records with retained options require explicit review through
Review Recovery Options or `berth recovery-options <session> -- <options>`;
empty options explicitly select agent defaults. Unknown options are rejected,
not silently dropped. Records that replay no options need no migration prompt.

Discovery runs whenever Berth looks at sessions — every full snapshot (so every
hook-triggered snapshot), a client attaching, `berth ls`, `berth doctor`, and
each VS Code refresh — and is switched off with `[sessions] auto_adopt =
false` or `BERTH_AUTO_ADOPT=0`. Conversation ids come from agent hooks or
the binding authority rules for any session (§4.2).

## 5. Berth core

TypeScript library plus the `berth` CLI. Node ≥ 20. No editor dependency.

The core is the shared kernel of every host. It owns everything about
sessions — metadata, launch and resume, snapshots and restore, bells, which
terminal a client belongs to, and how state is shown on that terminal — so a
session behaves the same whichever host shows it, and can move between hosts.
A frontend only does what its host alone can do:

| | Berth for VS Code (§6) | Berth for iTerm2 (§7) |
|---|---|---|
| Uses the core | bundled library for actions; bundled CLI for asynchronous sampling | through the CLI, from an AutoLaunch script |
| Shows sessions | its sessions view and per-session terminals | the panes iTerm2 restores |
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
| `berth rename <session> <new name>` | Rename a live session and its recovery record; names use letters, digits, `-` and `_`. |
| `berth snapshot` | Write a snapshot (§5.3). |
| `berth forget <session>` | Stop restoring a stopped session (§5.3). |
| `berth ensure [--origin <o>] [<session>]` | Rebuild missing managed sessions from the newest snapshot; idempotent and lock-protected so concurrent callers rebuild once. |
| `berth restore [--origin <o>] [--session <s>] [<snapshot>]` | Explicit restore from a chosen snapshot, same rules as `ensure`. |
| `berth show <session> [<snapshot>]` | Print saved scrollback. |
| `berth doctor [--json]` | Report unbound sessions, missing working directories, unknown agents and agents in use without hooks. |
| `berth present <session>` | Show the session's state again on the terminals attached to it. |
| `berth hooks install\|uninstall <agent>` | Agent hooks (§4.2). |
| `berth hooks upgrade codex` | Add missing events to a recognized legacy Berth installation; preserve existing definitions and native trust settings. |
| `berth tmux install\|uninstall` | Managed block in the user's tmux config: snapshot, bell and attach hooks. |
| `berth iterm2 install\|uninstall` | Install the iTerm2 AutoLaunch script (§7.3). |
| `berth iterm2 reattach <session> [--existing-tty T]` | Rebuild if missing and print its attach command; repeated startup ttys defer attachment when a matching live client already shows this session (§7.3). |

Tmux installation recognizes only complete standalone managed-block markers.
Unpaired, reversed or repeated markers fail before changing configuration. Text
outside the block is preserved, including marker text inside another command.
Reinstallation replaces the block in place, preserving configuration order.
Configuration publication uses the same atomic, symlink- and mode-preserving
writer as agent hooks. Updating the running server is a separate operation:
if it fails, report the cause and that the saved configuration has already changed,
so retry is explicit rather than reporting a successful installation.

Every command accepts `--socket <name>` (a tmux `-L` server) and
`--socket-path <path>` (a `-S` server). Run by hooks, not by people: `hook
<agent> <event>` (§4.2), `bell --session <s>` (§4.2), `attached --client <name>`
(§7.3). The older `attached --session <s> --tty <t> --termtype <x>` form remains
accepted for installed hooks. Berth's tmux hooks pass the socket of the
server they run in, so each server's state stays separate.

### 5.2 Launch

All launch paths follow the [core launch principle](#21-core-principle-terminal-led-launch-evidence-based-discovery).

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
it); sessions it starts elsewhere are discovered (§4.3). A launcher may also
stamp metadata itself (`berth stamp`, or the `@berth_*` options); what it
stamps is kept. Activity updates use `berth stamp` so the state revision and
shared lock protect them from older observations.

The frontend scopes pending adoption to the successful launcher terminal process.
It assigns that intent inside the serialized main-terminal action and clears it
on failure, expiry or an explicit main selection/detach. An observation from
another terminal cannot consume it; session creation time alone is insufficient.

When the agent exits, the session ends — Berth does not leave a stray shell.

### Operation ordering and failure boundaries

- A verified first start hook may adopt its producer before periodic discovery,
  only when auto-adoption is enabled. Owned creation stamps metadata before
  releasing the agent process. Unverified external hooks cannot adopt a session.
- Runtime tmux lifecycle hooks record normal closure by server lifetime and
  immutable session ID, including the last session. They do not edit tmux.conf.
  Paths embedded in tmux hook commands remain literal through both tmux format
  expansion and shell parsing. Only explicit runtime placeholders may expand;
  format-looking directory or executable names cannot redirect a hook.
  Snapshots exclude closed identities; abrupt server loss retains recovery data.
  Recovery waits out a live server owner whose missing session is still closing,
  so a delayed closure marker cannot race a new launch.
  Legacy records without lifecycle identity keep their existing recovery behavior.
- Recovery locks use independently owned contender records: dead contenders are
  ignored, never replaced through a shared lock pathname. Release deletes only
  the caller's record. The newest restore snapshot is read after acquisition.
- Invalid or inaccessible cwd never falls back to another directory. The launch
  placeholder's actual cwd is checked before starting an agent.
- Each failed reconstruction has its own result. Only its owned placeholder may
  be removed; unrelated sessions still restore, and the saved identity remains
  retryable. Placeholder cleanup is not a normal user-requested closure.
- Main-terminal selections are serialized; the latest selection is the final
  destination. Failed earlier selections do not cancel later selections. Detach
  joins the same ordering, so a pending open cannot silently undo it.
- Snapshot ordering compares timestamps and numeric collision suffixes.

### Identity boundaries for recovery and terminal actions

- Server liveness compares the endpoint's current server lifetime with the saved
  lifetime. A reused PID is not the original owner. Persistent restore tickets
  and workspace claims carry a process-lifetime fingerprint; legacy PID records
  are checked against their creation time and cannot silently imply identity.
- Stopped names are reserved for explicit creation as well as generated names.
  An external live session reusing a stopped name creates a visible conflict;
  snapshots preserve the stopped conversation instead of replacing it. Rename
  or end the colliding live session to expose the stopped record again. Neither
  action implicitly forgets a distinct stopped conversation. Retry applies the
  same identity collision check before ending any live attempt; it cannot replace
  a different live conversation merely because the names match.
- Every agent change validates the currently observed producer; an incompatible
  producer selection is rejected. Re-adoption of a conflicted producer or an
  agent change clears the prior binding and all recovery
  expectation fields together, then records the verified producer's agent/cwd/argv.
  The next valid start hook establishes the new identity. Unrelated producers
  remain rejected.
- Each adapter resolves its storage root once for hooks, binding and titles.
  Claude respects CLAUDE_CONFIG_DIR, Codex respects CODEX_HOME, and existing
  adapter-specific overrides remain supported. Installation and removal do not
  touch another profile's files.
- Generated hooks preserve the executable's runtime mode, including OpenCode
  installed through the editor's Electron runtime and later executed by a shell.
- Detach acts on observed tmux clients, never disposes an editor terminal merely
  because a cached label matched. Direct attach terminals exit naturally; shell
  wrappers may remain as ordinary terminals. End kills only the target tmux
  session. Polling clears stale session references without closing terminals.

Claude Code reports waiting on `PermissionRequest` immediately. Typed
`Notification` payloads count as waiting only for `permission_prompt`; message
matching is a fallback for legacy payloads without a notification type.
`PostToolBatch` returns to working after the full tool batch resolves. Individual
tool completions do not clear another parallel tool's pending approval.
`StopFailure` clears activity and its note without declaring successful completion.
These mappings are verified against Claude Code 2.1.310 and its
[hook reference](https://code.claude.com/docs/en/hooks).
A cancelled or denied turn may emit no terminal hook. Inventory supplements hooks
with the read-only `claude agents --json` query in the recorded profile. Only an
unambiguous interactive idle record matching the bound conversation, live producer
PID, process lifetime and pane may clear working/waiting and its note. It never
creates a binding or successful completion, and preserves done. Unsupported CLI
versions, query errors, unknown records and conflicting identities leave state
unchanged. Do not infer cancellation from elapsed time or a missing response.

Codex activity may be supplemented by a read-only observation of the current
producer pane's visible viewport. This is presentation evidence, not conversation
identity: it never writes a binding, stored prompt summary, successful completion or
recovery metadata. A recognized visible prompt may supply an ephemeral `terminalPreview`
when no trusted task text or conversation title is available. This is a best-effort
excerpt, not a verified latest-message record. Require the native composer/footer,
a preceding top-level prompt and a following response marker; reject fenced text,
commands and empty prompts. Never inspect scrollback or retain the excerpt between
samples. Hover identifies it as a visible terminal prompt. It cannot trigger unread
notifications, binding or recovery. Recognize the native composer/footer and its current running
indicator together; a footer without a context meter or UUID additionally requires
the visible native version header and model/reasoning footer shape; text in scrollback or quoted output alone is insufficient.
Working may replace a stale done display, but never a hook-reported permission
wait. When the native layout is hidden, truncated or unknown, do not infer idle or
success. Recheck session incarnation, producer lifetime, pane and activity revision
before presenting a sample. A configured footer's complete session ID is a candidate for the independent
profile and rollout validation in §4.2, not permission to bind from screen text alone.
No Codex configuration or launcher is changed by this observer.

Native queries run outside the state lock. Every activity write advances an opaque
revision; before applying a result, inventory rechecks that revision, identity and
activity metadata, server/session incarnation and the producer lifetime. Scheduling
markers are excluded from that comparison: another observer starting a query
cannot invalidate an otherwise current result. A newer turn invalidates an
older observation even when both turns have the same activity and conversation.
Each inventory pass queries at most one profile, with a 1.5-second timeout, forced
termination on expiry and a bounded output buffer. A CLI that ignores graceful
termination must not keep the inventory worker blocked. Profiles with eligible active sessions are selected by
oldest last attempt, so a failed profile cannot starve another. These attempt
markers are scheduling metadata, not evidence of idle or cancellation.

Gemini reports working on `BeforeAgent`. `BeforeModel` changes an existing
permission wait to working when the next model request begins after tool decisions resolve.
An individual tool completion does not clear another tool's pending approval.

Gemini cancellation may omit `AfterAgent`. On a verified `BeforeAgent`, core
records a live-only cursor into the hook's native transcript: canonical file
identity, byte offset and prefix fingerprint, within the recorded Gemini profile.
For cancellation, inventory requires a new typed native `info` cancellation
record for the bound conversation after that cursor, including native rewind
records following cancellation. This may override a late completion hook from
the aborted turn. User/model text with the same content is not a cancellation
signal. A later message, partial record,
changed file identity/prefix, unknown schema or unreadable file leaves activity
unchanged. Reads are bounded and run outside the state lock; the same producer,
profile, session incarnation and activity revision checks apply before clearing.
A typed terminal error or the native failure summary may override done only
when `AfterAgent` has acknowledged the end of that loop. An error record alone
cannot clear working: diagnostic errors can occur while a turn continues.
This handles both full and reduced error verbosity without treating a successful
response following an earlier error as failure.
Session start and a new request discard the previous cursor. This observation
never binds a conversation or marks a turn successful.

Cursor's `stop` hook reports the end of the loop, not necessarily success.
Only `status: completed` produces done; aborted, error, missing or unrecognized
outcomes clear activity and its note without success. The conversation binding
and next prompt remain intact. This follows the [official stop schema](https://cursor.com/docs/hooks#stop),
checked 2026-11-01; runtime delivery by individual CLI versions remains a separate
acceptance requirement.

Kimi profile display, hook installation and health checks share one directory
resolver: `KIMI_CODE_HOME` overrides the default `.kimi-code` directory; an
existing legacy `.kimi` directory is used only when `.kimi-code` is absent.
The displayed profile must match the location actually inspected and installed.
Kimi binds its agent at session creation. Exact-ID recovery omits creation-only
`--agent` and `--agent-file` selectors and lets Kimi restore that stored binding;
model, permission and directory restrictions continue to follow the adapter policy.
Kimi emits `Interrupt` instead of `Stop` when a user cancels a turn, and
`StopFailure` when a turn fails. Both clear active state and note while preserving
the bound conversation; neither produces a successful-completion indicator.
`PermissionResult` returns the session to working after an approval decision,
including denial when Kimi continues its agent loop. The subsequent lifecycle
event determines whether the turn completes, fails or is interrupted.

Qoder returns to working after `PostToolUse` or a non-interrupted
`PostToolUseFailure`; a completed permission-gated tool must not leave an approval
request active. `PostToolUseFailure` with `is_interrupt: true` and `StopFailure`
clear activity and its note without declaring completion or changing conversation
identity. Unknown events and unverified denial semantics do not synthesize a state.
These mappings follow [Qoder's hook reference](https://docs.qoder.com/cli/hooks);
native version delivery remains a separate acceptance check.

Codex recovery retains the verified `--no-alt-screen` terminal presentation option.
Codex maps `UserPromptSubmit` and completed-tool `PostToolUse` events to working,
`PermissionRequest` to waiting and `Stop` to done. `Interrupt` clears active
state and its note without declaring success or changing conversation identity.
A new prompt replaces a previous turn's completion. Permission details use the
agent-provided message or tool description, with a tool-name fallback. Independently trusted hooks cannot suppress the terminal-bell fallback
based on file presence alone; a bell must preserve an already reported waiting
state and its explanation. Only observed lifecycle events change state: a successful tool completion
clears waiting; clicks, elapsed time and file presence cannot imply approval.

Codex legacy hook upgrades only add missing lifecycle events to a recognized,
unmodified Berth installation containing exactly SessionStart and Stop. Existing
handlers and their definitions remain unchanged, preserving native trust identities.
Missing, disabled, malformed or customized installations are left untouched for
explicit repair. The VS Code host checks its default profile and verified session
profiles once per activation through the bundled CLI; it does not require launcher
changes. A successful upgrade means configuration was updated, not that the running
agent received events. New definitions still require native trust review.

Codex hook installation writes configuration but does not grant trust. Installation
feedback and installed-session details direct users to Codex `/hooks` to review
new or changed Berth definitions. Berth never edits Codex trust records or adds a
trust-bypass flag on the user's behalf. File completeness remains separate from
runtime activation. This follows the [Codex hook trust contract](https://learn.chatgpt.com/docs/hooks)
(checked against CLI 0.166.0 on 2026-11-01).

Hook health distinguishes missing configuration, broken/partial configuration,
and a complete installed configuration. Completeness requires the adapter's
expected events, matching Berth-owned commands and accessible runtime/script
files in the selected profile. Broken hooks offer repair and cannot suppress
bell fallback. This file-health check does not certify agent-version support or
successful runtime delivery. Installation preserves unrelated user hooks.

Copilot error hooks also fire during automatic retries and cannot establish
that a turn has ended. For a verified Copilot producer, the prompt hook records
a cursor in its exact profile/session event stream. A matching root turn-end
followed by a terminal session error or user-initiated abort may clear working
or waiting; retries and
successful turn-end records alone may not. This fallback uses the shared native
observation ownership/revision checks and never establishes binding. New prompts,
unknown event shapes and changed files invalidate the observation.

Copilot resumes working after tool decisions only when native inspection sees
all observed approval requests completed with matching request/tool IDs and a
subsequent assistant turn starting. A single tool result cannot clear another
pending approval. Unknown or incomplete approval records leave hooks authoritative.
This transition uses the same producer, profile, cursor and revision checks as
native terminal-outcome reconciliation.

### State transactions and host reattachment

- Snapshot collection/publication, Forget, rename, End, relocation, binding changes
  and recovery share one endpoint-scoped transaction. Nested synchronous calls
  participate in their caller's transaction. Publication order is monotonic even
  if the wall clock moves backward; background snapshots cannot resurrect a
  forgotten record or overwrite a completed relocation with an older read.
- Agent binding includes its non-secret profile selectors. Owned launches pass
  the selected profile to the tmux session even when its server already exists;
  resume uses the saved profile. A hook captures selectors from the verified
  producer environment. Unknown external profile identity remains explicit;
  host environment alone is not proof of the producer's profile.
- Unknown or legacy agent profiles block automatic recovery. The user can select
  the stopped conversation's profile with Choose Recovery Profile or
  `berth recovery-profile <session> --root <directory>` (`--current` explicitly
  selects the invoking environment). This records only directory selectors,
  never credentials. Titles and hook checks/installations use that same profile.
  Gemini records `GEMINI_CLI_HOME` when set. It selects a home directory, so
  Gemini settings live in its `.gemini` child. Choosing a Gemini recovery root
  selects the `.gemini` folder and stores its parent as `GEMINI_CLI_HOME`.
- Launch/resume also refreshes PATH and the Berth configuration/state routing for
  hook children. These runtime values are separate from persisted agent identity.
- Host attachment preserves the complete tmux endpoint, including socket-path
  precedence. A successful rebuild and its attach command address the same server.
- iTerm reattachment requires positive evidence of a ready shell prompt and the
  unchanged marked pane after restoration. A busy shell, editor or agent receives
  no injected text. Uncertain readiness offers an explicit reattach action.

The iTerm readiness check uses [prompt state](https://iterm2.com/python-api/prompt.html)
and an [API transaction](https://iterm2.com/python-api/transaction.html) to keep
verification and sending input atomic (checked 2026-11-01). It requires shell
integration, an empty editing prompt and a stable prompt ID; unsupported or busy
panes remain untouched and receive a deferred-reattachment message in the script log.

### 5.3 Snapshot

- Location: `$XDG_STATE_HOME/berth/servers/<socket identity>/snapshots/<UTC timestamp>/`
  (default `~/.local/state/berth/…`). State is kept per tmux server, so one
  server's snapshots never restore into another. The root is overridable in
  config; servers stay separate under it. The conventional system tmux directory
  retains its default/named keys for compatibility. Other socket directories use
  a canonical full-endpoint hash; `-L` and equivalent `-S` resolve identically.
  Ambiguous legacy basename-only state for custom endpoints is not automatically
  imported; explicit restore remains available after the user verifies its source. Diagnose Problems
  reports the legacy location so it is not silently mistaken for an empty history.
- Contents:
  - `sessions.json` — one entry per managed session: name, cwd, agent, argv,
    conversation id, origin, and the tmux server lifetime it was seen in
    (server start time and pid).
  - `scrollback/<name>.txt` — last N lines of each pane (default 3000), for
    reading only. Every accepted session name is an opaque data key, including
    names that match object prototype properties; snapshot capture and carry-forward
    must preserve their scrollback without special treatment. Missing scrollback
    may be omitted. Other read failures must abort carry-forward and recovery
    configuration edits before publishing or pruning snapshots; they must not
    become empty output.
- Triggers: `berth snapshot`; tmux hooks on session created / renamed / closed
  (installed by `berth tmux install`, which also hooks `alert-bell`, §4.2,
  and `client-attached` / `client-session-changed`, §7.3).
- Creating or renaming a session takes a change snapshot inside its
  transaction: it records every managed session as a full snapshot does, but
  runs no discovery and keeps the scrollback the newest snapshot saved for each
  live session with the same identity (tmux session id and server lifetime),
  under any name; only the created session, or a session with no saved
  scrollback, is captured. Saved scrollback is therefore never older than
  before the change; the next full snapshot refreshes it.
- A snapshot also carries forward the sessions still waiting to be restored:
  sessions in the previous snapshot that were seen in an earlier tmux server,
  are not live now, and were not forgotten. A server that ends (reboot, crash)
  fires no hook, so without this the first session started after a reboot
  would snapshot a world without the others and they would never come back.
  A session missing from the same server ended on purpose (the agent exited,
  it was killed) and is dropped, also across a rename. `berth forget
  <session>` (VS Code: *Forget Session…* on a stopped row) gives one up.
- Retention: newest K snapshots (default 5).
- Snapshots contain conversation text and are never meant for version control.

### 5.4 Restore

- `ensure` reads live tmux first; if a managed session is missing, it rebuilds
  from the newest snapshot. After a reboot there is no tmux server, so the
  snapshot is the only source.
- A rebuilt agent session requires an exact conversation ID and a resume
  template. Missing IDs, missing directories, missing executables and binding
  conflicts produce distinct skipped results. No failure silently starts a new
  conversation or substitutes a shell. Shell sessions reopen in their cwd.
  Creating or restoring a plain shell explicitly replaces the staging process
  with tmux's configured default shell; an omitted respawn command would repeat
  the staging process and is not a successful launch.
- Issuing the resume command is `resume-requested`, not confirmation. A guarded
  start hook for the exact expected ID confirms recovery and restores normal
  pane exit behavior. A different ID reports
  failed recovery and preserves the expected ID. A process that exits before confirmation leaves
  its pane and diagnostic output available and reports failure.
- Without a matching acknowledgement within 30 seconds, recovery is unconfirmed:
  inspect the terminal before relying on it. Agents without start hooks begin
  unconfirmed. A later matching hook can still confirm. Recovery status and
  reason survive snapshots; a live tmux session is not proof of conversation
  recovery. The agent starts only after its expected identity is registered.
- An intentional End removes the restore record even when it ends the last
  session and tmux shuts down. Detach only closes the local terminal view.
  Start New is explicit; an unbound stopped record is forgotten before its name
  is reused. Retry Recovery explicitly ends a failed or unconfirmed attempt
  and reissues the same bound ID under the restore lock. Preflight failure
  preserves the inspectable pane. Requested or confirmed attempts reject a
  concurrent retry; stopped records follow normal ensure rules.
- A stopped record offers Choose Recovery Folder. Selecting an existing folder
  updates only that record's cwd; its agent and exact conversation ID remain.
  Cancellation changes nothing. The host can then request recovery through the
  normal guarded open action. A running session cannot be relocated this way.
- `--origin` limits work to one frontend's sessions.

### 5.5 Configuration

`$XDG_CONFIG_HOME/berth/config.toml`. Keys: tmux binary and socket (default:
the user's default server, so existing sessions are visible), snapshot root,
scrollback lines, retention, agent templates. Everything has a default;
Berth runs with no config file.

## 6. Berth for VS Code

- **Layout profile.** *Use Berth Layout* enables the supplied Berth layout.
  If its Profile is absent, Berth prepares the Profile, layout settings and its
  extension automatically before switching the current window. If already
  prepared, reuse it. Do not open Create Profile, import review, a name field,
  or a profile picker as part of this first-use action. User-created Profiles
  are managed separately through VS Code; they are not part of Berth onboarding.
  The preset places sessions on the left and Explorer on the right, locks
  terminal editor groups and uses session titles/progress in terminal tabs.
  The optional `berth.layout.hideTerminalTabs` controls the preset's terminal tabs.
  Preserve the exact current folder or multi-root/untitled workspace. VS Code
  owns dirty-editor save prompts and reload. Do not open an unrelated window
  or replace a multi-root workspace with its first folder.
  Preparation may continue across the native window reload in an owned helper.
  The same window may temporarily be empty during preparation; restore the
  exact saved workspace automatically before reporting completion.
  VS Code alone creates and registers the destination Profile. The helper reads
  the native registry to locate that new destination; it never writes the registry.
  It writes the preset only to the new, otherwise empty settings resource and
  installs a local snapshot of the running extension with the native CLI. No
  Marketplace download, import review or extra foreground window is required.
  The destination must acknowledge loading its settings before preparation is
  complete. Restore the saved workspace only during first preparation, never
  redirect later windows that intentionally use the prepared Profile elsewhere.
  Existing settings and same-name collisions are never overwritten. Profile settings
  accept VS Code JSONC comments and trailing commas; identity checks read them
  without rewriting user formatting. Malformed settings stop preparation. Record the
  Profile ID and preparation token, not just its display name; retries reuse the
  same unfinished destination. Version or storage-layout incompatibility must
  stop before switching rather than start manual setup.
  Profile preparation must preserve the source Profile, shared settings,
  workspace overrides and all existing user-created Profiles. Do not overwrite
  an existing same-named Profile merely because its name matches. Failed or
  interrupted preparation must be recoverable without duplicate Profiles;
  do not report activation until the prepared layout is actually active.
  An unsupported host reports the specific limitation and leaves the current
  layout intact; redirecting the user to manual creation does not satisfy Use.
  *Switch Layout Profile* is a separate optional action opening VS Code's native
  picker. It is not the implementation of first-use setup. VS Code owns Profile
  identity and workspace association. Shared extension storage is not proof of
  the current or original Profile. Keep `berth.applyLayout` and
  `berth.revertLayout` command IDs for existing shortcuts.
  Legacy layout journals are read-only evidence. Do not auto-restore or delete
  them, and do not make their inspection a mandatory onboarding step. Switching
  profiles does not undo changes made by the retired in-place Apply operation.
  On first activation in a trusted local window, offer Use Berth Layout and
  Keep Current Layout without requiring the sessions view to be opened.
  Explain that the optional layout uses a separate VS Code Profile with its
  settings and extensions. Do not change layout until Use is chosen. Persist
  Keep Current Layout as an explicit opt-out. Use does not suppress future
  onboarding until the managed Profile is active; failed preparation remains
  eligible after reload. Old acknowledgement booleans cannot distinguish a
  failed Use from Keep and are not treated as a verified opt-out. Dismissal retains
  the current layout for this activation and may be offered next activation;
  never prompt twice in one activation. The old pre-display seen flag is not
  acknowledgement. Existing legacy-layout users need not receive the prompt.
  The sessions title overflow permanently exposes Use Berth Layout and Switch
  Layout Profile in a separate group. Native bootstrap acceptance is tracked
  in [iterations](iterations.md).
  [VS Code Profiles](https://code.visualstudio.com/docs/configure/profiles) are
  distinct from terminal shell profiles and agent conversation profiles.
- **Session view.** The rich session list, contributed as a webview view so
  the user can place it in any side bar. VS Code's native tree has one line
  per row, a fixed hover delay and no way to wrap; a session needs a second
  line, so the view draws cards itself. Everything it can take from VS Code
  it takes (see *Looking native* below).
  - **Content.** Every session from `berth ls`, grouped by cwd. What a card
    carries follows the vertical tabs of agent terminal apps (cmux, Warp):
    agent; state (`@berth_state`) with the latest notification; unread;
    topic; git branch; live connections (this window / application name / other
    terminal / detached / stopped — in snapshot, not live); conversation bound or not; hooks.
  - **Card.** Line one: the agent's sourced product mark (a
    terminal icon for a shell or an unrecognised agent), the session name, and a state badge on the
    right (working activity glyph, waiting `!`, unread `•`). Line two, the subtitle: the
    latest notification while waiting or done (what the agent needs from the
    user), otherwise the topic — the first line of the user's latest prompt
    (§4.2 hooks), then the exact-bound conversation title when no task text is
    available, then the ephemeral visible-terminal prompt preview. Duplicate
name/title/task text is suppressed. Cards use at most
    two lines, with no reserved empty line. Connection markers stay on the
    first line's far-right edge, after state/unread markers; their position never
    depends on the subtitle. `berth.view.details` controls these muted markers
    and defaults to on. The second line contains only task or notification
    text and disappears when empty. The subtitle has a 3px top gap, 18px line
    height and 5px bottom padding; single-line cards retain their compact spacing.
    Connection and activity metadata use icons
    only at every width. Application names and status words appear only in hover
    details and accessible labels. Multiple connections use a muted stacked-outline
    mark behind the host glyph; exact connections and counts belong in hover,
    not numeric badges in the row.
    The fixed-width activity slot sits immediately left of the host slot and
    remains reserved while idle. The multiple-connection outline stays inside
    the host slot, so connection changes, hover and subtitles cannot displace
    either icon slot. The outline denotes multiple connections; the bottom-right
    dot denotes this-window membership. This-window membership
    uses the same host product icon as any connection in that application,
    with a small corner dot denoting this-window membership. Host marks occupy
    a fixed 16px slot; VS Code artwork is optically sized to 14px and centered.
    The membership dot is 4px with a 1px background-matched border, contained
    inside the slot. Review the combined silhouette on normal, selected and
    hover backgrounds; equal asset dimensions do not imply equal visual weight. The dot does not
    indicate selection, active terminal or unread activity. Hover and accessible
    labels include both the application and “This window”. Known hosts use their
    official transparent product mark when a reviewed distributable asset is
    available (VS Code); otherwise use the verified installed application's
    original artwork. Never crop app tiles, invert brand colors or invent
    product identities. Unknown hosts or unavailable artwork use the generic
    terminal glyph while retaining verified membership. Bundled marks work
    offline on every platform; native extraction remains asynchronous and bounded.
    List and hover share the same resolved host asset. Detached uses a disconnected-terminal icon, stopped uses a stop icon.
    Running uses a 12px arrowless Codicons loading ring in the fixed 16px activity slot,
    matching the hover chip. Primary agent identities remain 16px. The ring stays
    static under either editor or OS reduced-motion settings. Refresh/sync arrows
    remain action glyphs, not activity indicators. Waiting and unread retain their distinct
    attention markers. List and hover use the same connection glyphs.
    Selection, active terminal and window membership remain distinct. Recovery
    limitations appear in relevant recovery details, never an extra list line.
    The shared Git branch appears once beside the folder heading (in the native
    view description when one workspace folder is flattened),
    with a Git branch icon. Its accessible label and hover details identify it
    as the current worktree branch, with the full value available for copying.
    It does not describe a session's historical branch. Long text ends in an
    ellipsis; the hover card has it in full.
  - **Entry and recovery.** The empty list has a keyboard-accessible New
    Session action. Refresh errors appear in the view with a Retry action;
    retained rows are explicitly labelled as the last successful list.
    Opening a session reports failures through the host notification instead
    of leaving an unhandled operation. Successful refresh clears its error.
  - **Icons.** List and details use the same agent asset mapping. Product identity takes precedence over vendor identity: use the specific CLI
    or coding product mark, not a company or sibling chat-product logo. Prefer
    official assets; a documented third-party rendering is allowed when a
    suitable official product asset is unavailable. Preserve official artwork
    and colours; monochrome assets use the theme foreground. The accessible session name includes the agent
    name; details also show it as text. Asset origins, pinned revisions and
    licenses are recorded in the extension third-party notices. Functional
    icons remain Codicons; modifiers such as `~spin` map to the web font
    modifier classes and respect reduced motion.
  - **Order.** Sessions within each folder, and unmanaged sessions, use natural
    name order: `job`, `job-2`, `job-3`, `job-10`, `job-13`. Live and restored
    entries follow the same order. Attention navigation uses that ordering
    within each priority (waiting first, then unread).
  - **Attention hierarchy.** Waiting uses an amber exclamation marker, name and
    actionable note on the second line when available. An unread finished turn
    uses a blue, normal-weight title and a 12px blue filled-circle check in the
    fixed 16px activity slot. Selected titles use the theme's selection foreground;
    the check retains the completion cue. Supporting text has stronger contrast
    than an ordinary subtitle. Reading clears both unread title colour and check.
    Working restores the normal title colour and uses a muted 12px spinner in the
    same slot. Waiting, working and unread marks are mutually exclusive.
    A new working turn suppresses previous unread styling in the row, hover chip
    and collapsed group while retaining the read marker internally. Activity and
    unread decoration must never be drawn on the same glyph.
    Collapsed groups use the same waiting/unread markers. No full-row attention
    tint or flashing is used; selection and active-terminal styling stay distinct.
    Stopped cards are dimmed; other content keeps the default colours. A finished turn is unread until the user has seen it and
    then looks idle, since it is the normal resting state; a new state
    replaces the notification, so a finished card never shows an old
    permission request. *Mark as Read* clears unread without opening the
    session.
  - **Groups.** A group header shows the folder's name with an icon for its
    place: this window's workspace folder, inside it, or outside it (the
    words are in its hover), ordered in that order. When the only group is
    the workspace folder its cards sit at the top level and the view's title
    shows the folder. A collapsed group shows its most urgent session
    (waiting, else unread) with the same badge and colour.
  - **Activity time.** Keep timestamps out of the default session rows and retain
    natural ordering. Hover may show the current turn start, current waiting
    duration and completion time, with relative time plus local date/time and a
    copyable ISO timestamp. Use validated lifecycle-hook receipt times or exact-bound
    native event timestamps; never polling, file mtime, terminal output or inferred
    idle time. Hook times represent receipt, not reconstructed historical events.
    Missing evidence stays absent. Repeated same-state hooks retain the initial
    time; an explicit user prompt resets the turn start even if already working.
    Native samples retain event time rather than observation time. New conversations,
    unknown state writes, screen-only overrides and restores cannot inherit timings.
    Future or malformed dates are omitted. Time labels refresh with normal inventory
    updates; no per-row timer or new background polling is introduced.
  - **Hover card.** After `berth.hover.delay` (default 500 ms, independent of
    `workbench.hover.delay`, which VS Code does not let an extension change
    for its own views), a card in VS Code's hover style: the session name
    with the agent's icon, the notification as a quote, then state,
    connection, branch, folder and any warning, each line led by its icon.
    Every data value in details has a small, labelled Copy action: session and
    folder names, agent name, notification/topic text, connection value, branch,
    full folder path, conversation title and exact ID. Copy uses the complete
    underlying value, without field labels or display shortening. Buttons are
    keyboard reachable, preserve the open card and report host-confirmed success
    or failure. Pending copy requests retain keyboard focus and suppress duplicate
    activation; success or failure must not move focus. State chips, guidance
    and warning prose are not data fields.
    Conversation-binding warnings apply to agent sessions, not plain shells.
    The details form a non-modal dialog: entering it never selects or opens
    the session. The pointer can cross the gap, read, scroll and select text
    without a deadline. Full paths wrap in the card. Keyboard focus on a row
    opens its details after the same delay; Tab enters the dialog, Shift+Tab
    returns to the row, and Escape closes it without reopening until the
    trigger is left and entered again. A host Escape binding dismisses details
    even when keyboard focus remains in the terminal. A close button provides
    pointer access. Closing from inside details must allow the first deliberate
    pointer re-entry onto its row, even when closing returned keyboard focus there.
    A stationary pointer exposed by the disappearing card must not reopen it.
    Focus stays on the row until the user enters details; focus is not trapped.
    The card is offset from the icon column, fits the webview width, and uses
    the available space below or above the row. Long content scrolls inside
    the card. If neither side has useful space, it fits inside the viewport
    without an arrow. Resize repositions it; list scroll, outside click,
    context menu, window blur, or removal of the source closes it. Scrolling
    inside the card preserves it. Unrelated refreshes preserve selection;
    changes to its source update the displayed details. Updates retain keyboard
    focus on the same value action and preserve scroll position. If that action
    disappears, focus returns to the details content, without activating a session.
  - **Interaction.** Click shows the session (below); right-click opens VS
    Code's own context menu with the same actions as before, plus *Mark as
    Read* and *Forget Session*; title bar actions and the view badge (count of
    sessions waiting) are VS Code's. Keyboard: up/down, Home/End, Enter to
    show, Shift+F10 or the menu key for the context menu, left/right to fold
    groups. It is announced to screen readers as a list of groups and
    sessions, each with its full state in words, never by colour alone.
  - **Updates.** The extension sends the view a new model only when something
    shown changed; the view keeps fold state and scroll position across hide
    and show without staying alive while hidden.
  - **Looking native.** Colours and fonts come only from VS Code's theme
    variables (`--vscode-*`), so light, dark and both high-contrast themes and
    colour customisations follow automatically: list hover, selection and
    focus colours, tree indent guides, hover-widget colours, badge colours.
    Settings a webview cannot see are read by the extension and pushed on
    change: `workbench.tree.indent`, `workbench.tree.renderIndentGuides`;
    reduced motion follows VS Code's own flag. Rows are at least 22 px, VS
    Code's list row height. Functional icons are VS Code's codicons; agent
    marks follow the icon contract above. Context menu,
    title actions and badge are native, not imitations.
- **Stable Editor session terminals.** Berth navigation takes over a session's
  connections in this VS Code window into a Berth-owned Editor terminal.
  Editor terminals participate in native persistence across reload and restart,
  subject to the user’s terminal persistence setting. A durable workspace owner
  token in explicit terminal creation options identifies restored Berth terminals;
  live PID ancestry determines their current session. Re-adoption never creates
  a second attachment or changes focus. Startup samples restored terminals before
  deciding whether to open a fallback session. Reuse
  requires live tmux ancestry, never a display-name match. If no owned terminal
  exists, first attach an Editor terminal and confirm its exact session and PID;
  only then detach the previously identified unowned local clients. Do not
  dispose their terminal objects or kill their shells or agent session. Failure before confirmation leaves the
  original connections intact. Revalidate each source identity and destination
  before detaching; switched or disappeared clients are not transferred.
  This handoff does not leave an extra connection or a spurious +1. Existing
  owned views and external-window/application clients remain connected, and
  genuine multiple attachments remain visible. Native terminal objects are not
  moved using active-terminal commands because those can target another Panel.
  A detached session opens in its own Editor terminal; a stopped session is
  rebuilt first. Selection never disposes another session's terminal.
  Selecting a session connected outside this window directly opens a local
  Editor attachment without a confirmation prompt; external clients stay
  connected. Unresolved local PIDs defer a new attachment only when the target
  already has live clients whose local ownership may be unknown. They must not
  block opening a detached target or focusing a verified owned view. Handoff
  still detaches only clients matched to identified local terminals; unresolved
  terminals are never disposed or assigned ownership. “Open to the Side” explicitly adds an Editor view. Startup opens
  at most one eligible session, not tabs for every background session.
- **Find a session.** A native Quick Pick searches session name, exact-bound
  conversation title and folder across live and stopped inventory. Results show
  product identity and lifecycle/recovery state. Selection uses the same guarded
  open action; cancellation leaves selection and terminals unchanged. Removed
  selections report a refresh instruction. The sidebar title exposes New Session, New Session in Folder and Search.
  Refresh, next-attention and setup remain in the overflow menu.
  Inventory loading must leave the editor responsive and the picker cancellable;
  finding a session does not wait for git branch decoration.
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
  makes tab titles use `${sequence}`, so a tab reads like "● work" and follows its session state.
- **Notifications.** Initial inventory and extension reload do not replay old
  waiting/completion events. In a focused editor, the visible active terminal
  needs no popup; other sessions waiting for input receive an editor notification.
  Finished turns use the unread marker without a foreground popup. In a background
  editor, a new waiting/completion event uses the OS channel when enabled and
  keeps an editor notification with an Open action in the originating window.
  The OS notification attracts attention and may activate the application; the
  editor action targets the exact session. Without the OS channel, use the editor
  notification alone. Helper success never removes the session action and is not
  proof of OS delivery. Foreground suppression still applies to new events.
- **Diagnose Problems.** A host-native command lists core health findings: missing
  directories/executables, missing hooks, unbound/conflicting conversations and
  unconfirmed/failed recovery. Selecting a hook finding offers that agent's
  existing installer; a session finding opens its terminal when available.
  An inspection failure is an error, not an empty healthy result. A clean
  configuration report makes no claim that every agent version was validated.
  It reports the resolved configured CLI version separately from hook-file health,
  native trust, conversation binding and recovery acknowledgement. A PATH version
  describes the configured launcher, not an already-running process. Custom
  launch/resume templates are not executed for inspection and remain unverified.
  Executable lookup skips non-executable files and directories on PATH, follows
  executable symlinks, and treats commands containing a slash as explicit paths.
  Diagnostics and invocations share this lookup. Relative commands and relative
  or empty PATH entries resolve against the session working directory, including
  recovery preflight. An explicitly empty PATH reaches the launched agent unchanged
  instead of inheriting an older tmux server PATH. Internal launch staging uses
  the known runtime path and does not require `sleep` on the agent PATH. Version probes use that directory and identify the resolved
  executable; one diagnosis runs at most eight probes and reports further
  executables as unqueried.
  Standard executables are queried once per resolved path with `--version`, a
  one-second forced timeout and 16 KiB output limit. No inference request is sent.
  The editor runs this diagnosis in a worker so slow probes do not block commands.
  Unknown versions and versions outside the tested set are informational, not
  automatic failures. Only verified incompatibility bounds prompt an update.

  Cursor builds dated before 2026-01-16 predate the documented session/prompt/stop
  lifecycle hooks. This boundary comes from its [release announcement](https://cursor.com/changelog/cli-jan-16-2026),
  checked 2026-11-01. Later dates do not certify runtime delivery. Other agents
  without a verified incompatibility bound remain explicitly unverified.
- **Missing hooks.** The first time a window sees a session whose agent has
  no hooks installed, it explains that lifecycle updates and future conversation
  binding may be unavailable. An already bound ID is retained; missing hooks
  do not mean a new conversation will be started. Offer *Install*, *Not now*
  and *Don't ask again* per agent, plus *Install Agent Hooks* in the context
  menu. The installer uses the bundled CLI and persistent host runtime described
  below, independent of a global npm installation or the shell PATH.

  Hook installation in the editor runs asynchronously with a 30-second forced
  timeout and a 1 MiB output limit. Pending installation must leave host events
  available. Requests in one extension host execute in order; runtime refresh
  and each installer invocation finish before the next request starts. Failure
  reports the installer cause and does not block later requests.
  Each hook configuration file is staged in its target directory and atomically
  replaced only after the complete write succeeds. A failed write leaves the
  previous file intact. File replacement keeps existing symlinks pointing to their resolved target;
  dangling symlinks fail without replacement. Preserve existing POSIX permission
  bits and use mode 0600 for new files. This is per-file publication, not a
  transaction across multiple configuration files or external editors.
- **Projects.** A project in the sessions view is a folder that has sessions;
  starting a session in a folder creates its group. A window works in a
  workspace, so each group shows where its folder sits: the workspace folder
  itself, inside it, or outside it — by icon and colour (the row is too narrow
  for words; the tooltip says it), in that order. When the only group is the
  workspace folder its sessions sit at the top level and the view's title
  shows the folder: a side bar is narrow, and every tree level costs
  indentation the extension cannot reduce (it follows `workbench.tree.indent`,
  and leaf rows keep the twistie column). The folder picker marks folders the
  same way. *New Session* uses the folder of the session shown in the session
  terminal, else the only workspace folder, and asks only when neither
  exists; *New Agent Session in Folder…* always asks (workspace folders,
  existing groups, or any folder); a group's *New Session Here* uses that
  group's folder.
  Editor terminal creation has one Berth toolbar entry, ordered before the
  native plus. Its two-item menu offers New Berth Session and New Berth Session
  in Folder, using the same creation commands as the sidebar. The toolbar mark
  uses a session-bubble-plus action glyph, distinct from the folded lowercase-b
  Berth brand mark used by the sidebar and extension icon. Brand replacements
  use a distinct sidebar asset URI so same-version local upgrades do not reuse
  the previous workbench icon resource. Both have explicit
  light/dark SVG variants because an external SVG cannot inherit
  the workbench's currentColor. No Berth profiles are contributed to the native
  plus dropdown, avoiding duplicate creation entries there.
  Editor and terminal tab right-click menus expose the same two commands
  directly; terminal content right-click contains no Berth creation actions.
  Stable APIs do not expose blank-tab-bar or empty-group context injection.
  A group plus retains its exact folder. Ordinary shell profiles are unchanged.
- **Custom launcher.** `berth.customLauncher`, when set, starts sessions
  instead of `berth new` (the §5.2 contract): it runs in the session terminal,
  in the chosen folder, and creates and attaches the session; Berth learns the
  session from that terminal's tmux client and adopts it unless the launcher
  stamped it, with the directory detected from the session's pane.
  Placeholders: `{agent}`, `{cwd}` (absolute folder), `{relative}` (folder
  relative to the workspace folder containing it, empty at its root) and
  `{name}` (folder name), each shell-quoted. A launcher is for agents: a plain
  shell is always started by Berth. Without `{agent}` the launcher chooses
  the agent itself (for example with its own menu in the terminal), Berth asks
  nothing, and a session the launcher did not stamp is adopted with the agent
  found running in its pane (by program name, or script name for `node <cli>`);
  if none is found it stays unmanaged. With `{agent}` Berth asks, and its list
  says which agents the launcher starts. A launcher is usually specific to
  one workspace (it may expect that workspace's layout), so it belongs in that
  workspace's settings.
- **New Session order.** `berth.newSession.order` lists agent ids shown first
  by *New Session*, in that order (for example `["shell"]` for someone who
  starts their own launcher by hand in a plain session); like the launcher it
  can differ per workspace.
- **Actions.** New session, show, open to the side, detach, rename, kill
  (with confirmation), adopt. Opening commits unread, bell and origin changes
  only after the host acknowledges attachment to the requested tmux session.
  The main and side entry points use the same rule. A failed open preserves
  these fields and reports an actionable error; creating a terminal is not
  attachment acknowledgement. Opening or focusing a terminal never disposes
  the previous terminal; only a failed newly created terminal is cleaned up.
  Rename explains the accepted characters while the name is typed and runs
  outside the editor event loop. The core validates the new name, updates tmux and immediately writes a snapshot
  before updating host references and unread keys. Snapshot failure rolls the
  tmux name back and reports failure. A collision leaves both sessions intact.
- **Startup.** Restore ownership records the verified workspace identity at
  successful attachment. A workspace key derives from its registered folder
  URIs and workspace-file URI, never from the session cwd or folder basename.
  Only sessions owned by that workspace are rebuilt automatically. Legacy
  host-only records and empty windows stay listed for explicit opening.
  One live window holds the startup claim for a workspace; duplicate windows
  can open sessions explicitly without both auto-restoring. Dead process claims
  can be replaced. The first eligible detached session in natural name order is
  shown; others remain listed. If this window already has a live session, do not
  auto-open another one. Determine presence from terminal PID ancestry and live
  tmux clients, including native-restored terminals whose creation metadata is
  unavailable. Presence does not grant Berth ownership of an unrelated terminal.
  For native-revived terminals, ownership may be recovered from the matching
  per-window owner marker in the live terminal process environment, together with
  verified PID-to-session attachment. Missing or foreign markers do not permit
  reuse as an owned terminal; never infer ownership from a title or folder.
  Terminal titles still follow tmux.
  The prepared Berth Profile enables persistent terminals and process revival
  on both application exit and window close. Upgrades fill missing values once
  in a verified prepared Profile; explicit user or workspace settings remain
  unchanged. Other Profiles are not modified. Native revival failure must not
  authorize deletion of a fallback shell: a title such as `bash` is not evidence
  of ownership. Acceptance covers window close/reopen as well as reload, checking
  terminal counts, live tmux attachment and preservation of unrelated shells.
- **Host registration.** Each editor window registers its workspace label and
  terminal PIDs in the tmux server's local state directory. Live client ancestry
  may then display the registered workspace alongside its application. Expired
  or dead registrations fall back to the application, not a guessed workspace.
  Registration is runtime evidence, distinct from durable restore ownership.
  Remote extension hosts use their remote state and process namespace.
- **Remote workspaces.** Works the same in Remote-SSH, Dev Containers and
  WSL: the extension runs on the workspace side, next to the tmux server it
  manages.
- Disabled in untrusted workspaces. Bundles the core library and calls it
  in-process for actions and in an asynchronous child for sampling; it invokes tmux only through the core. Hook installation
  also uses a bundled CLI, copied to the extension host's persistent global
  storage on activation so hook paths survive extension updates. The CLI
  runs with the host runtime (Electron in Node mode where needed), without
  requiring a global npm installation or shell PATH. Installing hooks still
  requires the user's explicit action; activation only updates the runtime.

### Installation and upgrade experience

Before inventory or session creation, check dependencies in the execution host
(local desktop, Remote-SSH, container or WSL). Run the same checks without any
existing sessions. Check the platform, actual Node runtime (core minimum 20),
configured tmux executable/version (minimum 3.0), and access to configured state,
snapshot and configuration locations. Missing directories are normal when their
nearest existing parent is writable; inaccessible paths are actionable failures.
macOS Perl availability affects recovery inspection, not basic session use.
Report `lsof` and `sqlite3` as optional capabilities: their absence limits passive
Codex conversation discovery and native state lookup, respectively. Explain the
effect in diagnostics without blocking session use or prompting at startup.

The VS Code extension uses its bundled core and editor runtime; neither a global
Berth install nor a separate PATH Node is a prerequisite. Explicit standalone-CLI
setup additionally checks PATH Node and npm. Inspect selected Agent launchers
before creation; custom scripts remain terminal-owned and are never replaced.
The built-in Shell adapter delegates an empty launch command to tmux’s default
shell. Do not treat that intentional empty command as a missing executable.
Existing hook health checks verify the recorded executable and runtime files.

tmux hooks follow the same runtime rule. Installing them from VS Code writes the
managed block with the editor runtime and the Berth-owned runtime file, so an
extension upgrade updates what the hooks run without reinstallation. On
activation the extension compares an existing managed block with the block it
would write. A block whose runtime or CLI file no longer exists runs nothing
(its failures are silenced so panes stay clean); the extension rewrites it and
says so. Diagnose Problems reports the state and offers installation or update.

Users are not expected to learn hook setup from documentation. The extension
offers missing setup when it starts to matter: once startup and its own first-run
prompts finish, for agents running in live sessions; and right after the user
creates an agent session. One notification lists the missing items — agent hooks
that are missing or unusable, and tmux hooks that are absent or run another
Berth installation — and **Set Up…** installs the selected ones. Each item is
offered at most once per activation; **Don't Ask Again** is remembered per item
(per block for another installation). A shell-only user is not prompted. The
standalone CLI is never prompted for: the extension does not need it.

Healthy startup is silent. When required dependencies are missing, offer one
Review Setup action per extension activation and defer layout onboarding until
basic setup succeeds. Dismissal never launches installers or repeats the prompt
on inventory refresh. Diagnose Problems always exposes environment results,
including checks that passed, and allows an explicit standalone-CLI check.

Repair Berth-owned runtime files using the existing atomic runtime updater.
For system software, show the resolved absolute package-manager executable, arguments and execution host
before the user chooses Install. Use an already available Homebrew, apt-get or
DNF; never install a package manager, rewrite PATH/shell files or fetch and pipe a
remote script. Run approved installation as a visible native task, let the user
handle privilege prompts, and recheck the actual executable/version after exit.
An installer exit code is not proof that the dependency is usable. Unsupported
managers, custom executable paths and user-owned launchers receive specific
instructions instead of a guessed repair. Dependency installation is the explicit
network-access exception to passive local discovery.

New installation and upgrade preserve existing windows, layout and terminals.
Agent configuration changes are limited to the hook-maintenance boundary in §9.
Inventory refresh never launches a hook-install prompt.
Missing hooks and unknown identity/profile remain in session details and explicit
Diagnose Problems / Check Recovery Readiness. Hook installation requires a user action
and reports its result once. Optional layout creation is separate from basic use.
A blocked recovery explains the exact prerequisite when requested; missing evidence
on a running session is not an immediate incident.

A producer-verified lifecycle event carrying the already-bound conversation ID may
automatically fill a missing profile from that producer's environment, record its
process identity and clear the corresponding verification warning. Preserve an
existing profile; a different ID or unverified event cannot perform this migration.
Persist the repaired record immediately so restart does not resurrect its warning.
No restart, re-adoption, fabricated event or configuration rewrite is required.

### Session row state separation

Window membership is connection metadata, never selection. List selection follows
explicit row activation and verified changes of the current terminal. A newly
active terminal selects its session row, so the background and accent marker
move together. Unrelated refreshes preserve selection; switching to a file
clears the terminal marker but retains the last selection. Selection updates do
not move keyboard focus or scroll position. Keyboard focus has its own outline. The current terminal
session has a thin accent marker, at most one per window; an active non-terminal
editor clears that marker. No marker is inferred merely from window membership.
Running-session details omit internal recovery diagnostics and check buttons.
The session context menu offers Check Recovery Readiness for deliberate diagnosis.
Stopped-session details may explain recovery blockers. It samples current binding, hooks, profile,
launch options and setup findings, then explains concrete gaps and offers the
applicable existing repair action. Checking never clears an unresolved binding or
starts/restarts an agent. A clean check permits a recovery attempt; it does not
claim a successful resume. Unknown profile or identity remains explicitly unknown. Stopped conflicted rows say “Verify
before resuming”. Failed recovery attempts remain distinct from an unverified
binding. Working/waiting/finished state remains independent of both.


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
   `client-session-changed`. Hooks pass `hook_client`, then resolve that exact
   client's current session, tty and terminal type from live tmux evidence under
   the shared lock. Generic current-client formats can refer to another client;
   client hooks need not expose a hook-session field. A vanished client is ignored.
   Terminal identification may arrive after attachment, especially in inactive tabs.
   The background hook waits at most five seconds for an empty type to resolve,
   outside the state lock, then rechecks live identity under the lock. Unknown
   types are never guessed to be iTerm2.
   When the client is iTerm2 (tmux's
   `client_termtype`), Berth writes `OSC 1337 ; SetUserVar=berthSession=<name,
   base64>` to that client's tty and stamps the session's origin `iterm2`
   (§4.1). The variable belongs to the iTerm2 pane and is saved with it.
   Clients of other terminals are left alone. Before marking a pane, changing
   origin or replaying state, the hook rechecks the client against the session
   it currently shows. A delayed event for a detached or switched client has no
   effects; current tmux client metadata determines terminal type.
2. **Reattaching.** `berth iterm2 install` writes an AutoLaunch script that
   runs when iTerm2 starts, after iTerm2 has restored its windows. For every
   pane whose `user.berthSession` is set and which is not attached to tmux,
   it runs `berth iterm2 reattach <name>`: the core rebuilds the session if it
   is missing (resuming its conversation) and prints the attach command, which
   the script sends to the pane's shell. Before restoring any pane, the adapter
   records the ttys already running tmux in this iTerm2 instance. The core checks
   these ttys against the target session's live clients and defers automatic
   attachment if one already shows that session. This prevents duplicate clients
   when stale native restoration records produce both a replacement shell and an
   orphan terminal. The startup snapshot is shared across the whole pass, so two
   restored shells can still reconnect to the same session. Manual reattachment
   remains explicit and unrestricted by this guard. Berth does not move or close
   iTerm2's orphan windows; restoring layout requires a current native save.
   The attach command is configurable
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
| Claude Code | `claude --name {name}` | `claude --resume {id}` | `SessionStart` hook (`~/.claude/settings.json`) | Help and native fixture 2.1.310 |
| Codex CLI | `codex` | `codex resume {id}` (id or session name) | `SessionStart` hook (`~/.codex/hooks.json`) | Help 0.166.0; native fixtures 0.162.1 and 0.166.0 |
| Gemini CLI | `gemini` | `gemini --resume {id}` | `SessionStart` hook (`~/.gemini/settings.json`) | Docs; native fixture 0.66.0 |
| OpenCode | `opencode` | `opencode --session {id}` | `session.created` / `session.updated` events via a plugin (`~/.config/opencode/plugins/berth.js`) | Docs; cmux; native fixture 1.19.5 |
| GitHub Copilot CLI | `copilot` | `copilot --resume={id}` | `sessionStart` hook (`~/.copilot/hooks/berth.json`) | Docs; cmux; native fixture 1.0.105 |
| Cursor CLI | `cursor-agent` | `cursor-agent --resume {id}` | `sessionStart` hook (`~/.cursor/hooks.json`) | Help 2025.09.12; lifecycle hooks added 2026-01-16; native version acceptance pending |
| Kimi Code | `kimi` | `kimi --session {id}` | `SessionStart` hook (`[[hooks]]` in `~/.kimi-code/config.toml`) | Native 0.31.1: custom-agent recovery, interruption, approval/rejection and provider failure |
| Qoder CLI | `qodercli --name {name}` | `qodercli --resume {id}` | `SessionStart` hook (`~/.qoder/settings.json`) | Help 1.0.48; docs; cmux |
| `shell` | user shell | — | — | — |

Every hook receives a JSON payload on stdin and the id is read from
`session_id`, `sessionId`, `sessionID` or `conversation_id`. The other hooks
installed per agent map prompt submitted → `working`, permission request →
`waiting`, successful turn completion → `done`; where the agent's notification event also
fires for idle reminders, only a permission notification counts.

Agent-specific limits:

- Kimi Code refuses to load its whole config on an unknown hook field or
  event, so Berth writes only `event` and `command`, as one marked block at the
  end of `config.toml`. The legacy Python Kimi CLI (`~/.kimi/config.toml`, hooks
  from 1.28) is used only when `~/.kimi-code` does not exist.
- Cursor CLI has no hook for "needs approval" in Berth's set, so its terminal
  bell still marks it `waiting`. OpenCode uses `permission.asked` and
  `permission.replied` for waiting and subsequent activity. Replies `once` and
  `always` resume work; `reject` clears activity and suppresses a following idle
  completion until a new busy/retry event. Unknown reply values leave state intact.
- OpenCode `session.status` reports working only for `busy` or `retry`.
  `session.error` clears activity without declaring completion. A following
  `session.idle` retains that failure/interruption outcome until a new busy or
  retry event starts another turn. Successful turns use `session.idle` as done.
  Plugin forwarding preserves native event order, handles subprocess/pipe errors,
  and bounds each hook process lifetime. State events require an observed root
  session identity; unknown and child identities cannot affect the main session.
- OpenCode binds from `session.created` and `session.updated`, both of which
  carry session metadata. Restoring an existing session does not create it again;
  a subsequent native update can confirm the expected ID. Until such an event,
  recovery remains unconfirmed. Process existence and stored history alone are
  insufficient acknowledgement.
- An OpenCode session spawns child sessions for subagents; the plugin ignores
  sessions with a parent on creation and update, so the conversation id stays the
  one the user resumes.

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
- Passive discovery never edits agent configuration. Configuration writes are
  limited to explicit hook installation/uninstallation and the conservative
  upgrade of an existing, unchanged legacy Berth hook installation described
  in §8. Native hook trust remains agent-owned.
- Passive discovery has no network access. User-approved dependency installation
  delegates downloads to the existing package manager; Berth reads local files
  and talks to tmux for session discovery.
- Snapshot data stays out of repositories.

### 9.1 Execution platforms

The execution host must be macOS or Linux, with tmux 3.0 or later. Windows users
run Berth in a WSL, Remote-SSH or Dev Container workspace whose extension host
is Linux. Native Windows activation must show this route before any process
inspection, hook preparation or tmux action. Browser-only execution without a
Node extension host is unsupported.

Client and execution-host capabilities are separate. Remote workspaces use
VS Code APIs for clipboard and editor notifications; do not invoke a remote
system notification helper or alter the client's Profile from the server.
Automatic Profile preparation currently applies to local macOS/Linux desktop
windows. iTerm2 integration applies only to macOS and reconnects iTerm2-owned
panes; it does not take over layouts or daily application lifecycle.

CI must build on Windows, run platform-boundary checks there, and run the core
and extension logic on Linux and macOS. Native Windows compilation does not
certify WSL. Linux headless tests do not certify desktop notifications, Remote-SSH,
or a reboot. Record those native journeys separately; mark unavailable-platform
checks unverified rather than extrapolating a pass from another OS.

References: [VS Code remote extension placement](https://code.visualstudio.com/api/advanced-topics/remote-extensions),
[tmux installation platforms](https://github.com/tmux/tmux/wiki/Installing),
[GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Reviewed 2026-11-07 for host placement, tmux prerequisites and CI runner options.

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

These are delivery areas; current acceptance and gaps are tracked in the
[iteration plan](iterations.md).

1. **Core + baseline adapters.** `ls`, `new`, `stamp`, `snapshot`, `ensure`,
   `restore` and hooks for the adapters in §8. Recovery requires a verified
   conversation and profile; an unknown identity is not replaced with a new chat.
2. **VS Code frontend.** Session view, actions, startup reopen, layout preset.
3. **iTerm2 frontend** (§7).
4. **Public distribution.** Licensed source, reviewed public history and
   versioned packages through the release workflow.

## 12. Open questions

- Whether iTerm2 keeps a pane's user variables through window restoration
  after a quit, a crash and a reboot (§7.3). This still needs native acceptance;
  any fallback must preserve iTerm2's ownership of windows and layouts rather
  than create duplicate panes.
- Which host-native features beyond the session view earn a place (for
  example a per-session changes view built on VS Code's source control), judged
  by the rule in §2.


## 13. Product completion contract

The next complete release must satisfy the install → discover/start → identify
→ open/attend → detach → recover → rename → end/forget journey described in the
[product review](product-review.md). The [iteration plan](iterations.md) records
implementation state; these requirements are the target contract, not a claim
that the current candidate already conforms.

- One managed row binds one independent agent producer to one exact conversation.
  Conflicting producers remain attachable but cannot silently overwrite or guess
  the recovery binding. Stale events do not replace current identity or state.
- A recovery request is distinct from confirmed recovery. Failure and unavailable
  confirmation remain visible with a relevant next action. Missing binding never
  silently substitutes an unrelated or newly created conversation.
- User actions commit unread, owner and persistence changes after successful
  completion. Rename updates all references; failed actions preserve prior state.
  Terminal close/detach, process termination and forgetting have distinct scopes.
- Live connections and restore ownership stay separate. Workspace names and
  restoration destinations require verified host registration; ambiguous legacy
  records do not seize an arbitrary window.
- Rows prioritize stable identity and task/attention information. Shared context
  belongs at group level. Details expose complete copyable values while keeping
  diagnostic metadata secondary. Existing host-native navigation/settings remain
  the default mechanism; one native session finder is sufficient.
- Readiness describes actual capabilities and missing prerequisites. Inspection
  remains bounded and cannot block user actions behind slow background work.
  Agent/host support claims require versioned lifecycle and recovery evidence.
- A stable-complete claim requires critical adversarial cases plus the native
  supported-host journey. Browser and stand-in checks retain their actual scope.


### Details control placement

The fixed close button has a reserved side lane for the entire scrollable
content, including value-copy buttons. Scrolling long content must never move
text or copy controls beneath Close. Narrow cards wrap values and scroll within
the viewport; they do not cover another control to preserve more text width.

### Inspection limits

The editor runs core inventory sampling in an asynchronous child process with a
single in-flight request, timeout and output limit. Branch reads are asynchronous
and bounded as well. Deadline expiry forcibly terminates the inspection child,
including one that ignores graceful termination, and releases the refresh queue.
Process ancestry lookups also have a deadline. Interactive terminal attachment
has no inspection deadline. Sampling must not occupy the extension-host event loop.
Repeated successful readiness checks do not start another full inventory when
the environment is already ready; terminal lifecycle events request the update.
A newly created session has no source terminal to take over. Its first editor
attachment skips the existing-session handoff scan and preserves any clients
that attach concurrently; opening an existing session still verifies handoff
sources before changing their connections.
Built-in creation records the requesting workspace owner in its initial core
transaction and recovery snapshot. Once attachment is verified, presentation
acknowledges the current bell and reads the resulting row without rewriting an
unchanged origin/owner or taking another full snapshot. If workspace ownership
changed while the terminal was opening, the normal ownership update still runs.
Terminal open/close events also request a separate, coalesced read of known
sessions. This read uses tmux and saved closure evidence without waiting for agent
discovery, native conversation inspection or Git branches. It updates membership
and connections, preserving previously sampled activity until full inspection
finishes; it does not emit activity notifications. Closing a terminal alone never
removes a surviving tmux session or its recovery record. Results predating a
terminal lifecycle change are discarded, and an older read cannot overwrite a
newer published result. Failed reads retain the last inventory.
A refresh samples the process table and tmux pane inventory once per operation.
Codex title lookup searches its index once for the requested bound IDs and uses
one read-only SQLite query for remaining IDs, rather than spawning a query per
row. Unchanged JSONL sources reuse derived cached title results.
Optional inspection commands have time and output limits. Failure leaves a title
unknown; it never selects a different conversation. Adapter command support,
hook acknowledgement support and live-version verification remain distinct.
