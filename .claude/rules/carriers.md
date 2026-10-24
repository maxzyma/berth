# Carriers: each kind of content lives in one place

Governs where content goes when editing this repo.

| Reader | Carrier | Holds |
|---|---|---|
| Anyone deciding what Berth should do | `design/` | Spec: goals, concepts, behaviour, constraints, open questions |
| Users installing and running Berth | `README.md`, later `docs/` | How to install, use, configure; no design rationale |
| Agents editing this repo | `.claude/rules/` | Constraints on editing behaviour |
| Agents arriving cold | `AGENTS.md` (`CLAUDE.md` links to it) | Routing only: what to read before which task |
| Code | `packages/<piece>/` | Implementation and tests |

- Change `design/` first, then code. If they disagree, the spec wins until it
  is changed on purpose.
- A product constraint (for example "no dependency on a directory layout") is
  stated in the spec. A rule here may point to it, never restate it.
- `docs/` is created when there is user documentation to put in it.
