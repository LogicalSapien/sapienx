# Heartbeat Checklist

This file is read each time the heartbeat cron fires.
Edit it to control what SapienX checks proactively.

## Checks
- [ ] Read today's and yesterday's daily log for context
- [ ] Any urgent matters from recent conversations?
- [ ] Review ~/.sapienx/memory/ for stale or outdated state

## Rules
- If nothing needs attention, stay silent (don't send a message)
- Only message the owner if something is actionable or time-sensitive
- Late night (23:00-08:00): only alert for urgent items
- Track what you checked in ~/.sapienx/memory/heartbeat-state.json
