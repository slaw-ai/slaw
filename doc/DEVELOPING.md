# Developing

This project can run fully in local dev without setting up PostgreSQL manually.

## Deployment Modes

For mode definitions and intended CLI behavior, see `doc/DEPLOYMENT-MODES.md`.

Current implementation status:

- canonical model: `local_trusted` and `authenticated` (with `private/public` exposure)

## Prerequisites

- Node.js 20+
- pnpm 9+

## Dependency Lockfile Policy

GitHub Actions owns `pnpm-lock.yaml`.

- Do not commit `pnpm-lock.yaml` in pull requests.
- Pull request CI validates dependency resolution when manifests change.
- Pushes to `master` regenerate `pnpm-lock.yaml` with `pnpm install --lockfile-only --no-frozen-lockfile`, commit it back if needed, and then run verification with `--frozen-lockfile`.

## Start Dev

From repo root:

```sh
pnpm install
pnpm dev
```

This starts:

- API server: `http://localhost:3100`
- UI: served by the API server in dev middleware mode (same origin as API)

`pnpm dev` runs the server in watch mode and restarts on changes from workspace packages (including adapter packages). Use `pnpm dev:once` to run without file watching.

`pnpm dev:once` auto-applies pending local migrations by default before starting the dev server.

`pnpm dev` and `pnpm dev:once` are now idempotent for the current repo and instance: if the matching Slaw dev runner is already alive, Slaw reports the existing process instead of starting a duplicate.

Issue execution may also use project execution workspace policies and workspace runtime services for per-project worktrees, preview servers, and managed dev commands. Configure those through the project workspace/runtime surfaces rather than starting long-running unmanaged processes when a task needs a reusable service.

## Storybook

The board UI Storybook keeps stories and Storybook config under `ui/storybook/` so component review files stay out of the app source routes.

```sh
pnpm storybook
pnpm build-storybook
```

These run the `@slaw-ai/ui` Storybook on port `6006` and build the static output to `ui/storybook-static/`.

Inspect or stop the current repo's managed dev runner:

```sh
pnpm dev:list
pnpm dev:stop
```

`pnpm dev:once` now tracks backend-relevant file changes and pending migrations. When the current boot is stale, the board UI shows a `Restart required` banner. You can also enable guarded auto-restart in `Instance Settings > Experimental`, which waits for queued/running local agent runs to finish before restarting the dev server.

Tailscale/private-auth dev mode:

```sh
pnpm dev --bind lan
```

This runs dev as `authenticated/private` with a private-network bind preset.
On a fresh authenticated/private instance, open the app, sign in or create an
account, and use the setup screen to claim the first instance admin from the
browser. The CLI fallback remains:

```sh
pnpm slaw auth bootstrap-squad-lead
```

For Tailscale-only reachability on a detected tailnet address:

```sh
pnpm dev --bind tailnet
```

Legacy aliases still map to the old broad private-network behavior:

```sh
pnpm dev --tailscale-auth
pnpm dev --authenticated-private
```

Allow additional private hostnames (for example custom Tailscale hostnames):

```sh
pnpm slaw allowed-hostname dotta-macbook-pro
```

## Test Commands

Use the cheap local default unless you are specifically working on browser flows:

```sh
pnpm test
```

`pnpm test` runs the Vitest suite only. For interactive Vitest watch mode use:

```sh
pnpm test:watch
```

Browser suites stay separate:

```sh
pnpm test:e2e
pnpm test:release-smoke
```

These browser suites are intended for targeted local verification and CI, not the default agent/human test command.

For normal issue work, start with the smallest targeted check that proves the change. Reserve repo-wide typecheck/build/test runs for PR-ready handoff or changes broad enough that narrow checks do not cover the risk.

## One-Command Local Run

For a first-time local install, you can bootstrap and run in one command:

```sh
pnpm slaw run
```

`slaw run` does:

1. auto-onboard if config is missing
2. `slaw doctor` with repair enabled
3. starts the server when checks pass

## Docker Quickstart (No local Node install)

Build and run Slaw in Docker:

```sh
docker build -t slaw-local .
docker run --name slaw \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e SLAW_HOME=/slaw \
  -v "$(pwd)/data/docker-slaw:/slaw" \
  slaw-local
```

