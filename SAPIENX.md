# SapienX — Complete Reference Guide

This document is the single source of truth for SapienX usage, configuration, architecture, and troubleshooting. It is loaded into the AI system prompt so SapienX can answer questions about itself accurately.

## What Is SapienX

SapienX is a personal AI assistant framework. It's a Node.js daemon that:
- Receives messages from WhatsApp (text, voice, images) and a terminal TUI
- Routes them to Claude Code CLI running as a **full agent** with unrestricted OS access
- Claude can run bash commands, read/write files, browse the web, install packages, manage services
- Has scheduling, reminders, AI-powered reminder chaining, and proactive heartbeat checks
- Supports voice message transcription (via OpenAI Whisper)
- Supports image processing (Claude reads images natively)
- Delivery queue with retry and dead letter log
- Persistent memory system for cross-session context
- Editable identity files (SOUL.md, IDENTITY.md, USER.md) — no hardcoded prompts

SapienX is single-owner — only the configured owner (and allowed numbers) can issue commands.

**Key capability:** Claude runs with `--dangerously-skip-permissions`, meaning it can execute any command on the system without approval.

## Installation

### One-liner (fresh server)

```bash
curl -fsSL https://raw.githubusercontent.com/LogicalSapien/sapienx/main/scripts/setup.sh | bash
cd ~/sapienx && sapienx configure
```

The setup script installs: Node.js, Claude CLI, pm2, ffmpeg, OpenAI Whisper, and SapienX itself.

### Manual Install

```bash
git clone https://github.com/LogicalSapien/sapienx.git
cd sapienx
npm install
npm link
sapienx configure
```

### Prerequisites
- Node.js 18+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Claude auth (`claude login`)
- ffmpeg (for voice message conversion)
- OpenAI Whisper (`pip install openai-whisper`) — for voice transcription

## Data Layout

Code and user data are fully separated:

```
~/sapienx/                    ← code only (safe to git pull/upgrade)
~/.sapienx/                   ← all user data & config
├── .env                      ← configuration (owner, API keys, channels)
├── SOUL.md                   ← AI behavior, capabilities, rules
├── IDENTITY.md               ← AI name, personality, tone
├── USER.md                   ← owner profile, preferences
├── HEARTBEAT.md              ← proactive check checklist
├── .wwebjs_auth/             ← WhatsApp session
├── memory/                   ← persistent memory
│   ├── MEMORY.md             ← curated long-term memory
│   ├── CHANGELOG.md          ← system changes log
│   ├── 2026-03-23.md         ← daily log
│   ├── heartbeat-state.json  ← heartbeat tracking
│   └── *.json                ← domain-specific state
└── data/
    ├── sessions.json         ← active conversation sessions
    ├── session-history/      ← past session logs (YYYY-MM.jsonl)
    ├── schedules.json        ← active reminders & cron jobs
    ├── delivery-queue.json   ← pending message deliveries
    ├── delivery-dead.json    ← failed deliveries (dead letter)
    ├── outbox/               ← messages from CLI (sapienx message)
    ├── media-tmp/            ← downloaded WhatsApp media
    ├── sapienx.log           ← daemon logs
    └── sapienx.pid           ← daemon process ID
```

Identity files (SOUL.md, IDENTITY.md, USER.md, HEARTBEAT.md) are auto-copied from `defaults/` on first run. Edit them in `~/.sapienx/` to customize.

## CLI Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `sapienx start` | Start WhatsApp daemon in background |
| `sapienx stop` | Stop the background daemon |
| `sapienx restart` | Restart the daemon |
| `sapienx tui` | Start interactive terminal chat (foreground) |
| `sapienx configure` | Configure/reconfigure all settings |
| `sapienx status` | Show daemon, owner, WhatsApp, and CLI status |
| `sapienx version` | Show version, Node.js, Claude CLI info |
| `sapienx logs` | Show last 20 log lines |
| `sapienx logs -f` | Follow/tail daemon logs live |
| `sapienx logs -n 50` | Show last 50 log lines |

