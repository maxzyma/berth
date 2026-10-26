# Berth

A berth for every coding agent: keep terminal-based agent CLIs (Claude Code,
Codex CLI, and others) running in tmux, list them all in one place, and bring
each one back — conversation included — in the terminal it came from after an
editor restart or a reboot.

> Status: specification stage. Nothing is implemented yet. The spec is
> [design/spec.md](design/spec.md).

## Pieces

| Piece | What it does | Language |
|---|---|---|
| **Berth core** | Session registry, launch, conversation binding, snapshot, restore. A library plus the `berth` CLI. Knows nothing about editors. | TypeScript |
| **Berth for VS Code** | Layout preset, a list of every agent session, new / attach / kill, reopening its own sessions at startup. | TypeScript |
| **Berth for iTerm2** | AutoLaunch script that reopens iTerm2's own sessions at startup. Calls the CLI; holds no logic. | Python |

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
│   └── spec.md            product and technical spec — the source of truth
└── packages/
    ├── core/              library + `berth` CLI
    │   └── src/
    │       ├── tmux/      tmux client: list, create, attach, user options, hooks
    │       ├── agents/    one adapter per agent CLI (launch, resume, conversation id)
    │       ├── registry/  merge live tmux state with stamped metadata
    │       ├── snapshot/  write and read snapshots
    │       ├── restore/   ensure / restore, with locking
    │       ├── config/    config file and data locations
    │       └── cli/       command-line entry
    ├── vscode/            Berth for VS Code (depends on core)
    └── iterm2/            Berth for iTerm2 (AutoLaunch script, profile template)
```

`docs/` (user documentation) is added when there is some to write.
Planned directories exist from the start and hold a `.gitkeep` until code
lands; the spec explains what each owns.

## License

Private during development. Intended to be published under an open-source
license; see the spec's release milestone.