Or use Compose:

```sh
docker compose -f docker/docker-compose.quickstart.yml up --build
```

See `doc/DOCKER.md` for API key wiring (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) and persistence details.

## Docker For Untrusted PR Review

For a separate review-oriented container that keeps `codex`/`claude` login state in Docker volumes and checks out PRs into an isolated scratch workspace, see `doc/UNTRUSTED-PR-REVIEW.md`.

## Local Instance Layout

Every local install keeps runtime state directly under the selected instance root:

```text
~/.slaw/instances/default/                  # instance root
  config.json                                    # runtime config
  .env                                           # instance env file
  db/                                            # embedded PostgreSQL data
  data/
    storage/                                     # local_disk uploads
    backups/                                     # automatic DB backups
  logs/
  secrets/master.key                             # local_encrypted master key
  workspaces/<agent-id>/                         # default agent workspaces
  projects/                                      # project execution workspaces
  squads/<squad-id>/codex-home/             # per-squad codex_local home
```

`SLAW_HOME` and `SLAW_INSTANCE_ID` override the home root and instance id respectively. `slaw onboard` echoes the resolved values in its banner (`Local home: <home> | instance: <id> | config: <path>`) so you can confirm where state will land before continuing.

## Database in Dev (Auto-Handled)

For local development, leave `DATABASE_URL` unset.
The server will automatically use embedded PostgreSQL and persist data at:

- `~/.slaw/instances/default/db`

Override home or instance:

```sh
SLAW_HOME=/custom/path SLAW_INSTANCE_ID=dev pnpm slaw run
```

No Docker or external database is required for this mode.

## Storage in Dev (Auto-Handled)

For local development, the default storage provider is `local_disk`, which persists uploaded images/attachments at:

- `~/.slaw/instances/default/data/storage`

Configure storage provider/settings:

```sh
pnpm slaw configure --section storage
```

## Agent Artifact Uploads

When an agent generates a file that a board user or reviewer should inspect,
attach it to the issue before marking the task complete. Do not rely on a local
workspace path as the only access path.

Use the helper bundled with the Slaw skill from the repo root:

```sh
skills/slaw/scripts/slaw-upload-artifact.sh dist/demo.mp4 \
  --title "Demo video render" \
  --summary "MP4 render for board review"
```

For WebM output:

```sh
skills/slaw/scripts/slaw-upload-artifact.sh out/walkthrough.webm \
  --title "Walkthrough video" \
  --summary "WebM walkthrough render"
```

The helper uploads the file as an issue attachment, creates an artifact work
product by default, and prints markdown links for the final issue comment. See
`doc/AGENT-ARTIFACTS.md` for the full completion pattern and direct API shape.

## Default Agent Workspaces

When a local agent run has no resolved project/session workspace, Slaw falls back to an agent home workspace under the instance root:

- `~/.slaw/instances/default/workspaces/<agent-id>`

This path honors `SLAW_HOME` and `SLAW_INSTANCE_ID` in non-default setups.

For `codex_local`, Slaw also manages a per-squad Codex home under the instance root and seeds it from the shared Codex login/config home (`$CODEX_HOME` or `~/.codex`):

- `~/.slaw/instances/default/squads/<squad-id>/codex-home`

If the `codex` CLI is not installed or not on `PATH`, `codex_local` agent runs fail at execution time with a clear adapter error. Quota polling uses a short-lived `codex app-server` subprocess: when `codex` cannot be spawned, that provider reports `ok: false` in aggregated quota results and the API server keeps running (it must not exit on a missing binary).

Local adapters require their corresponding CLI/session setup on the machine running Slaw. External adapters are installed through the adapter/plugin flow and should not require hardcoded imports in `server/` or `ui/`.

## Worktree-local Instances

When developing from multiple git worktrees, do not point two Slaw servers at the same embedded PostgreSQL data directory.

Instead, create a repo-local Slaw config plus an isolated instance for the worktree:

```sh
slaw worktree init
# or create the git worktree and initialize it in one step:
pnpm slaw worktree:make slaw-pr-432
```

This command:

