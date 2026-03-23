# SapienX

Personal AI assistant framework. WhatsApp + terminal interface powered by Claude Code CLI with full OS access.

## Features

- **WhatsApp & TUI** — receive messages, respond via Claude Code CLI
- **Voice messages** — auto-transcribed via OpenAI Whisper
- **Image processing** — Claude reads images natively
- **Smart scheduling** — reminders, cron jobs, AI-powered chaining
- **Heartbeat** — proactive checks (email, calendar, weather)
- **Group chat intelligence** — knows when to speak vs stay silent
- **Delivery queue** — retry with exponential backoff, dead letter log
- **Persistent memory** — daily logs, long-term memory, domain state files
- **Identity files** — editable SOUL.md, IDENTITY.md, USER.md (no hardcoded prompts)
- **Auth monitoring** — alerts on WhatsApp when Claude CLI auth expires
- **CLI messaging** — `sapienx message "text"` sends via running daemon

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/LogicalSapien/sapienx/main/scripts/setup.sh | bash
cd ~/sapienx && sapienx configure
sapienx start
```

## Commands

```bash
sapienx start          # Start background daemon (WhatsApp)
sapienx stop           # Stop daemon
sapienx restart        # Restart
sapienx tui            # Interactive terminal chat
sapienx configure      # Setup / reconfigure
sapienx status         # Check status
sapienx logs -f        # Follow logs
sapienx message "hi"   # Send message via daemon
sapienx upgrade        # Pull latest + restart
```

## In-Chat Commands

```
/remind in 5m "call Bob"       — Set reminder
/remind at 14:30 "meeting"     — Remind at time
/cron "0 9 * * 1-5" command    — Recurring task
/heartbeat start               — Proactive checks (hourly)
/task list                     — View scheduled tasks
/new                           — Fresh session
/help                          — All commands
```

Or just ask naturally — "remind me in 10 mins to check the deploy" — Claude handles it.

## Data Layout

```
~/sapienx/           ← code (safe to git pull)
~/.sapienx/          ← user data & config
├── .env             ← owner, API keys, channels
├── SOUL.md          ← AI behavior & rules
├── IDENTITY.md      ← AI personality
├── USER.md          ← owner profile
├── HEARTBEAT.md     ← proactive check list
├── memory/          ← persistent memory
└── data/            ← sessions, logs, queue
```

## Documentation

See [SAPIENX.md](SAPIENX.md) for the complete reference guide.

## License

MIT
