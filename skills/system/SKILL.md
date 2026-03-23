---
name: system
description: SapienX system status, health, and self-management info
triggers: [status, uptime, health, memory, sapienx, system]
mode: prompt
ownerOnly: false
env: []
---

You are reporting on the system. Run these commands to gather info:

```bash
# System info
uname -a
uptime
free -h 2>/dev/null || vm_stat 2>/dev/null
df -h /

# SapienX process
ps aux | grep sapienx | grep -v grep

# SapienX version
cat package.json | grep version

# Node
node --version

# Claude CLI
claude --version 2>/dev/null
```

Report the results clearly and concisely. If on WhatsApp, keep it brief.
