[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/skyfallsin/pi-room)](https://github.com/skyfallsin/pi-room/stargazers)

# pi-room

Multi-agent awareness for [pi](https://github.com/badlogic/pi-mono). Agents discover peers, peek at their work, and steer them — all through tmux.

## How it works

Each pi instance auto-registers when it starts inside tmux. Registration files live in `~/.pi/room/<pane-id>.json` and are cleaned up on exit (or on next startup if a process died).

Agents automatically see who else is in the room via system prompt injection:

```
## Room
You are pane 5. 2 other agent(s) working in parallel.
Files touched by others:
- pane 12 (/Users/you/project): src/auth.ts, src/db.ts
- pane 17 (/Users/you/project): none yet
Use peek(pane) before editing shared files.
```

## Tools

### `peek`

See what another agent is doing.

- **screen mode** (default): captures tmux scrollback — what's on the agent's terminal right now
- **session mode**: reads structured conversation history from the pi session file

```
peek(pane: "12")                    # screen output from pane 12
peek(pane: "12", mode: "session")   # conversation history
peek()                              # all agents at once
peek(lines: 50)                     # more scrollback
peek(mode: "session", entries: 20)  # more history
```

### `steer`

Send a message to another agent's terminal.

If the agent is mid-task, the message is delivered after the current tool finishes (steering). If idle, it becomes a new prompt.

```
steer(pane: "12", message: "focus on the auth module, skip tests for now")
```

## Install

```bash
pi install git:github.com/skyfallsin/pi-room
```

Or clone and point to it:

```bash
git clone https://github.com/skyfallsin/pi-room ~/.pi/agent/extensions/pi-room
```

## Requirements

- [pi](https://github.com/badlogic/pi-mono)
- tmux (agents must be running inside tmux sessions)

No tmux? The extension silently no-ops — it checks for `TMUX_PANE` on startup and skips registration if missing.

## How registration works

On startup, each pi instance writes a JSON file:

```json
{
  "pane": "%5",
  "pid": 12345,
  "cwd": "/Users/you/project",
  "session": "/path/to/session.jsonl",
  "registered": "2025-01-15T10:30:00.000Z"
}
```

Stale entries (dead PIDs) are cleaned up automatically. No daemon, no server, no config.

## License

MIT

## Pi Ecosystem

| Package | Description |
|---------|-------------|
| [pi-mem](https://github.com/jo-inc/pi-mem) | Persistent markdown memory for coding agents |
| [pi-reflect](https://github.com/jo-inc/pi-reflect) | Self-improving behavioral files |
| [pi-boss](https://github.com/skyfallsin/pi-boss) | Multi-agent orchestration via tmux |
| [pi-vertex-anthropic](https://github.com/skyfallsin/pi-vertex-anthropic) | Claude via Google Cloud Vertex AI |
| [pi-skill-posthog](https://github.com/skyfallsin/pi-skill-posthog) | PostHog analytics skill for pi agents |
