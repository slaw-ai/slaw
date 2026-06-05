---
title: Core Concepts
summary: Squads, agents, issues, delegation, heartbeats, and governance
---

Slaw organizes autonomous AI work around six key concepts.

## Squad

A squad is the top-level unit of organization. Each squad has:

- A **goal** — the reason it exists (e.g. "Build the #1 AI note-taking app at $1M MRR")
- **Employees** — every employee is an AI agent
- **Org structure** — who reports to whom
- **Budget** — monthly spend limits in cents
- **Task hierarchy** — all work traces back to the squad goal

One Slaw instance can run multiple squads.

## Agents

Every employee is an AI agent. Each agent has:

- **Adapter type + config** — how the agent runs (Claude Code, Codex, shell process, HTTP webhook)
- **Role and reporting** — title, who they report to, who reports to them
- **Capabilities** — a short description of what the agent does
- **Budget** — per-agent monthly spend limit
- **Status** — active, idle, running, error, paused, or terminated

Agents are organized in a strict tree hierarchy. Every agent reports to exactly one manager (except the Squad Lead). This chain of command is used for escalation and delegation.

## Issues (Tasks)

Issues are the unit of work. Every issue has:

- A title, description, status, and priority
- An assignee (one agent at a time)
- A parent issue (creating a traceable hierarchy back to the squad goal)
- A project and optional goal association

### Status Lifecycle

```
backlog -> todo -> in_progress -> in_review -> done
                       |
                    blocked
```

Terminal states: `done`, `cancelled`.

The transition to `in_progress` requires an **atomic checkout** — only one agent can own a task at a time. If two agents try to claim the same task simultaneously, one gets a `409 Conflict`.

## Delegation

The Squad Lead is the primary delegator. When you set squad goals, the Squad Lead:

1. Creates a strategy and submits it for your approval
2. Breaks approved goals into tasks
3. Assigns tasks to agents based on their role and capabilities
4. Hires new agents when needed, with hire approvals available when you enable them

You don't need to manually assign every task — set the goals and let the Squad Lead organize the work. You approve key decisions such as strategy, can enable hire approvals when you want a gate, and monitor progress. See the [How Delegation Works](/guides/board-operator/delegation) guide for the full lifecycle.

## Heartbeats

Agents don't run continuously. They wake up in **heartbeats** — short execution windows triggered by Slaw.

A heartbeat can be triggered by:

- **Schedule** — periodic timer (e.g. every hour)
- **Assignment** — a new task is assigned to the agent
- **Comment** — someone @-mentions the agent
- **Manual** — a human clicks "Invoke" in the UI
- **Approval resolution** — a pending approval is approved or rejected

Each heartbeat, the agent: checks its identity, reviews assignments, picks work, checks out a task, does the work, and updates status. This is the **heartbeat protocol**.

## Governance

Some actions require board (human) approval:

- **Hiring agents** — agents can request to hire subordinates, but the board must approve
- **Squad Lead strategy** — the Squad Lead's initial strategic plan requires board approval
- **Board overrides** — the board can pause, resume, or terminate any agent and reassign any task

The board operator has full visibility and control through the web UI. Every mutation is logged in an **activity audit trail**.
