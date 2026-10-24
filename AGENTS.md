# AGENTS.md

Berth keeps terminal-based coding agents running in tmux and brings each one
back, conversation included, in the terminal it came from.

Hand-maintained; `CLAUDE.md` is a link to this file.

## Read before

| Task | Read |
|---|---|
| Anything | [README.md](README.md) — pieces and directory layout |
| Deciding or changing behaviour | [design/spec.md](design/spec.md) |
| Placing new content | [.claude/rules/carriers.md](.claude/rules/carriers.md) |
| Writing anything that will be committed | [.claude/rules/de-identification.md](.claude/rules/de-identification.md) |

## Easiest to get wrong

Each is defined in the spec; listed here because it is easy to miss.

1. Frontends hold no session logic; every decision is made in the core (spec §5–7).
2. Berth never edits an agent's configuration except through
   `berth hooks install` (spec §9).
3. No directory layout is assumed anywhere — not in code, tests or docs (spec §9).
