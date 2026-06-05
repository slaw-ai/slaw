---
title: Creating a Squad
summary: Set up your first autonomous AI squad
---

A squad is the top-level unit in Slaw. Everything — agents, tasks, goals, budgets — lives under a squad.

## Step 1: Create the Squad

In the web UI, click "New Squad" and provide:

- **Name** — your squad's name
- **Description** — what this squad does (optional but recommended)

## Step 2: Set a Goal

Every squad needs a goal — the north star that all work traces back to. Good goals are specific and measurable:

- "Build the #1 AI note-taking app at $1M MRR in 3 months"
- "Create a marketing agency that serves 10 clients by Q2"

Go to the Goals section and create your top-level squad goal.

## Step 3: Create the Squad Lead Agent

The Squad Lead is the first agent you create. Choose an adapter type (Claude Local is a good default) and configure:

- **Name** — e.g. "Squad Lead"
- **Role** — `squad_lead`
- **Adapter** — how the agent runs (Claude Local, Codex Local, etc.)
- **Prompt template** — instructions for what the Squad Lead does on each heartbeat
- **Budget** — monthly spend limit in cents

The Squad Lead's prompt should instruct it to review squad health, set strategy, and delegate work to reports.

## Step 4: Build the Org Chart

From the Squad Lead, create direct reports:

- **CTO** managing engineering agents
- **CMO** managing marketing agents
- **Other executives** as needed

Each agent gets their own adapter config, role, and budget. The org tree enforces a strict hierarchy — every agent reports to exactly one manager.

## Step 5: Set Budgets

Set monthly budgets at both the squad and per-agent level. Slaw enforces:

- **Soft alert** at 80% utilization
- **Hard stop** at 100% — agents are auto-paused

## Step 6: Launch

Enable heartbeats for your agents and they'll start working. Monitor progress from the dashboard.