- writes repo-local files at `.slaw/config.json` and `.slaw/.env`
- creates an isolated instance under `~/.slaw-worktrees/instances/<worktree-id>/`
- when run inside a linked git worktree, mirrors the effective git hooks into that worktree's private git dir
- picks a free app port and embedded PostgreSQL port
- by default seeds the isolated DB in `minimal` mode from the current effective Slaw instance/config (repo-local worktree config when present, otherwise the default instance) via a logical SQL snapshot

Seed modes:

- `minimal` keeps core app state like squads, projects, issues, comments, approvals, and auth state, preserves schema for all tables, but omits row data from heavy operational history such as heartbeat runs, wake requests, activity logs, runtime services, and agent session state
- `full` makes a full logical clone of the source instance
- `--no-seed` creates an empty isolated instance

Seeded worktree instances quarantine copied live execution by default for both `minimal` and `full` seeds. During restore, Slaw disables copied agent timer heartbeats, resets copied `running` agents to `idle`, blocks and unassigns copied agent-owned `in_progress` issues, and unassigns copied agent-owned `todo`/`in_review` issues. This keeps a freshly booted worktree from starting agents for work already owned by the source instance. Pass `--preserve-live-work` only when you intentionally want the isolated worktree to resume copied assignments.

After `worktree init`, both the server and the CLI auto-load the repo-local `.slaw/.env` when run inside that worktree, so normal commands like `pnpm dev`, `slaw doctor`, and `slaw db:backup` stay scoped to the worktree instance.

`pnpm dev` now fails fast in a linked git worktree when `.slaw/.env` is missing, instead of silently booting against the default instance/port. If that happens, run `slaw worktree init` in the worktree first.

Provisioned git worktrees also pause seeded routines that still have enabled schedule triggers in the isolated worktree database by default. This prevents copied daily/cron routines from firing unexpectedly inside the new workspace instance during development without disabling webhook/API-only routines.

That repo-local env also sets:

- `SLAW_IN_WORKTREE=true`
- `SLAW_WORKTREE_NAME=<worktree-name>`
- `SLAW_WORKTREE_COLOR=<hex-color>`

The server/UI use those values for worktree-specific branding such as the top banner and dynamically colored favicon.
Authenticated worktree servers also use the `SLAW_INSTANCE_ID` value to scope Better Auth cookie names.
Browser cookies are shared by host rather than port, so this prevents logging into one `127.0.0.1:<port>` worktree from replacing another worktree server's session cookie.

Print shell exports explicitly when needed:

```sh
slaw worktree env
# or:
eval "$(slaw worktree env)"
```

### Worktree CLI Reference

**`pnpm slaw worktree init [options]`** — Create repo-local config/env and an isolated instance for the current worktree.

| Option | Description |
|---|---|
| `--name <name>` | Display name used to derive the instance id |
| `--instance <id>` | Explicit isolated instance id |
| `--home <path>` | Home root for worktree instances (default: `~/.slaw-worktrees`) |
| `--from-config <path>` | Source config.json to seed from |
| `--from-data-dir <path>` | Source SLAW_HOME used when deriving the source config |
| `--from-instance <id>` | Source instance id (default: `default`) |
| `--server-port <port>` | Preferred server port |
| `--db-port <port>` | Preferred embedded Postgres port |
| `--seed-mode <mode>` | Seed profile: `minimal` or `full` (default: `minimal`) |
| `--no-seed` | Skip database seeding from the source instance |
| `--force` | Replace existing repo-local config and isolated instance data |

Examples:

```sh
slaw worktree init --no-seed
slaw worktree init --seed-mode full
slaw worktree init --from-instance default
slaw worktree init --from-data-dir ~/.slaw
slaw worktree init --force
```

Repair an already-created repo-managed worktree and reseed its isolated instance from the main default install. Point `--from-config` at the instance config:

```sh
cd /path/to/slaw/.slaw/worktrees/PAP-884-ai-commits-component
pnpm slaw worktree init --force --seed-mode minimal \
  --name PAP-884-ai-commits-component \
  --from-config ~/.slaw/instances/default/config.json
```

