# SapienX — Complete Reference Guide

This document is the single source of truth for SapienX usage, configuration, architecture, and troubleshooting. It is loaded into the AI system prompt so SapienX can answer questions about itself accurately.

## What Is SapienX

SapienX is a personal AI assistant framework. It's a Node.js daemon that:
- Receives messages from WhatsApp and a terminal TUI
- Routes them to Claude Code CLI running as a **full agent** with unrestricted OS access
- Claude can run bash commands, read/write files, browse the web, install packages, manage services
- Has a built-in skill system for fast-path operations
- Includes scheduling, reminders, and smart AI-driven tasks
- Runs on macOS (development) and Ubuntu Linux VPS (production)

SapienX is single-owner — only the configured owner (and allowed numbers) can issue commands.

**Key capability:** Claude runs with `--dangerously-skip-permissions`, meaning it can execute any command on the system without approval. This makes it a true personal assistant — ask it to check disk space, fix a config, deploy code, and it actually does it.

## Installation

### Prerequisites
- Node.js 18+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- A WhatsApp account (for WhatsApp channel)

### First-Time Setup

```bash
git clone https://github.com/LogicalSapien/sapienx.git
cd sapienx
npm install
sapienx configure    # or: npm link && sapienx configure
```

`sapienx configure` walks through:
1. **Owner name** — your display name
2. **Phone number** — WhatsApp number with country code, no + (e.g., 447341219431)
3. **Anthropic API key** — for Claude CLI (can skip if using `claude login`)
4. **Telegram bot token** — for future Telegram support (skip for now)
5. **WhatsApp session** — shows if saved, offers to reset for new QR scan
6. **Claude CLI** — checks if installed, offers to install

All settings are stored in `.env` (gitignored). Re-run `sapienx configure` anytime to change settings.

## CLI Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `sapienx tui` | Start interactive terminal chat (foreground) |
| `sapienx start` | Start WhatsApp daemon in background |
| `sapienx stop` | Stop the background daemon |
| `sapienx restart` | Restart the daemon |
| `sapienx status` | Show daemon, owner, WhatsApp, and CLI status |
| `sapienx configure` | Configure/reconfigure all settings |
| `sapienx version` | Show version, Node.js, Claude CLI info |
| `sapienx logs` | Show daemon logs |
| `sapienx logs -f` | Follow/tail daemon logs live |
| `sapienx logs -n 50` | Show last 50 log lines |

### Utility Commands

| Command | Description |
|---------|-------------|
| `sapienx skills` | List all loaded skills |
| `sapienx health` | Check system health (CLI, Node, daemon) |
| `sapienx upgrade` | Pull latest code from GitHub and restart |
| `sapienx upgrade --dry-run` | Show pending changes without applying |
| `sapienx message --channel whatsapp --to "NUMBER" "text"` | Send a message via WhatsApp |

### TUI Options

| Option | Description |
|--------|-------------|
| `sapienx tui --cli codex` | Use a specific CLI adapter |
| `sapienx tui --model opus` | Use a specific model |

## In-Chat Commands

These commands work in both TUI and WhatsApp:

### Session Management

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh conversation session |
| `/session <name>` | Create or resume a named pinned session (never auto-expires) |
| `/session close` | Unpin the current session, return to rolling sessions |
| `/sessions` | List all active sessions |

Sessions auto-expire after 30 minutes of inactivity. When a session expires, SapienX summarizes it and starts a new one. The new session gets context: "Previous conversation was about: ..."

Pinned sessions (created with `/session <name>`) never auto-expire — useful for ongoing projects.

### CLI & Model Control

| Command | Description |
|---------|-------------|
| `/cli <name>` | Switch CLI adapter for this session (e.g., `/cli codex`) |
| `/model <name>` | Switch model for this session (e.g., `/model opus`) |
| `/model auto` | Let the CLI auto-select the best model |
| `/auto` | Toggle auto-model selection |

Model/CLI changes are session-scoped — they reset when the session expires.

**Resolution order** (most specific wins):
1. In-conversation command (`/model opus`)
2. Group config (WhatsApp groups)
3. Channel config (per-channel defaults in config)
4. Adapter default (e.g., Claude defaults to sonnet)

### Scheduling & Reminders

| Command | Description |
|---------|-------------|
| `/remind in 30m "call dentist"` | One-off reminder in 30 minutes |
| `/remind in 2h "check deploy"` | Reminder in 2 hours |
| `/remind in 1d "review PR"` | Reminder in 1 day |
| `/cron "0 9 * * *" /vps df -h` | Run command daily at 9am |
| `/task list` | List all scheduled tasks |
| `/task pause <id>` | Pause a scheduled task |
| `/task resume <id>` | Resume a paused task |
| `/task delete <id>` | Delete a scheduled task |

Time units for `/remind in`: `m` (minutes), `h` (hours), `d` (days).

Cron expressions follow standard cron format: `minute hour day month weekday`

### System

| Command | Description |
|---------|-------------|
| `/status` | Show uptime, sessions, memory, CLI info |
| `/version` | Show SapienX version |
| `/vps <command>` | Run a shell command on the host system |
| `/help` | Show all available commands |
| `/quit` or `/exit` | Exit TUI (TUI only) |

