# SapienX

Personal multi-agent AI assistant framework. Receive messages via WhatsApp or terminal, route to Claude Code CLI running as a full agent with unrestricted OS access.

## One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/LogicalSapien/sapienx/main/scripts/setup.sh | bash
```

This installs Node.js, Claude CLI, pm2, clones the repo, and runs interactive setup.

## Manual Install

```bash
git clone https://github.com/LogicalSapien/sapienx.git
cd sapienx
npm install
npm link
sapienx configure    # Interactive setup — name, WhatsApp QR, API keys
sapienx start        # Start daemon in background
```

## Commands

```bash
sapienx configure    # Setup / reconfigure
sapienx start        # Start background daemon (WhatsApp)
sapienx stop         # Stop daemon
sapienx restart      # Restart daemon
sapienx tui          # Interactive terminal chat
sapienx status       # Check status
sapienx logs         # View logs (-f to follow)
sapienx version      # Version info
sapienx upgrade      # Pull latest + restart
```

## What Can It Do?

Send a message via WhatsApp or TUI — Claude executes it with full system access:

- "check disk space" → runs `df -h`, reports results
- "restart nginx" → runs `systemctl restart nginx`
- "what's using port 3000?" → runs `lsof -i :3000`
- "search for flights to Barcelona" → browses the web
- "create a backup of /etc/nginx" → creates the backup

## Documentation

See [SAPIENX.md](SAPIENX.md) for full reference.