That rewrites the worktree-local `.slaw/config.json` + `.slaw/.env`, recreates the isolated instance under `~/.slaw-worktrees/instances/<worktree-id>/`, and preserves the git worktree contents themselves.

For an already-created worktree where you want the CLI to decide whether to rebuild missing worktree metadata or just reseed the isolated DB, use `worktree repair`.

**`pnpm slaw worktree repair [options]`** — Repair the current linked worktree by default, or create/repair a named linked worktree under `.slaw/worktrees/` when `--branch` is provided. The command never targets the primary checkout unless you explicitly pass `--branch`.

| Option | Description |
|---|---|
| `--branch <name>` | Existing branch/worktree selector to repair, or a branch name to create under `.slaw/worktrees` |
| `--home <path>` | Home root for worktree instances (default: `~/.slaw-worktrees`) |
| `--from-config <path>` | Source config.json to seed from |
| `--from-data-dir <path>` | Source `SLAW_HOME` used when deriving the source config |
| `--from-instance <id>` | Source instance id when deriving the source config (default: `default`) |
| `--seed-mode <mode>` | Seed profile: `minimal` or `full` (default: `minimal`) |
| `--no-seed` | Repair metadata only when bootstrapping a missing worktree config |
| `--allow-live-target` | Override the guard that requires the target worktree DB to be stopped first |

Examples:

```sh
# From inside a linked worktree, rebuild missing .slaw metadata and reseed it from the default instance.
cd /path/to/slaw/.slaw/worktrees/PAP-1132-assistant-ui-pap-1131-make-issues-comments-be-like-a-chat
pnpm slaw worktree repair

# From the primary checkout, create or repair a linked worktree for a branch under .slaw/worktrees/.
cd /path/to/slaw
pnpm slaw worktree repair --branch PAP-1132-assistant-ui-pap-1131-make-issues-comments-be-like-a-chat
```

For an already-created worktree where you want to keep the existing repo-local config/env and only overwrite the isolated database, use `worktree reseed` instead. Stop the target worktree's Slaw server first so the command can replace the DB safely.

**`pnpm slaw worktree reseed [options]`** — Re-seed an existing worktree-local instance from another Slaw instance or worktree while preserving the target worktree's current config, ports, and instance identity.

| Option | Description |
|---|---|
| `--from <worktree>` | Source worktree path, directory name, branch name, or `current` |
| `--to <worktree>` | Target worktree path, directory name, branch name, or `current` (defaults to `current`) |
| `--from-config <path>` | Source config.json to seed from |
| `--from-data-dir <path>` | Source `SLAW_HOME` used when deriving the source config |
| `--from-instance <id>` | Source instance id when deriving the source config |
| `--seed-mode <mode>` | Seed profile: `minimal` or `full` (default: `full`) |
| `--yes` | Skip the destructive confirmation prompt |
| `--allow-live-target` | Override the guard that requires the target worktree DB to be stopped first |

Examples:

```sh
# From the main repo, reseed a worktree from the current default/master instance.
cd /path/to/slaw
pnpm slaw worktree reseed \
  --from current \
  --to PAP-1132-assistant-ui-pap-1131-make-issues-comments-be-like-a-chat \
  --seed-mode full \
  --yes

# From inside a worktree, reseed it from the default instance config.
cd /path/to/slaw/.slaw/worktrees/PAP-1132-assistant-ui-pap-1131-make-issues-comments-be-like-a-chat
pnpm slaw worktree reseed \
  --from-instance default \
  --seed-mode full
```

**`pnpm slaw worktree:make <name> [options]`** — Create `~/NAME` as a git worktree, then initialize an isolated Slaw instance inside it. This combines `git worktree add` with `worktree init` in a single step.

| Option | Description |
|---|---|
| `--start-point <ref>` | Remote ref to base the new branch on (e.g. `origin/main`) |
| `--instance <id>` | Explicit isolated instance id |
| `--home <path>` | Home root for worktree instances (default: `~/.slaw-worktrees`) |
| `--from-config <path>` | Source config.json to seed from |
| `--from-data-dir <path>` | Source SLAW_HOME used when deriving the source config |
| `--from-instance <id>` | Source instance id (default: `default`) |
| `--server-port <port>` | Preferred server port |
| `--db-port <port>` | Preferred embedded Postgres port |
| `--seed-mode <mode>` | Seed profile: `minimal` or `full` (default: `minimal`) |
| `--no-seed` | Skip database seeding from the source instance |
| `--force` | Replace existing repo-local config and isolated instance data |

