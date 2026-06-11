---
title: Quickstart
summary: Get Slaw running in minutes
---

Get Slaw running locally in under 5 minutes.

## Quick Start (Recommended)

```sh
npx @slaw-ai/slaw onboard --yes
```

This walks you through setup, configures your environment, and gets Slaw running.

If you already have a Slaw install, rerunning `onboard` keeps your current config and data paths intact. Use `slaw configure` if you want to edit settings.

To start Slaw again later:

```sh
npx @slaw-ai/slaw run
```

> **Note:** If you used `npx` for setup, always use `npx @slaw-ai/slaw` to run commands. The `pnpm slaw` form only works inside a cloned copy of the Slaw repository (see Local Development below).

## Local Development

For contributors working on Slaw itself. Prerequisites: Node.js 20+ and pnpm 9+.

Clone the repository, then:

```sh
pnpm install
pnpm dev
```

This starts the API server and UI at [http://localhost:3100](http://localhost:3100).

No external database required — Slaw uses an embedded PostgreSQL instance by default.

When working from the cloned repo, you can also use:

```sh
pnpm slaw run
```

This auto-onboards if config is missing, runs health checks with auto-repair, and starts the server.

## What's Next

Once Slaw is running:

1. Create your first squad in the web UI
2. Define a squad goal
3. Create a Squad Lead agent and configure its adapter
4. Build out the org chart with more agents
5. Set budgets and assign initial tasks
6. Hit go — agents start their heartbeats and the squad runs

<Card title="Core Concepts" href="/start/core-concepts">
  Learn the key concepts behind Slaw
</Card>