### System Commands

Claude has full shell access — just ask naturally:
- "check disk space" — Claude runs `df -h` and reports
- "show running processes" — Claude runs `ps aux`
- "restart nginx" — Claude runs `systemctl restart nginx`
- "install htop" — Claude runs the appropriate package manager
- "check my SSL cert" — Claude inspects and reports
- "what's using port 3000?" — Claude runs `lsof -i :3000`

No special `/vps` command needed — Claude understands natural language and executes commands directly with `--dangerously-skip-permissions`.

## Architecture

### How Messages Flow

```
User sends message (WhatsApp or TUI)
  → Channel receives it, emits message:incoming on the event bus
  → Gateway checks: is this the owner? is this a group? is this a task reply?
  → If authorized, emits message:routed
  → Agent receives it:
    1. Is it a / command? → handle directly (no AI needed)
    2. Does it match a skill trigger? → run skill handler or inject prompt
    3. Otherwise → invoke Claude CLI with system prompt + message
  → Response comes back, emits message:outgoing
  → Channel picks it up and sends to the user
```

### Event Bus

All components communicate through a central Node.js EventEmitter. Events:

| Event | Purpose |
|-------|---------|
| `message:incoming` | Raw message from any channel |
| `message:routed` | Authorized message ready for agent |
| `message:outgoing` | Response to send back to user |
| `message:status` | Typing indicators, status updates |
| `schedule:reminder` | Reminder fired |
| `schedule:cron` | Cron job fired |
| `schedule:smart` | Smart task fired |
| `task:reply` | Reply received for a smart task |
| `error` | Error from any component |
| `shutdown` | Graceful shutdown signal |

### Components

| Component | File | Purpose |
|-----------|------|---------|
| Event Bus | `core/bus.js` | Central EventEmitter, error handling |
| Gateway | `core/gateway.js` | Message routing, owner filter, FIFO queue |
| Agent | `core/agent.js` | Command handling, skill dispatch, CLI invocation |
| Session Manager | `core/session.js` | Session lifecycle, auto-expiry, history |
| Scheduler | `core/scheduler.js` | Reminders, cron jobs, smart tasks |
| Skill Loader | `skills/loader.js` | Loads skills from SKILL.md files |
| Claude Adapter | `cli-adapters/claude.js` | Spawns Claude CLI, parses responses |
| WhatsApp Channel | `channels/whatsapp.js` | WhatsApp Web integration |
| TUI Channel | `channels/tui.js` | Terminal readline interface |
| Formatter | `channels/formatter.js` | Markdown → WhatsApp/TUI conversion |

### Skill System

Skills are folders under `skills/`. Each has:
- `SKILL.md` — frontmatter (name, description, triggers, mode) + prompt body
- `handler.js` (optional) — code that runs directly without AI

**Two modes:**
- **Handler mode:** Has a `handler.js` — runs code directly (fast, no AI cost). Example: VPS skill runs shell commands.
- **Prompt mode:** Only has `SKILL.md` — injects instructions into the AI prompt. Example: System skill tells the AI to run `sapienx status`.

Skills are matched by trigger keywords in the message text.

### Session Management

- Each channel+user combination gets a session
- Sessions auto-expire after 30 minutes of inactivity (configurable)
- On expiry: last 3 messages summarized, logged to `data/session-history/YYYY-MM.jsonl`
- New session gets: "Previous conversation was about: <summary>"
- Pinned sessions (`/session <name>`) never expire
- Session-scoped overrides (CLI, model) reset on expiry

### Smart Tasks

Smart tasks are AI-driven scheduled tasks with follow-up logic. Example: daily school run check.

Flow:
1. Task fires at scheduled time
2. AI generates and sends a message to the target
3. SapienX waits for a reply from the target
4. If no reply within the interval: re-sends (up to max retries)
5. After max retries: sends escalation alert to the owner
6. On reply: notifies the owner with the response

## Configuration

### .env File

```
OWNER_PHONE=447341219431        # WhatsApp number, no +
OWNER_NAME=Elmo                 # Display name
ANTHROPIC_API_KEY=sk-ant-...    # For Claude CLI (optional if using claude login)
TELEGRAM_BOT_TOKEN=             # Future use
```

### config/sapienx.config.js

The main configuration file. Key sections:

**Owner:** `owner.phone`, `owner.name` — from .env

**Channels:** Enable/disable channels, set per-channel CLI/model defaults.
```js
channels: {
  whatsapp: { enabled: true, cli: null, model: null },
  tui: { enabled: true, cli: 'claude', model: null },
  telegram: { enabled: false, cli: null, model: null }
}
```

**Groups:** WhatsApp group overrides (by group ID).
```js
groups: {
  "120363012345@g.us": {
    name: "Trading Group",
    enabled: true,
    cli: "claude",
    model: "haiku",
    skillsOnly: ["vps"]
  }
}
```

