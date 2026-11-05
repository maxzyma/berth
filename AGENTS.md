# AGENTS.md

Berth discovers terminal coding agents in tmux and presents them in VS Code.
Conversation recovery requires verified identity, profile and launch options.

Hand-maintained; `CLAUDE.md` is a link to this file.

## Read before

| Task | Read |
|---|---|
| Anything | [README.md](README.md) — pieces and directory layout |
| Deciding or changing behaviour | [design/spec.md](design/spec.md) |
| Writing code or tests | [design/implementation.md](design/implementation.md) — stack, formats, test isolation, acceptance cases |
| Placing new content | [.claude/rules/carriers.md](.claude/rules/carriers.md) |
| Writing anything that will be committed | [.claude/rules/de-identification.md](.claude/rules/de-identification.md) |

## Easiest to get wrong

Each is defined in the spec; listed here because it is easy to miss.

1. Frontends hold no session logic; every decision is made in the core (spec §5–7).
2. Passive discovery does not change agent configuration. Hook installation and
   conservative legacy-hook upgrades follow the explicit boundaries in spec §9.
3. No directory layout is assumed anywhere — not in code, tests or docs (spec §9).
