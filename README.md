# Berth

A berth for every coding agent: keep terminal-based agent CLIs (Claude Code,
Codex CLI, and others) running in tmux, list them all in one place, and bring
each one back — conversation included — in the terminal it came from after an
editor restart or a reboot.

> Status: early. The core and `berth` CLI are on npm as
> [`@berthdev/berth`](https://www.npmjs.com/package/@berthdev/berth); Berth for
> VS Code is on [GitHub Releases](https://github.com/maxzyma/berth/releases), not
> yet on the Marketplace. The spec is [design/spec.md](design/spec.md).

## Install

Requires tmux ≥ 3.0 and Node ≥ 20.

```sh
npm install -g @berthdev/berth
code --install-extension berthdev.berth   # VS Code Marketplace; the .vsix is also on GitHub Releases
```

Then, once per machine:

```sh
berth hooks install claude    # once per agent you use; Berth reminds you when one is missing
berth tmux install            # snapshot, bell and attach hooks
berth iterm2 install          # optional: Berth for iTerm2
```

After a reboot, VS Code and iTerm2 bring their own sessions back; `berth ensure`
does it from any terminal.

## Pieces

| Piece | What it does | Language |
|---|---|---|
| **Berth core** | Session registry, launch, conversation binding, snapshot, restore. A library plus the `berth` CLI. Knows nothing about editors. | TypeScript |
| **Berth for VS Code** | Layout preset, a list of every agent session, new / attach / kill, reopening its own sessions at startup. | TypeScript |
| **Berth for iTerm2** | AutoLaunch script that reopens iTerm2's own sessions at startup, written by `berth iterm2 install`. Calls the CLI; holds no logic. | Python (generated) |

Frontends only present and reopen sessions. Every decision about sessions —
what exists, which conversation it holds, which terminal owns it — is made
in the core, so frontends cannot disagree. Each host Berth supports gets its
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

```sh
npm install
npm test              # builds, then runs every test on isolated berth-test-* tmux servers
npm run test:live     # opt-in: one real Claude Code resume (BERTH_LIVE=1)
npm run test:vscode   # opt-in: integration tests in a real VS Code window
```

Tests start their own tmux servers, so they need an environment that allows
creating Unix sockets.

## Releasing

Set the same version in `packages/core` and `packages/vscode`, commit, then
push a tag `vX.Y.Z` (or `vX.Y.Z-rc.N` for a prerelease under npm's `next`).
The release workflow tests, publishes to npm through trusted publishing with
provenance, creates the GitHub release with the `.vsix`, and, for a release
that is not a prerelease, publishes the extension to the VS Code Marketplace
([implementation R5](design/implementation.md)).

## License

MIT — see [LICENSE](LICENSE).