Examples:

```sh
pnpm slaw worktree:make slaw-pr-432
pnpm slaw worktree:make my-feature --start-point origin/main
pnpm slaw worktree:make experiment --no-seed
```

**`pnpm slaw worktree env [options]`** — Print shell exports for the current worktree-local Slaw instance.

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to config file |
| `--json` | Print JSON instead of shell exports |

Examples:

```sh
pnpm slaw worktree env
pnpm slaw worktree env --json
eval "$(pnpm slaw worktree env)"
```

For project execution worktrees, Slaw can also run a project-defined provision command after it creates or reuses an isolated git worktree. Configure this on the project's execution workspace policy (`workspaceStrategy.provisionCommand`). The command runs inside the derived worktree and receives `SLAW_WORKSPACE_*`, `SLAW_PROJECT_ID`, `SLAW_AGENT_ID`, and `SLAW_ISSUE_*` environment variables so each repo can bootstrap itself however it wants.

## App-Shipped Skills Catalog

The Slaw app ships a curated catalog of squad skills out of the box. The
catalog is a workspace package at `packages/skills-catalog`:

```text
packages/skills-catalog/
  catalog/
    bundled/<category>/<slug>/SKILL.md   # recommended defaults
    optional/<category>/<slug>/SKILL.md  # role/domain-specific
  generated/catalog.json                  # checked-in manifest
  scripts/
    build-catalog-manifest.ts             # regenerate generated/catalog.json
    validate-catalog.ts                   # validation only
  src/                                    # builder + types consumed by server/CLI
```

Server and CLI import the generated manifest; they do not crawl repository
paths at request time. Root `skills/` remains reserved for Slaw runtime
skills and is not part of the catalog.

Validate the catalog without writing the manifest:

```sh
pnpm --filter @slaw-ai/skills-catalog validate
```

Regenerate `generated/catalog.json` after editing any catalog `SKILL.md`,
frontmatter, file inventory, category, or slug:

```sh
pnpm --filter @slaw-ai/skills-catalog build:manifest
```

The package's `build` script runs `build:manifest` and then `tsc`; tests live
under `pnpm --filter @slaw-ai/skills-catalog test`. Validation fails when:

- a catalog entry is not under `catalog/bundled/<category>/<slug>` or
  `catalog/optional/<category>/<slug>`
- `SKILL.md` is missing or the frontmatter `name`/`description` is empty
- the frontmatter `key` disagrees with the generated canonical key
- two catalog entries share an `id`, `key`, or `slug`
- file inventory contains absolute paths, `..`, broken symlinks, or files
  outside the skill directory
- the regenerated manifest differs from the checked-in
  `generated/catalog.json`

Trust level is derived from inventory: `markdown_only` (markdown + references
only), `assets` (other non-script files), or `scripts_executables` (any
executable script). The build contract is documented in
`doc/plans/2026-05-26-skills-cli-catalog-contract.md`.

CI runs `pnpm --filter @slaw-ai/skills-catalog validate` and the package's
vitest suite, so always regenerate the manifest in the same commit as the
catalog change.

## Quick Health Checks