### Messaging

Send messages via the running daemon (no session conflicts):

```bash
# Send to owner (default)
sapienx message "Deploy is complete"

# Send to specific number
sapienx message "Hello!" --to "447341219431@c.us"

# Send to a group
sapienx message "Server patched" --to "120363422894951933@g.us"

# Specify channel
sapienx message "Test" --channel whatsapp --to "phone@c.us"
```

Messages are dropped into `~/.sapienx/data/outbox/` and picked up by the daemon within 2 seconds. Sent via the delivery queue with automatic retry.

### Utility Commands

| Command | Description |
|---------|-------------|
| `sapienx skills` | List all loaded skills |
| `sapienx health` | Check system health (CLI, Node, daemon) |
| `sapienx upgrade` | Pull latest code from GitHub and restart |
| `sapienx upgrade --dry-run` | Show pending changes without applying |

## In-Chat Commands

These commands work in both TUI and WhatsApp:

### Session Management

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh conversation session |
| `/session <name>` | Create or resume a named pinned session |
| `/session close` | Unpin the current session |
| `/sessions` | List all active sessions |

Sessions auto-expire after 30 minutes of inactivity. Pinned sessions never expire.

### Scheduling & Reminders

| Command | Description |
|---------|-------------|
| `/remind in 5m "message"` | Reminder in 5 minutes |
| `/remind in 2h "message"` | Reminder in 2 hours |
| `/remind at 14:30 "message"` | Reminder at specific time (24h) |
| `/remind at 2:30pm "message"` | Reminder with am/pm |
| `/remind tomorrow at 9:00 "msg"` | Reminder tomorrow |
| `/cron "0 9 * * *" command` | Recurring cron job |
| `/task list` | List all scheduled tasks |
| `/task pause <id>` | Pause a task |
| `/task resume <id>` | Resume a task |
| `/task delete <id>` | Delete a task |

**Natural language reminders:** Just ask Claude — "remind me in 10 mins to call Bob". Claude automatically embeds the command using `{{/remind ...}}` syntax.

**AI-powered reminders:** Prefix with `ai:` to trigger a full Claude CLI call when the reminder fires:
- `"Take out bins"` → sends text notification
- `"ai: Check if nginx is running and restart if down"` → triggers Claude CLI

**Reminder chaining:** The `ai:` prefix enables true chaining. Claude sets a reminder, when it fires Claude processes it and can set the next one. Example: "remind me in 5 mins, then when that fires set another for 10 mins" — Claude handles the full chain.

### Heartbeat (Proactive Checks)

| Command | Description |
|---------|-------------|
| `/heartbeat start` | Start hourly proactive checks |
| `/heartbeat start "*/30 * * * *"` | Custom schedule (every 30 min) |
| `/heartbeat stop` | Stop heartbeat |

The heartbeat fires a Claude CLI call on schedule. Claude reads `~/.sapienx/HEARTBEAT.md` for the checklist and proactively checks things (emails, calendar, weather, projects). Edit HEARTBEAT.md to customize what it checks.

### System

| Command | Description |
|---------|-------------|
| `/cli <name>` | Switch CLI adapter |
| `/model <name>` | Switch model (e.g. `/model opus`) |
| `/model auto` | Auto-select model |
| `/status` | System status |
| `/version` | Version info |
| `/help` | Show all commands |

## Voice & Media

### Voice Messages
WhatsApp voice messages are automatically transcribed using OpenAI Whisper (local, no API key needed). The transcription is passed to Claude as text.

Flow: Voice message → download → ffmpeg convert to wav → whisper transcribe → Claude processes text

### Images
Images are saved to `~/.sapienx/data/media-tmp/` and the path is passed to Claude. Claude Code can read images natively using the Read tool.

### Documents
Documents (PDF, etc.) are saved and the path is passed to Claude for processing.

### Videos
Videos are saved and referenced. Claude can't process video content but knows the file location.

## Group Chat Intelligence

SapienX has "know-when-to-speak" rules for group chats (configured in SOUL.md):

