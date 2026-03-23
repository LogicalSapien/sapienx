# SapienX — Progress & TODO

## V1 Status: In Progress

### Done

- [x] Project scaffolded at `github.com/LogicalSapien/sapienx`
- [x] 65 unit tests across 8 test suites, all passing
- [x] Event bus (`core/bus.js`) — EventEmitter with error handling
- [x] Gateway (`core/gateway.js`) — FIFO queue, owner filter, pending reply registry
- [x] Session manager (`core/session.js`) — auto-expiry, pinning, JSONL history, retention cleanup
- [x] Scheduler (`core/scheduler.js`) — reminders, cron jobs, smart tasks
- [x] Agent (`core/agent.js`) — command handling, skill dispatch, CLI invocation, concurrency limit
- [x] CLI adapter (`cli-adapters/claude.js`) — spawns Claude CLI, parses stream-json, timeout handling
- [x] Skill system (`skills/loader.js`) — dual-mode: handler.js (fast path) + prompt-only SKILL.md
- [x] VPS skill — shell command execution with destructive keyword blocklist
- [x] System skill — prompt-only, instructs AI to report status
- [x] TUI channel — readline interface, ANSI formatting, all commands working
- [x] WhatsApp channel — QR login, session persistence, reconnection retry
- [x] SapienX CLI (`bin/sapienx`) — start, stop, tui, configure, status, logs, skills, health, version, upgrade
- [x] `sapienx configure` — interactive onboarding with inline WhatsApp QR linking
- [x] SAPIENX.md reference doc — injected into AI system prompt for self-knowledge
- [x] Setup & upgrade scripts with migration runner
- [x] Markdown → WhatsApp/TUI formatting
- [x] Session history logging (JSONL) with 6-month retention
- [x] UUID session IDs for Claude CLI compatibility
- [x] `--verbose` flag for stream-json output
- [x] Duplicate response fix (parse only `result` type)
- [x] Daemon mode with PID file, log file, proper stop command
- [x] Puppeteer crash handling during QR scan (unhandled rejection catch)

### Current Blocker

- [ ] **WhatsApp doesn't respond to messages** — library connects and authenticates, but messages sent to self-chat may not trigger `message_create` events reliably. Testing from a different phone number is the next step to isolate whether this is a self-chat issue or a broader problem.

### TODO — V1 Completion

- [ ] Fix WhatsApp message reception (test from different phone number first)
- [ ] End-to-end WhatsApp test: send message → get AI response back on WhatsApp
- [ ] Configure should clarify: owner phone vs SapienX WhatsApp number (may be different)
- [ ] Group message policy: ignore by default, allowlist option, always respond option
- [ ] Remove debug logging from gateway once WhatsApp is working
- [ ] Test `/remind` and `/cron` commands end-to-end
- [ ] Test `/vps` skill via WhatsApp
- [ ] Deploy to Contabo VPS via `scripts/setup.sh`
- [ ] Test pm2 integration on VPS

### TODO — Post V1

- [ ] Telegram channel adapter
- [ ] WhatsApp Business API adapter (fallback if whatsapp-web.js gets blocked)
- [ ] Codex CLI adapter
- [ ] Gemini CLI adapter
- [ ] Smart task end-to-end test (school run use case)
- [ ] Health monitoring (channel heartbeat, daily alive ping)
- [ ] Auto-upgrade check (daily git fetch + notify)
- [ ] Gmail, Calendar, BudgetBaker, trading skills
- [ ] Dashboard UI
- [ ] Multi-user support

### Architecture Reference

See `SAPIENX.md` for full documentation on usage, configuration, commands, and architecture.
See `docs/superpowers/specs/2026-03-22-sapienx-design.md` for the original design spec.
See `docs/superpowers/plans/2026-03-22-sapienx-implementation.md` for the implementation plan.
