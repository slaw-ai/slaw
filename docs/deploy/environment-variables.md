---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that Slaw uses for server configuration.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `SLAW_BIND` | `loopback` | Reachability preset: `loopback`, `lan`, `tailnet`, or `custom` |
| `SLAW_BIND_HOST` | (unset) | Required when `SLAW_BIND=custom` |
| `HOST` | `127.0.0.1` | Legacy host override; prefer `SLAW_BIND` for new setups |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string |
| `SLAW_HOME` | `~/.slaw` | Base directory for all Slaw data |
| `SLAW_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `SLAW_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |
| `SLAW_DEPLOYMENT_EXPOSURE` | `private` | Exposure policy when deployment mode is `authenticated` |
| `SLAW_API_URL` | (auto-derived) | Slaw API base URL. When set externally (e.g., via Kubernetes ConfigMap, load balancer, or reverse proxy), the server preserves the value instead of deriving it from the listen host and port. Useful for deployments where the public-facing URL differs from the local bind address. |

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `SLAW_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw) |
| `SLAW_SECRETS_MASTER_KEY_FILE` | `~/.slaw/.../secrets/master.key` | Path to key file |
| `SLAW_SECRETS_STRICT_MODE` | `false` | Require secret refs for sensitive env vars |

## Agent Runtime (Injected into agent processes)

These are set automatically by the server when invoking agents:

| Variable | Description |
|----------|-------------|
| `SLAW_AGENT_ID` | Agent's unique ID |
| `SLAW_SQUAD_ID` | Squad ID |
| `SLAW_API_URL` | Slaw API base URL (inherits the server-level value; see Server Configuration above) |
| `SLAW_API_KEY` | Short-lived JWT for API auth |
| `SLAW_RUN_ID` | Current heartbeat run ID |
| `SLAW_TASK_ID` | Issue that triggered this wake |
| `SLAW_WAKE_REASON` | Wake trigger reason |
| `SLAW_WAKE_COMMENT_ID` | Comment that triggered this wake |
| `SLAW_APPROVAL_ID` | Resolved approval ID |
| `SLAW_APPROVAL_STATUS` | Approval decision |
| `SLAW_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs |

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude Local adapter) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex Local adapter) |