**Responds when:**
- Directly mentioned or asked a question
- Can add genuine value (info, insight, help)
- Something witty/funny fits naturally
- Correcting important misinformation

**Stays silent when:**
- Casual banter between humans
- Someone already answered
- Response would just be "yeah" or "nice"
- Conversation flowing fine without it

**Group policy** (in .env):
- `GROUP_POLICY=ignore` — drop all group messages (default)
- `GROUP_POLICY=allowlist` — only respond in `ALLOWED_GROUPS`
- `GROUP_POLICY=all` — respond in all groups

## Persistent Memory

Claude maintains context across sessions via `~/.sapienx/memory/`:

- **Daily logs:** `memory/YYYY-MM-DD.md` — raw notes of what happened each day
- **Long-term memory:** `memory/MEMORY.md` — curated learnings, distilled wisdom
- **Domain state:** `memory/*.json` — context-specific state files
- **Changelog:** `memory/CHANGELOG.md` — system/config changes
- **Heartbeat state:** `memory/heartbeat-state.json` — tracks proactive checks

Claude reads today's and yesterday's daily log at the start of each conversation. Periodically curates important items into MEMORY.md.

## Delivery Queue

All outgoing messages go through a persistent delivery queue:

- **Retry:** Failed messages retry with exponential backoff (5s, 15s, 45s, 2m, 5m)
- **Max retries:** 5 attempts before moving to dead letter
- **Persistence:** Queue survives daemon restarts (`~/.sapienx/data/delivery-queue.json`)
- **Dead letter:** Failed messages logged in `delivery-dead.json` for review

## Auth Error Detection

When Claude CLI auth expires:
- SapienX detects auth errors in CLI responses
- Sends a clear WhatsApp message: "⚠️ Claude CLI session expired. SSH in and run: claude login"
- No retry wasted on auth errors — returns immediately
- No more silent failures or cryptic error dumps

## Identity Files

SapienX's personality and behavior are fully customizable via Markdown files:

| File | Purpose |
|------|---------|
| `~/.sapienx/SOUL.md` | Core behavior, capabilities, scheduling rules, group chat intelligence |
| `~/.sapienx/IDENTITY.md` | Name, personality, tone |
| `~/.sapienx/USER.md` | Owner profile, preferences, project context |
| `~/.sapienx/HEARTBEAT.md` | Proactive check checklist |

Defaults are auto-copied from `defaults/` on first run. Edit them in `~/.sapienx/` — no code changes needed.

## Architecture

### How Messages Flow

```
User sends message (WhatsApp text/voice/image, or TUI)
  → Channel receives it
    → Voice: download → whisper transcribe → text
    → Image: save to media-tmp → reference in prompt
  → Emits message:incoming on the event bus
  → Gateway checks: owner? allowed number? group policy? self-chat?
  → If authorized, emits message:routed
  → Agent receives it:
    1. Is it a /command? → handle directly (no AI needed)
    2. Does it match a skill trigger? → run skill handler or inject prompt
    3. Otherwise → invoke Claude CLI with identity files + message
  → Claude response checked for {{embedded commands}}
    → /remind, /cron extracted and executed automatically
  → Response sent via delivery queue (with retry)
  → Channel delivers to user
```

### Event Bus

| Event | Purpose |
|-------|---------|
| `message:incoming` | Raw message from any channel |
| `message:routed` | Authorized message ready for agent |
| `message:outgoing` | Response to send (goes through delivery queue) |
| `message:delivered` | Confirmed delivery |
| `message:status` | Typing indicators |
| `schedule:reminder` | Reminder fired |
| `schedule:cron` | Cron job fired |
| `schedule:smart` | Smart task fired |
| `task:reply` | Reply received for a smart task |
| `error` | Error from any component |
| `shutdown` | Graceful shutdown signal |

### Components

