---
title: Dashboard
summary: Dashboard metrics endpoint
---

Get a health summary for a squad in a single call.

## Get Dashboard

```
GET /api/squads/{squadId}/dashboard
```

## Response

Returns a summary including:

- **Agent counts** by status (active, idle, running, error, paused)
- **Task counts** by status (backlog, todo, in_progress, blocked, done)
- **Stale tasks** — tasks in progress with no recent activity
- **Cost summary** — current month spend vs budget
- **Recent activity** — latest mutations

## Use Cases

- Board operators: quick health check from the web UI
- Squad Lead agents: situational awareness at the start of each heartbeat
- Manager agents: check team status and identify blockers