In another terminal:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/squads
```

Expected:

- `/api/health` returns `{"status":"ok"}`
- `/api/squads` returns a JSON array

## Reset Local Dev Database

To wipe local dev data and start fresh:

```sh
rm -rf ~/.slaw/instances/default/db
pnpm dev
```

## Optional: Use External Postgres

If you set `DATABASE_URL`, the server will use that instead of embedded PostgreSQL.

## Automatic DB Backups

Slaw can run automatic logical database backups on a timer. These backups cover
non-system database schemas, including migration history and plugin-owned database
schemas. Defaults:

- enabled
- every 60 minutes
- retain 30 days
- backup dir: `~/.slaw/instances/default/data/backups`

Configure these in:

```sh
pnpm slaw configure --section database
```

Run a one-off backup manually:

```sh
pnpm slaw db:backup
# or:
pnpm db:backup
```

Environment overrides:

- `SLAW_DB_BACKUP_ENABLED=true|false`
- `SLAW_DB_BACKUP_INTERVAL_MINUTES=<minutes>`
- `SLAW_DB_BACKUP_RETENTION_DAYS=<days>`
- `SLAW_DB_BACKUP_DIR=/absolute/or/~/path`

DB backups are not full instance filesystem backups. For full local disaster
recovery, also back up local storage files and the local encrypted secrets key if
those providers are enabled.

## Secrets in Dev

Agent env vars now support secret references. By default, secret values are stored with local encryption and only secret refs are persisted in agent config.

- Default local key path: `~/.slaw/instances/default/secrets/master.key`
- Override key material directly: `SLAW_SECRETS_MASTER_KEY`
- Override key file path: `SLAW_SECRETS_MASTER_KEY_FILE`
- Back up the key file and database together; either one alone is not enough to restore local encrypted secrets.

Strict mode (recommended outside local trusted machines):

```sh
SLAW_SECRETS_STRICT_MODE=true
```

When strict mode is enabled, sensitive env keys (for example `*_API_KEY`, `*_TOKEN`, `*_SECRET`) must use secret references instead of inline plain values.
Authenticated deployments default strict mode on unless explicitly overridden.

CLI configuration support:

- `pnpm slaw onboard` writes a default `secrets` config section (`local_encrypted`, strict mode off, key file path set) and creates a local key file when needed.
- `pnpm slaw configure --section secrets` lets you update provider/strict mode/key path and creates the local key file when needed.
- `pnpm slaw doctor` validates secrets adapter configuration, can create a missing local key file with `--repair`, and reports missing AWS Secrets Manager bootstrap env when that provider is selected.
- Provider health is available at `GET /api/squads/:squadId/secret-providers/health` and reports local key permission warnings plus backup guidance.

Per-squad provider vaults are configured in the board UI under
`Squad Settings → Secrets → Provider vaults`, backed by
`/api/squads/{squadId}/secret-provider-configs`. The CLI does not own
vault lifecycle today. See `docs/deploy/secrets.md` (`Provider Vaults` section)
for the operator model.

Migration helper for existing inline env secrets:

```sh
pnpm secrets:migrate-inline-env         # dry run
pnpm secrets:migrate-inline-env --apply # apply migration
```

## Squad Deletion Toggle

Squad deletion is intended as a dev/debug capability and can be disabled at runtime:

```sh
SLAW_ENABLE_SQUAD_DELETION=false
```

Default behavior:

- `local_trusted`: enabled
- `authenticated`: disabled

## CLI Client Operations

Slaw CLI now includes client-side control-plane commands in addition to setup commands.

Quick examples:

```sh
pnpm slaw issue list --squad-id <squad-id>
pnpm slaw issue create --squad-id <squad-id> --title "Investigate checkout conflict"
pnpm slaw issue update <issue-id> --status in_progress --comment "Started triage"
```

Set defaults once with context profiles:

```sh
pnpm slaw context set --api-base http://localhost:3100 --squad-id <squad-id>
```

Then run commands without repeating flags:

```sh
pnpm slaw issue list
pnpm slaw dashboard get
```

See full command reference in `doc/CLI.md`.

## Agent Invite Onboarding Endpoints

Agent-oriented invite onboarding now exposes machine-readable API docs:

The board UI generates agent onboarding prompts from the add-agent modal (`+` in the agent sidebar), so agent onboarding sits with the rest of agent creation rather than squad member invite settings.

- `GET /api/invites/:token` returns invite summary plus onboarding and skills index links.
- `GET /api/invites/:token/onboarding` returns onboarding manifest details (registration endpoint, claim endpoint template, skill install hints).
- `GET /api/invites/:token/onboarding.txt` returns a plain-text onboarding doc intended for both human operators and agents (llm.txt-style handoff), including optional inviter message and suggested network host candidates.
- `GET /api/skills/index` lists available skill documents.
- `GET /api/skills/slaw` returns the Slaw heartbeat skill markdown.
