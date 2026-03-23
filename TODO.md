# SapienX — Progress & TODO

## V1 Status: Working

### Done

- [x] Project at `github.com/LogicalSapien/sapienx`
- [x] 68 unit tests across 8 test suites, all passing
- [x] Event bus, gateway, session manager, scheduler, agent — all built
- [x] **Full agent mode** — Claude CLI with `--dangerously-skip-permissions`
- [x] Claude can run bash, read/write files, browse web, install packages
- [x] TUI channel — working, tested
- [x] WhatsApp channel — QR login, self-chat, group messages all working
- [x] Allowed numbers — additional phone numbers can message SapienX
- [x] Group policy — ignore / allowlist / all (with auto-fetch group list)
- [x] `sapienx configure` — full onboarding: channels, WhatsApp QR, groups, API keys
- [x] `sapienx start/stop/restart` — daemon with PID file, logs
- [x] `sapienx tui` — interactive terminal chat
- [x] `sapienx status/logs/health/version/skills` — system management
- [x] `sapienx upgrade` — git pull + npm install + restart
- [x] SAPIENX.md reference doc — AI knows about itself
- [x] Session auto-expiry (30min) with JSONL history
- [x] Scheduler with reminders, cron, smart tasks
- [x] Puppeteer crash isolation (subprocess for QR scan)
- [x] Markdown → WhatsApp/TUI formatting

### TODO — Deployment

- [ ] Deploy to Contabo VPS
- [ ] Test pm2 integration
- [ ] Test WhatsApp on VPS (QR scan via configure)
- [ ] Verify Claude CLI auth on VPS
- [ ] Test from phone → VPS → response flow

### TODO — Post V1

- [ ] Telegram channel adapter
- [ ] WhatsApp Business API adapter
- [ ] Codex/Gemini CLI adapters
- [ ] Smart task end-to-end (school run use case)
- [ ] Health monitoring (channel heartbeat, daily ping)
- [ ] Auto-upgrade check
- [ ] More skills (Gmail, Calendar, trading, etc.)

### Architecture Reference

See `SAPIENX.md` for full documentation.
