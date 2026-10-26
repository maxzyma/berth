# Berth

A berth for every coding agent: keep terminal-based agent CLIs (Claude Code,
Codex CLI, and others) running in tmux, list them all in one place, and bring
each one back — conversation included — in the terminal it came from after an
editor restart or a reboot.

> Status: 0.1.0, early. Core, `berth` CLI, Berth for VS Code and Berth for
> iTerm2 work and are tested; packages are on GitHub Releases, not yet on npm
> or the VS Code Marketplace. The spec is [design/spec.md](design/spec.md).

## Install

Requires tmux ≥ 3.0 and Node ≥ 20. From the
[latest release](https://github.com/maxzyma/berth/releases/latest):

```sh
npm install -g https://github.com/maxzyma/berth/releases/download/v0.1.0/berthdev-berth-0.1.0.tgz
code --install-extension berth-vscode-0.1.0.vsix   # after downloading it
```

Then, once per machine:

```sh
berth hooks install claude    # and codex: agents report conversation id and state
berth tmux install            # snapshot automatically as sessions change
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
├── .claude/rules/         constraints on editing the repo
├── design/
│   ├── spec.md            product and technical spec — the source of truth
│   └── implementation.md  stack, formats, test isolation, acceptance cases
└── packages/
    ├── core/              library + `berth` CLI (npm: @berthdev/berth)
    │   ├── src/
    │   │   ├── tmux/      tmux client and the tmux.conf snapshot hooks
    │   │   ├── agents/    one adapter per agent CLI; hooks install and handling
    │   │   ├── registry/  sessions: list, new, adopt, stamp; doctor
    │   │   ├── snapshot/  write and read snapshots
    │   │   ├── restore/   ensure / restore, with locking
    │   │   ├── present/   agent state shown on attached terminal tabs
    │   │   ├── iterm2/    Berth for iTerm2: AutoLaunch script and profiles it writes
    │   │   ├── config/    config file and data locations
    │   │   └── cli/       command-line entry
    │   └── test/          isolated tests; live/ holds the opt-in real-agent test
    └── vscode/            Berth for VS Code (bundles core)
        ├── src/           model and controller (editor-free), extension glue
        └── test/          controller tests; integration/ runs in a real VS Code
```

`docs/` (user documentation) is added when there is some to write; the spec
explains what each part owns.

## License

MIT — see [LICENSE](LICENSE).