| Component | File | Purpose |
|-----------|------|---------|
| Paths | `config/paths.js` | Centralized path definitions (~/.sapienx/) |
| Config | `config/sapienx.config.js` | Main configuration (loads .env) |
| Event Bus | `core/bus.js` | Central EventEmitter |
| Gateway | `core/gateway.js` | Message routing, owner filter, group policy |
| Agent | `core/agent.js` | Command handling, skill dispatch, CLI invocation, identity files |
| Session Manager | `core/session.js` | Session lifecycle, auto-expiry, history |
| Scheduler | `core/scheduler.js` | Reminders, cron jobs, smart tasks |
| Delivery Queue | `core/delivery-queue.js` | Persistent retry queue for outgoing messages |
| Transcriber | `core/transcriber.js` | Voice → text (Whisper), image/media handling |
| Claude Adapter | `cli-adapters/claude.js` | Spawns Claude CLI, parses responses, auth detection |
| WhatsApp Channel | `channels/whatsapp.js` | WhatsApp Web + typing indicator + LID support |
| TUI Channel | `channels/tui.js` | Terminal readline interface |
| Formatter | `channels/formatter.js` | Markdown → WhatsApp/TUI conversion |
| Skill Loader | `skills/loader.js` | Loads skills from SKILL.md files |

### Configuration (.env)

```
OWNER_PHONE=447341219431        # WhatsApp number, no +
OWNER_NAME=Elmo                 # Display name
CHANNELS=whatsapp,tui           # Enabled channels
ALLOWED_NUMBERS=447440076572    # Additional allowed numbers (comma-separated)
GROUP_POLICY=allowlist           # ignore | allowlist | all
ALLOWED_GROUPS=120363...@g.us   # Allowed group IDs (comma-separated)
ANTHROPIC_API_KEY=              # For Claude CLI (optional if using claude login)
OPENAI_API_KEY=                 # For Whisper API (optional — local whisper used by default)
TELEGRAM_BOT_TOKEN=             # Future use
```

## Troubleshooting

### WhatsApp not responding
1. `sapienx status` — check WhatsApp shows "configured"
2. `sapienx logs` — look for `[WhatsApp]` entries
3. Check OWNER_PHONE in `~/.sapienx/.env` (no + prefix)
4. `sapienx configure` → reset WhatsApp session → scan QR

### Claude CLI errors
1. `sapienx health` — check Claude CLI installed
2. `claude --version` to verify
3. If auth expired: `claude login`
4. Check `~/.sapienx/.env` has ANTHROPIC_API_KEY or use `claude login`

### Voice messages not transcribing
1. Check ffmpeg: `which ffmpeg`
2. Check whisper: `which whisper`
3. Install: `apt install ffmpeg && pip install openai-whisper`

### Messages not sending
1. `sapienx logs` — check for delivery queue errors
2. Check `~/.sapienx/data/delivery-queue.json` for stuck messages
3. Check `~/.sapienx/data/delivery-dead.json` for permanently failed

### Session/daemon issues
1. `sapienx status` — check if running
2. `sapienx logs` — check for errors
3. `sapienx stop && sapienx start` — restart cleanly
4. Delete stale sessions: `rm ~/.sapienx/data/sessions.json`

## Adding New Skills

Create a folder under `skills/` with:

1. `SKILL.md` with frontmatter:
```yaml
---
name: my-skill
description: What this skill does
triggers: [keyword1, keyword2]
mode: handler    # or "prompt"
ownerOnly: true
---

Instructions for the AI (used when mode is "prompt")...
```

2. Optional `handler.js` for code execution:
```js
export default async function handler(input, context) {
  const { text, config, bus, session } = context;
  return 'Result text';
}
```

Skills are auto-loaded on startup. Run `sapienx skills` to verify.

## Deployment

### Quick Deploy (one-liner)

```bash
curl -fsSL https://raw.githubusercontent.com/LogicalSapien/sapienx/main/scripts/setup.sh | bash
cd ~/sapienx && sapienx configure
sapienx start
```

### Keep Running After Reboot

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # generates auto-start command
```

### Updating

```bash
sapienx upgrade    # git pull + npm install + restart
```