**CLI Adapters:**
```js
cli: {
  default: 'claude',
  maxConcurrent: 2,    // max simultaneous CLI invocations
  adapters: {
    claude: {
      model: 'sonnet',
      autoModel: false,  // when true, omit --model flag
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'WebSearch', 'WebFetch', 'Glob', 'Grep'],
      maxTurns: 5,
      outputFormat: 'stream-json'
    }
  }
}
```

**Sessions:**
```js
sessions: {
  inactivityTimeout: 30 * 60 * 1000,  // 30 minutes
  maxPinnedSessions: 5,
  summaryOnExpiry: true,
  messageBufferSize: 10,
  retentionMonths: 6
}
```

**Skills:**
```js
skills: {
  paths: ['./skills'],
  destructiveKeywords: ['rm', 'kill', 'reboot', 'shutdown', 'drop', 'mkfs', 'dd', 'format']
}
```

**VPS:**
```js
vps: {
  commandTimeout: 30000,   // 30 seconds
  maxOutputSize: 10240     // 10KB output limit
}
```

## File Structure

```
sapienx/
├── bin/sapienx              # CLI entry point
├── index.js                 # Daemon entry point
├── package.json
├── .env                     # Secrets (gitignored)
├── .env.example             # Template
├── SAPIENX.md               # This file — AI reference doc
├── core/
│   ├── bus.js               # Event bus
│   ├── gateway.js           # Message router
│   ├── agent.js             # Core brain
│   ├── session.js           # Session manager
│   └── scheduler.js         # Task scheduler
├── channels/
│   ├── base.js              # Abstract channel
│   ├── whatsapp.js          # WhatsApp adapter
│   ├── tui.js               # Terminal adapter
│   └── formatter.js         # Markdown converter
├── cli-adapters/
│   ├── base.js              # Abstract adapter
│   └── claude.js            # Claude Code CLI
├── skills/
│   ├── loader.js            # Skill scanner
│   ├── vps/                 # Shell command skill
│   │   ├── SKILL.md
│   │   └── handler.js
│   └── system/              # System status skill
│       └── SKILL.md
├── config/
│   └── sapienx.config.js    # Main config
├── data/
│   ├── sessions.json        # Live sessions (gitignored)
│   ├── schedules.json       # Scheduled tasks (gitignored)
│   ├── sapienx.log          # Daemon logs (gitignored)
│   ├── sapienx.pid          # Daemon PID (gitignored)
│   └── session-history/     # Monthly JSONL logs
└── scripts/
    ├── setup.sh             # First-run setup
    └── upgrade.sh           # Pull + install + restart
```

## Troubleshooting

### WhatsApp not responding
1. Run `sapienx status` — check if WhatsApp shows "configured"
2. Run `sapienx logs` — look for `[WhatsApp]` entries
3. Check your phone number in `.env` matches your WhatsApp number (no + prefix)
4. Try `sapienx configure` → step 3 → reset WhatsApp session → restart

### Claude CLI errors
1. Run `sapienx health` — check if Claude CLI is installed
2. Run `claude --version` to verify
3. If not authenticated: run `claude login`
4. Check `.env` has ANTHROPIC_API_KEY set (or use `claude login`)

### Session errors
1. Delete stale sessions: `rm data/sessions.json`
2. Restart: `sapienx stop && sapienx start`

### Daemon issues
1. `sapienx status` — check if running
2. `sapienx logs` — check for errors
3. `sapienx stop && sapienx start` — restart cleanly

### Port/process conflicts
1. Check for stuck processes: `ps aux | grep sapienx`
2. Kill them: `sapienx stop` or `kill <PID>`
3. Start fresh: `sapienx start`

## Deployment to VPS

### Quick Deploy

```bash
# On your Ubuntu VPS:
# 1. Install Node.js 18+ if not already installed
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# 3. Authenticate Claude (one-time)
claude login

# 4. Clone and setup SapienX
git clone https://github.com/LogicalSapien/sapienx.git
cd sapienx
npm install
npm link                      # Makes 'sapienx' command available globally

# 5. Configure (interactive — sets up .env, WhatsApp QR, etc.)
sapienx configure

# 6. Optional: Install pm2 for process management
sudo npm install -g pm2
```

### After Deployment

```bash
sapienx start                 # Start daemon (background)
sapienx status                # Check everything is running
sapienx logs                  # View logs
sapienx logs -f               # Follow logs live
```

### Updating

```bash
sapienx upgrade               # git pull + npm install + restart
# or manually:
git pull origin main
npm install
sapienx restart
```

### Keep Running After Reboot (with pm2)

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup                   # Generates auto-start command
```

## Adding New Skills

Create a folder under `skills/` with:

1. `SKILL.md` with frontmatter:
```yaml
---
name: my-skill
description: What this skill does
triggers: [keyword1, keyword2, keyword3]
mode: handler    # or "prompt"
ownerOnly: true
env: []
---

Instructions for the AI (used when mode is "prompt")...
```

2. Optional `handler.js` for code execution:
```js
export default async function handler(input, context) {
  const { text, config, bus, session } = context;
  // Do something
  return 'Result text';
}
```

Skills are auto-loaded on startup. Run `sapienx skills` to verify.
