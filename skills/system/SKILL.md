---
name: system
description: SapienX system status, health, and self-management info
triggers: [status, uptime, health, memory, sapienx, system]
mode: prompt
ownerOnly: false
env: []
---

You are reporting on SapienX system status. To get the current status, run:

```bash
sapienx status
```

Report the results clearly. Include:
- Uptime
- Active channels and their connection status
- Active sessions
- Pending scheduled tasks
- System resource usage (memory, CPU)
- Current SapienX version

If the user asks about SapienX itself, explain that it's a personal AI assistant framework that routes messages from WhatsApp and terminal to AI CLI tools.
