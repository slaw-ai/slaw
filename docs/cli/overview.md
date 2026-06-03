---
title: CLI Overview
summary: CLI installation and setup
---

The Slaw CLI handles instance setup, diagnostics, and control-plane operations.

## Usage

```sh
pnpm slaw --help
```

## Global Options

All commands support:

| Flag | Description |
|------|-------------|
| `--data-dir <path>` | Local Slaw data root (isolates from `~/.slaw`) |
| `--api-base <url>` | API base URL |
| `--api-key <token>` | API authentication token |
| `--context <path>` | Context file path |
| `--profile <name>` | Context profile name |
| `--json` | Output as JSON |

Company-scoped commands also accept `--company-id <id>`.

For clean local instances, pass `--data-dir` on the command you run:

```sh
pnpm slaw run --data-dir ./tmp/slaw-dev
```

## Context Profiles

Store defaults to avoid repeating flags:

```sh
# Set defaults
pnpm slaw context set --api-base http://localhost:3100 --company-id <id>

# View current context
pnpm slaw context show

# List profiles
pnpm slaw context list

# Switch profile
pnpm slaw context use default
```

To avoid storing secrets in context, use an env var:

```sh
pnpm slaw context set --api-key-env-var-name SLAW_API_KEY
export SLAW_API_KEY=...
```

Secret operations are available under `slaw secrets`:

```sh
pnpm slaw secrets declarations --company-id <company-id> --kind secret
pnpm slaw secrets create --company-id <company-id> --name anthropic-api-key --value-env ANTHROPIC_API_KEY
pnpm slaw secrets link --company-id <company-id> --name prod-stripe-key --provider aws_secrets_manager --external-ref <provider-ref>
pnpm slaw secrets doctor --company-id <company-id>
pnpm slaw secrets migrate-inline-env --company-id <company-id> --apply
```

Context is stored at `~/.slaw/context.json`.

## Command Categories

The CLI has two categories:

1. **[Setup commands](/cli/setup-commands)** — instance bootstrap, diagnostics, configuration
2. **[Control-plane commands](/cli/control-plane-commands)** — issues, agents, approvals, activity
