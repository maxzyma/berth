# De-identification for public contributions

Every commit and distributable artifact must be safe for public release.
History rewrites are not a substitute for checking contributions before publication.

- No absolute paths, hostnames, or user names from any machine.
- No names, paths or URLs of other private repositories or projects, and no
  employer identifiers.
- Behaviour ported from a private prototype is described by what it does,
  not by where it came from. "Proven in a private prototype" is the most
  that may be said.
- Third-party projects are cited by public name and URL. Code borrowed from
  them keeps its license notice.
- Snapshot samples, transcripts and scrollback never enter the repo, not even
  as test fixtures; fixtures are synthetic.
