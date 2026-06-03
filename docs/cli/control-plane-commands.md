---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
pnpm slaw issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
pnpm slaw issue get <issue-id-or-identifier>

# Create issue
pnpm slaw issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
pnpm slaw issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
pnpm slaw issue comment <issue-id> --body "..." [--reopen]

# Checkout task
pnpm slaw issue checkout <issue-id> --agent-id <agent-id>

# Release task
pnpm slaw issue release <issue-id>
```

## Company Commands

```sh
pnpm slaw company list
pnpm slaw company get <company-id>

# Export to portable folder package (writes manifest + markdown files)
pnpm slaw company export <company-id> --out ./exports/acme --include company,agents

# Preview import (no writes)
pnpm slaw company import \
  <owner>/<repo>/<path> \
  --target existing \
  --company-id <company-id> \
  --ref main \
  --collision rename \
  --dry-run

# Apply import
pnpm slaw company import \
  ./exports/acme \
  --target new \
  --new-company-name "Acme Imported" \
  --include company,agents
```

## Agent Commands

```sh
pnpm slaw agent list
pnpm slaw agent get <agent-id>
```

## Skills Commands

```sh
# Browse app-shipped catalog skills without changing company state
pnpm slaw skills browse [--kind bundled|optional] [--category software-development] [--query github]
pnpm slaw skills search "pull request" [--json]

# Inspect catalog metadata and file inventory before install
pnpm slaw skills inspect github-pr-workflow

# Install a catalog skill into the company skill library
# This does not attach the skill to any agent.
pnpm slaw skills install github-pr-workflow --company-id <company-id>
pnpm slaw skills install github-pr-workflow --as pr-flow --force --company-id <company-id>

# External sources still use import instead of catalog install
pnpm slaw skills import ./skills/my-skill --company-id <company-id>
pnpm slaw skills import owner/repo/path/to/skill --company-id <company-id>

# Attach desired company skills to an agent after install/import
pnpm slaw skills agent sync <agent-id> --skill github-pr-workflow --company-id <company-id>
```

## Approval Commands

```sh
# List approvals
pnpm slaw approval list [--status pending]

# Get approval
pnpm slaw approval get <approval-id>

# Create approval
pnpm slaw approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
pnpm slaw approval approve <approval-id> [--decision-note "..."]

# Reject
pnpm slaw approval reject <approval-id> [--decision-note "..."]

# Request revision
pnpm slaw approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
pnpm slaw approval resubmit <approval-id> [--payload '{"..."}']

# Comment
pnpm slaw approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm slaw activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
pnpm slaw dashboard get
```

## Heartbeat

```sh
pnpm slaw heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
