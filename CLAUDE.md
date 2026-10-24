# Berth — rules for agents editing this repo

- `docs/spec.md` is the source of truth. Change the spec first, then the code;
  never let them disagree.
- This repo will become public. Write nothing that only makes sense on one
  machine or in one workspace: no absolute paths, no names of other private
  repos or projects, no employer identifiers. Behaviour that came from a
  private setup is described by what it does, not where it came from.
- Berth must not depend on any directory layout. Paths come from config, the
  working directory, or XDG / platform data locations.
- Berth never edits an agent's own configuration (`~/.claude`, `~/.codex`, …)
  except through an explicit, user-run install command that can be undone.
- Code, comments, commit messages and docs are in English.
