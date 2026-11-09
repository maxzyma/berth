# Berth

Discover terminal coding agents, keep their processes running in tmux, and
manage their sessions from VS Code. Berth can resume a recorded conversation
after a restart when its identity, profile and launch options have been verified.

VS Code provides the session list and Editor terminals. The optional iTerm2
integration reconnects panes restored by iTerm2 and shows agent state on tabs;
it does not add a session sidebar or manage iTerm2 layouts.

> Status: early. The core and `berth` CLI are on npm as
> [`@berthdev/berth`](https://www.npmjs.com/package/@berthdev/berth); Berth for
> VS Code is available through the Marketplace install command below and
> [GitHub Releases](https://github.com/maxzyma/berth/releases). The spec is [design/spec.md](design/spec.md).

## Launch principle

Keep using your terminal commands and custom scripts. Berth discovers the agents
and tmux sessions they start; scripts do not need to integrate with Berth. Built-in
launch commands are optional. This boundary also applies to future extensions;
see the [core principle](design/spec.md#21-core-principle-terminal-led-launch-evidence-based-discovery).

## Install

Requires tmux ≥ 3.0 on the machine running your sessions. The VS Code extension
includes Berth and uses the editor's Node.js runtime; a global Berth install and
a separate Node.js installation are not required. The standalone CLI requires
Node.js ≥ 20 and npm for installation. macOS recovery inspection also uses the
system `/usr/bin/perl` to read launch arguments and process directories.
`lsof` and `sqlite3` enable optional Codex discovery and conversation lookup;
**Diagnose Problems** reports when they are missing.

| Where sessions run | Support |
|---|---|
| Local macOS or Linux | CLI and VS Code extension; tmux required |
| Linux/macOS over Remote-SSH, Linux container, or WSL | Install Berth and tmux in the remote execution host; native remote lifecycle acceptance is tracked separately |
| Native Windows | Use WSL, Remote-SSH or a Dev Container; the local extension provides setup guidance |

The automatic layout Profile is for local macOS/Linux desktop windows. iTerm2
integration is macOS-only. A browser-only editor cannot run the tmux backend.
See [acceptance requirements](design/manual-acceptance.md#platform-coverage) for
the distinction between automated platform checks and native host verification.

```sh
code --install-extension berthdev.berth   # VS Code Marketplace; the .vsix is also on GitHub Releases
```

The extension carries its own Berth and needs no separate CLI. When you first
create or run an agent session, it offers to install that agent's hooks and the
tmux hooks; **Diagnose Problems** offers them at any time.

The standalone CLI is optional, for using Berth from other terminals:

```sh
npm install -g @berthdev/berth
berth hooks install claude    # once per agent you use
berth tmux install            # snapshot, bell and attach hooks
berth iterm2 install          # optional: Berth for iTerm2
```

For Codex, review new or changed Berth hook definitions with `/hooks` inside
Codex. Installing the configuration does not grant hook trust.

Hooks installed from VS Code run the extension's own Berth, so extension updates
reach them. If the tmux hooks point to a removed Berth installation, the
extension repairs them on startup; if they run another installed Berth, it asks
whether to switch them to the extension's Berth.

After a reboot, VS Code restores sessions explicitly owned by its workspace;
legacy host-only records remain available for manual opening. iTerm2 reattaches
its recorded sessions, and `berth ensure` requests recovery from any terminal.
Agent recovery requires a bound conversation ID and its profile. A resume request is confirmed
only when the agent acknowledges that ID; unavailable confirmation is shown.

Choose **Use Berth Layout** in the first-run prompt or Berth **…** menu for
sessions on the left and Explorer on the right. This uses a separate VS Code
Profile, including its settings and extensions. Berth prepares the preset and
its extension automatically, then restores the current workspace after reload. **Keep Current Layout** leaves your layout unchanged.
**Switch Layout Profile…** lets you return to another profile. Automatic setup
currently targets local desktop windows with an open folder or workspace.

In VS Code, **Find a Session** searches names, conversation titles and folders.
**Diagnose Problems** checks the execution host even before any sessions exist.
Startup offers setup only when required dependencies are unavailable. Select a
failed dependency to review an installation through an existing Homebrew, apt-get
or DNF; Berth shows the command and host before running it, then checks again.
User-managed runtimes and custom executable paths are left unchanged. Use
**Check standalone CLI dependencies** to check PATH Node.js and npm separately.
Session and hook diagnostics explain recovery limits. Details let
you copy full values. Failed or unconfirmed recovery offers **Retry Recovery**;
a stopped record can use **Choose Recovery Folder** after its folder moves.
Legacy records without a profile offer **Choose Recovery Profile**, or use
`berth recovery-profile <session> --root <agent-config-directory>`.
Legacy saved options and unsupported option syntax require **Review Recovery Options**, or
`berth recovery-options <session> -- <options>`. Empty options explicitly select
agent defaults. Missing IDs or executables never silently start a different conversation.

iTerm2 automatic reattachment requires shell integration and an empty ready
prompt. Busy programs are left running. From a ready shell,
`berth iterm2 reattach <session>` prints the attachment command for manual use.

## Pieces

| Piece | What it does | Language |
|---|---|---|
| **Berth core** | Session registry, launch, conversation binding, snapshot, restore. A library plus the `berth` CLI. Knows nothing about editors. | TypeScript |
| **Berth for VS Code** | Layout preset, a list of every agent session, new / attach / kill, reopening its own sessions at startup. | TypeScript |
| **Berth for iTerm2** | Optional AutoLaunch reattachment and native tab-state integration. Uses iTerm2 window restoration; no separate session list or layout manager. | Python (generated) |

Frontends only present and reopen sessions. Every decision about sessions —
what exists, which conversation it holds, which terminal owns it — is made
in the core. Each host Berth supports gets its
own frontend, *Berth for <host>*.

## Directory layout

```
berth/
├── README.md              this file
├── AGENTS.md              entry for agents editing the repo (CLAUDE.md links here)
├── LICENSE                MIT (copied into each package)
├── tsconfig.base.json     shared TypeScript settings
├── .claude/rules/         constraints on editing the repo
├── design/
│   ├── spec.md            product and technical spec — the source of truth
│   ├── implementation.md  stack, formats, test isolation, acceptance cases
│   ├── manual-acceptance.md  steps for the cases tests cannot cover
│   └── manual-acceptance.zh-CN.md  Chinese translation
└── packages/
    ├── core/              library + `berth` CLI (npm: @berthdev/berth)
    │   ├── src/
    │   │   ├── tmux/      tmux client and the tmux.conf snapshot hooks
    │   │   ├── agents/    one adapter per agent CLI; hooks install and handling
    │   │   ├── registry/  sessions: list, new, adopt, stamp; doctor
    │   │   ├── snapshot/  write and read snapshots
    │   │   ├── restore/   ensure / restore, with locking
    │   │   ├── present/   agent state shown on attached terminal tabs
    │   │   ├── iterm2/    Berth for iTerm2: the AutoLaunch script it writes, reattach
    │   │   ├── config/    config file and data locations
    │   │   └── cli/       command-line entry
    │   └── test/          isolated tests; live/ holds the opt-in real-agent test
    └── vscode/            Berth for VS Code (bundles core)
        ├── src/           model and controller (editor-free), extension glue
        ├── media/         view container icon
        └── test/          controller tests; integration/ runs in a real VS Code
```

`docs/` (user documentation) is added when there is some to write; the spec
explains what each part owns.

## Development

Use Node ≥ 22 for development and editor integration tooling. The installed core
CLI continues to support Node ≥ 20.

```sh
npm install
npm test              # builds, then runs every test on isolated berth-test-* tmux servers
npm run test:live     # opt-in: one real Claude Code resume (BERTH_LIVE=1)
BERTH_CLAUDE_LOCAL=1 node --test packages/core/dist/test/live/claude-local.test.js  # native Claude, local model fixture
BERTH_CODEX_LOCAL=1 node --test packages/core/dist/test/live/codex-local.test.js  # native Codex, local model fixture
BERTH_KIMI_LOCAL=1 node --test packages/core/dist/test/live/kimi-local.test.js  # native Kimi, local model fixture
BERTH_OPENCODE_LOCAL=1 node --test packages/core/dist/test/live/opencode-local.test.js  # native OpenCode, local model fixture
BERTH_GEMINI_LOCAL=1 node --test packages/core/dist/test/live/gemini-local.test.js  # native Gemini, local model fixture
npm run test:vscode   # opt-in: integration tests in a real VS Code window
npm run test:webview -w berth  # background Chrome: details interaction and layout
```

Tests start their own tmux servers, so they need an environment that allows
creating Unix sockets.

The webview suite requires Google Chrome and uses synthetic sessions on a
loopback-only server. It does not open your editor or use your tmux server.
[Session details review](design/session-details-review.md) records the
interaction contract, captured evidence and remaining host checks.
[Icon review](design/icon-review.md) records product-mark sources, functional
glyph meanings and theme checks.
[Product review](design/product-review.md) covers the project purpose, complete
session journey, architecture and remaining host acceptance limits.
[Iterations](design/iterations.md) turns the review into scoped work and acceptance conditions.
[Code review](design/code-review.md) records correctness defects, reproductions and repair gates.

## Releasing

See the [release notes](packages/vscode/CHANGELOG.md) and
[current release record](design/release-0.4.6.md) for scope and outstanding gates.

Use local candidate packages during review; publish a version after its scoped
checks and release notes are complete. Retain normal published versions for
rollback and reproducible installation. Remove stale preview tags and deprecate
nonfunctional placeholders instead of deleting usable releases.

Set the same version in `packages/core` and `packages/vscode`, commit, then
push a tag `vX.Y.Z` (or `vX.Y.Z-rc.N` for a prerelease under npm's `next`).
The release workflow tests, publishes to npm through trusted publishing with
provenance, creates the GitHub release with the `.vsix`, and, for a release
that is not a prerelease, publishes the extension to the VS Code Marketplace
([implementation R5](design/implementation.md)).

## License

MIT — see [LICENSE](LICENSE).

## Support development

If Berth helps your workflow, you can [support its development on Ko-fi](https://ko-fi.com/maxzyma).
Your support helps cover development and infrastructure costs.
