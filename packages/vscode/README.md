# Berth for VS Code

Every terminal coding agent in one list, inside VS Code.

- **Sessions view**: agent sessions grouped by folder with their state
  (working, waiting for you, done), branch, and whether the conversation is
  bound; a badge counts sessions waiting for you.
- **Kept running**: sessions live in tmux, so closing a terminal, reloading or
  quitting VS Code does not stop the agent. After a reboot, Berth rebuilds
  them and resumes each agent's own conversation.
- **On your terminal tabs**: agent state appears in the native tab through
  `${progress}`; **Berth: Apply Agent Layout** sets this up.
- **Notifications** when an agent needs you or finishes.
- Works in Remote-SSH, Dev Containers and WSL.

Requires tmux on the machine where the workspace runs.
