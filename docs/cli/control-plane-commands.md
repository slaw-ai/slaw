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

## Squad Commands

```sh
pnpm slaw squad list
pnpm slaw squad get <squad-id>

# Export to portable folder package (writes manifest + markdown files)
pnpm slaw squad export <squad-id> --out ./exports/acme --include squad,agents

# Preview import (no writes)
pnpm slaw squad import \
  <owner>/<repo>/<path> \
  --target existing \
  --squad-id <squad-id> \
  --ref main \
  --collision rename \
  --dry-run

# Apply import
pnpm slaw squad import \
  ./exports/acme \
  --target new \
  --new-squad-name "Acme Imported" \
  --include squad,agents
```

## Agent Commands

```sh
pnpm slaw agent list
pnpm slaw agent get <agent-id>
```

## Skills Commands

```sh
# Browse app-shipped catalog skills without changing squad state
pnpm slaw skills browse [--kind bundled|optional] [--category software-development] [--query github]
pnpm slaw skills search "pull request" [--json]

# Inspect catalog metadata and file inventory before install
pnpm slaw skills inspect github-pr-workflow

# Install a catalog skill into the squad skill library
# This does not attach the skill to any agent.
pnpm slaw skills install github-pr-workflow --squad-id <squad-id>
pnpm slaw skills install github-pr-workflow --as pr-flow --force --squad-id <squad-id>

# External sources still use import instead of catalog install
pnpm slaw skills import ./skills/my-skill --squad-id <squad-id>
pnpm slaw skills import owner/repo/path/to/skill --squad-id <squad-id>

# Attach desired squad skills to an agent after install/import
pnpm slaw skills agent sync <agent-id> --skill github-pr-workflow --squad-id <squad-id>
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
