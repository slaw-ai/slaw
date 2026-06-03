---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `slaw run`

One-command bootstrap and start:

```sh
pnpm slaw run
```

Does:

1. Auto-onboards if config is missing
2. Runs `slaw doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm slaw run --instance dev
```

## `slaw onboard`

Interactive first-time setup:

```sh
pnpm slaw onboard
```

If Slaw is already configured, rerunning `onboard` keeps the existing config in place. Use `slaw configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm slaw onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm slaw onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts Slaw with that setup.

## `slaw doctor`

Health checks with optional auto-repair:

```sh
pnpm slaw doctor
pnpm slaw doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration, including AWS Secrets Manager non-secret env
  config when selected
- Storage configuration
- Missing key files

## `slaw configure`

Update configuration sections:

```sh
pnpm slaw configure --section server
pnpm slaw configure --section secrets
pnpm slaw configure --section storage
```

`--section secrets` updates the deployment-level provider used as the fallback
for secrets that do not target a specific company vault. Per-company provider
vaults (named instances, default vault selection, multiple vaults per provider,
coming-soon GCP/Vault) live in the board UI under
`Company Settings → Secrets → Provider vaults` and the
`/api/companies/{companyId}/secret-provider-configs` API.

## `slaw env`

Show resolved environment configuration:

```sh
pnpm slaw env
```

This now includes bind-oriented deployment settings such as `SLAW_BIND` and `SLAW_BIND_HOST` when configured.

## `slaw allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm slaw allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.slaw/instances/default/config.json` |
| Database | `~/.slaw/instances/default/db` |
| Logs | `~/.slaw/instances/default/logs` |
| Storage | `~/.slaw/instances/default/data/storage` |
| Secrets key | `~/.slaw/instances/default/secrets/master.key` |

Override with:

```sh
SLAW_HOME=/custom/home SLAW_INSTANCE_ID=dev pnpm slaw run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm slaw run --data-dir ./tmp/slaw-dev
pnpm slaw doctor --data-dir ./tmp/slaw-dev
```
