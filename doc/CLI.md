# CLI Reference

Slaw CLI now supports both:

- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`, `env-lab`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Base Usage

Use repo script in development:

```sh
pnpm slaw --help
```

First-time local bootstrap + run:

```sh
pnpm slaw run
```

Choose local instance:

```sh
pnpm slaw run --instance dev
```

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `slaw onboard` and `slaw configure --section server` set deployment mode in config
- server onboarding/configure ask for reachability intent and write `server.bind`
- `slaw run --bind <loopback|lan|tailnet>` passes a quickstart bind preset into first-run onboarding when config is missing
- runtime can override mode with `SLAW_DEPLOYMENT_MODE`
- `slaw run` and `slaw doctor` still do not expose a direct low-level `--mode` flag

Canonical behavior is documented in `doc/DEPLOYMENT-MODES.md`.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
pnpm slaw allowed-hostname dotta-macbook-pro
```

Bring up the default local SSH fixture for environment testing:

```sh
pnpm slaw env-lab up
pnpm slaw env-lab doctor
pnpm slaw env-lab status --json
pnpm slaw env-lab down
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Squad-scoped commands also support `--squad-id <id>`.

API base resolution order:

1. `--api-base <url>`
2. `SLAW_API_URL`
3. selected context profile `apiBase`
4. local Slaw config server port
5. `http://localhost:3100`

Connection failures include the attempted URL and a `GET /api/health` check hint.

## Connect Wizard

```sh
pnpm slaw connect
```

`connect` confirms the resolved API base, verifies `GET /api/health`, authenticates board access when needed, and saves a persona-aware profile:

- `persona=board` for board operator profiles
- `persona=agent` with `agentId` and `agentName` for agent profiles

Profiles store token env-var names, not plaintext tokens. The wizard prints shell exports for the newly created token.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.slaw`:

```sh
pnpm slaw run --data-dir ./tmp/slaw-dev
pnpm slaw issue list --data-dir ./tmp/slaw-dev
```

## Context Profiles

Store local defaults in `~/.slaw/context.json`:

```sh
pnpm slaw context set --api-base http://localhost:3100 --squad-id <squad-id>
pnpm slaw context set --persona agent --agent-id <agent-id> --api-key-env-var-name SLAW_API_KEY
pnpm slaw context show
pnpm slaw context list
pnpm slaw context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
pnpm slaw context set --api-key-env-var-name SLAW_API_KEY
export SLAW_API_KEY=...
```

## Squad Commands

```sh
pnpm slaw squad list
pnpm slaw squad get <squad-id>
pnpm slaw squad stats
pnpm slaw squad create --payload-json '{...}'
pnpm slaw squad update <squad-id> --payload-json '{...}'
pnpm slaw squad branding:update <squad-id> --payload-json '{...}'
pnpm slaw squad archive <squad-id>
pnpm slaw squad export <squad-id> --out ./squad --include squad,agents,projects,issues,skills
pnpm slaw squad export:preview <squad-id> --payload-json '{...}'
pnpm slaw squad export:api <squad-id> --payload-json '{...}'
pnpm slaw squad import ./squad --target new --new-squad-name "Imported Squad"
pnpm slaw squad import:preview <squad-id> --payload-json '{...}'
pnpm slaw squad import:apply <squad-id> --payload-json '{...}'
pnpm slaw squad delete <squad-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
pnpm slaw squad delete PAP --yes --confirm PAP
pnpm slaw squad delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- Deletion is server-gated by `SLAW_ENABLE_SQUAD_DELETION`.
- With agent authentication, squad deletion is squad-scoped. Use the current squad ID/prefix (for example via `--squad-id` or `SLAW_SQUAD_ID`), not another squad.

## Issue Commands

```sh
pnpm slaw issue list --squad-id <squad-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
pnpm slaw issue get <issue-id-or-identifier>
pnpm slaw issue create --squad-id <squad-id> --title "..." [--description "..."] [--status todo] [--priority high]
pnpm slaw issue update <issue-id> [--status in_progress] [--comment "..."]
pnpm slaw issue delete <issue-id> --yes
pnpm slaw issue comment <issue-id> --body "..." [--reopen]
pnpm slaw issue comments <issue-id> [--limit 50]
pnpm slaw issue comment:get <issue-id> <comment-id>
pnpm slaw issue comment:delete <issue-id> <comment-id>
pnpm slaw issue runs <issue-id-or-identifier>
pnpm slaw issue live-runs <issue-id-or-identifier>
pnpm slaw issue active-run <issue-id-or-identifier>
pnpm slaw issue heartbeat-context <issue-id>
pnpm slaw issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
pnpm slaw issue release <issue-id>
pnpm slaw issue force-release <issue-id>
```

Issue subresources are exposed as Slaw API wrappers. Commands that map to broad server schemas accept JSON payloads and validate them with shared schemas before sending.

```sh
pnpm slaw issue child:create <issue-id> --payload-json '{"title":"Child task"}'
pnpm slaw issue approvals <issue-id>
pnpm slaw issue approval:link <issue-id> <approval-id>
pnpm slaw issue approval:unlink <issue-id> <approval-id>
pnpm slaw issue read <issue-id>
pnpm slaw issue unread <issue-id>
pnpm slaw issue archive <issue-id>
pnpm slaw issue unarchive <issue-id>
pnpm slaw issue recovery-actions <issue-id>
pnpm slaw issue recovery:resolve <issue-id> --outcome restored --source-issue-status todo
```

```sh
pnpm slaw issue documents <issue-id> [--include-system]
pnpm slaw issue document:get <issue-id> <key>
pnpm slaw issue document:put <issue-id> <key> --body-file ./plan.md [--title Plan]
pnpm slaw issue document:lock <issue-id> <key>
pnpm slaw issue document:unlock <issue-id> <key>
pnpm slaw issue document:revisions <issue-id> <key>
pnpm slaw issue document:restore <issue-id> <key> <revision-id>
pnpm slaw issue document:delete <issue-id> <key>
```

```sh
pnpm slaw issue work-products <issue-id>
pnpm slaw issue work-product:create <issue-id> --payload-json '{"type":"pull_request","provider":"github","title":"PR"}'
pnpm slaw issue work-product:update <work-product-id> --payload-json '{"status":"archived"}'
pnpm slaw issue work-product:delete <work-product-id>
pnpm slaw issue interactions <issue-id>
pnpm slaw issue interaction:create <issue-id> --payload-json '{"kind":"request_confirmation","payload":{"version":1,"prompt":"Continue?"}}'
pnpm slaw issue interaction:accept <issue-id> <interaction-id> [--selected-client-keys key1,key2]
pnpm slaw issue interaction:reject <issue-id> <interaction-id> [--reason "..."]
pnpm slaw issue interaction:respond <issue-id> <interaction-id> --answers-json '[{"questionId":"q1","optionIds":["yes"]}]'
pnpm slaw issue interaction:cancel <issue-id> <interaction-id> [--reason "..."]
```

```sh
pnpm slaw issue tree-state <issue-id>
pnpm slaw issue tree-preview <issue-id> --payload-json '{"mode":"pause"}'
pnpm slaw issue tree-holds <issue-id> [--status active] [--include-members]
pnpm slaw issue tree-hold:create <issue-id> --payload-json '{"mode":"pause","reason":"review"}'
pnpm slaw issue tree-hold:get <issue-id> <hold-id>
pnpm slaw issue tree-hold:release <issue-id> <hold-id> [--payload-json '{"reason":"done"}']
pnpm slaw issue attachments <issue-id>
pnpm slaw issue attachment:upload <issue-id> --squad-id <squad-id> --file ./artifact.txt
pnpm slaw issue attachment:download <attachment-id> [--out ./artifact.txt]
pnpm slaw issue attachment:delete <attachment-id>
pnpm slaw issue label:list --squad-id <squad-id>
pnpm slaw issue label:create --squad-id <squad-id> --name bug --color '#ff0000'
pnpm slaw issue label:delete <label-id>
pnpm slaw issue feedback:votes <issue-id>
pnpm slaw issue feedback:vote <issue-id> --payload-json '{"targetType":"issue_comment","targetId":"...","vote":"up"}'
```

## Project Commands

```sh
pnpm slaw project list --squad-id <squad-id>
pnpm slaw project get <project-id-or-shortname> [--squad-id <squad-id>]
pnpm slaw project create --squad-id <squad-id> --name "Launch Site" [--goal-ids <id1,id2>] [--lead-agent-id <id>]
pnpm slaw project update <project-id-or-shortname> [--status in_progress] [--squad-id <squad-id>]
pnpm slaw project delete <project-id-or-shortname> --yes [--squad-id <squad-id>]
```

Advanced project fields accept JSON:

```sh
pnpm slaw project create --squad-id <squad-id> --name "Ops" --env-json '{"OPENAI_API_KEY":{"kind":"secret","secretName":"openai-api-key"}}'
pnpm slaw project update <project-id> --execution-workspace-policy-json '{"enabled":true,"defaultMode":"shared_workspace"}'
```

## Goal Commands

```sh
pnpm slaw goal list --squad-id <squad-id>
pnpm slaw goal get <goal-id>
pnpm slaw goal create --squad-id <squad-id> --title "Grow revenue" [--level squad] [--status active]
pnpm slaw goal update <goal-id> [--title "..."] [--status achieved]
pnpm slaw goal delete <goal-id> --yes
```

## Agent Commands

```sh
pnpm slaw agent list --squad-id <squad-id>
pnpm slaw agent get <agent-id>
pnpm slaw agent create --squad-id <squad-id> --payload-json '{"name":"Builder","adapterType":"codex_local"}'
pnpm slaw agent hire --squad-id <squad-id> --payload-json '{...}'
pnpm slaw agent update <agent-id> --payload-json '{"title":"Senior Builder"}'
pnpm slaw agent delete <agent-id> --yes
pnpm slaw agent me
pnpm slaw agent inbox
pnpm slaw agent inbox-mine --user-id <board-user-id>
pnpm slaw agent wake <agent-id-or-shortname> [--squad-id <squad-id>] [--reason "..."] [--payload '{"issueId":"..."}']
pnpm slaw agent pause <agent-id>
pnpm slaw agent resume <agent-id>
pnpm slaw agent approve <agent-id>
pnpm slaw agent terminate <agent-id>
pnpm slaw agent heartbeat:invoke <agent-id>
pnpm slaw agent claude-login <agent-id>
pnpm slaw agent local-cli <agent-id-or-shortname> --squad-id <squad-id>
```

Agent configuration and runtime endpoints:

```sh
pnpm slaw agent permissions:update <agent-id> --payload-json '{"canCreateAgents":true,"canAssignTasks":true}'
pnpm slaw agent configuration <agent-id>
pnpm slaw agent config-revisions <agent-id>
pnpm slaw agent config-revision:get <agent-id> <revision-id>
pnpm slaw agent config-revision:rollback <agent-id> <revision-id>
pnpm slaw agent runtime-state <agent-id>
pnpm slaw agent runtime-state:reset-session <agent-id> [--task-key <key>]
pnpm slaw agent task-sessions <agent-id>
pnpm slaw agent skills <agent-id>
pnpm slaw agent skills:sync <agent-id> --desired-skills slaw,github
pnpm slaw agent instructions-path:update <agent-id> --payload-json '{"path":"/path/to/AGENTS.md"}'
pnpm slaw agent instructions-bundle <agent-id>
pnpm slaw agent instructions-bundle:update <agent-id> --payload-json '{"mode":"managed"}'
pnpm slaw agent instructions-file:get <agent-id> --path AGENTS.md
pnpm slaw agent instructions-file:put <agent-id> --path AGENTS.md --content-file ./AGENTS.md
pnpm slaw agent instructions-file:delete <agent-id> --path AGENTS.md
```

`agent local-cli` is the quickest way to run local Claude/Codex manually as a Slaw agent:

- creates a new long-lived agent API key
- installs missing Slaw skills into `~/.codex/skills` and `~/.claude/skills`
- prints `export ...` lines for `SLAW_API_URL`, `SLAW_SQUAD_ID`, `SLAW_AGENT_ID`, and `SLAW_API_KEY`

Example for shortname-based local setup:

```sh
pnpm slaw agent local-cli codexcoder --squad-id <squad-id>
pnpm slaw agent local-cli claudecoder --squad-id <squad-id>
```

## Token Commands

Agent API keys are scoped to one squad and one agent. Plaintext tokens are printed once at creation.

```sh
pnpm slaw token agent create --squad-id <squad-id> --agent <agent-id-or-name> --name external-worker
pnpm slaw token agent list --squad-id <squad-id> --agent <agent-id-or-name>
pnpm slaw token agent revoke --squad-id <squad-id> --agent <agent-id-or-name> <key-id>
```

Named board API keys use the board authorization model, support revocation and expiration metadata, and are audited server-side.

```sh
pnpm slaw token board create --squad-id <squad-id> --name external-admin
pnpm slaw token board create --name short-lived --ttl-days 7
pnpm slaw token board list
pnpm slaw token board revoke <key-id>
```

## Run Commands

`slaw run` without a subcommand still bootstraps and starts a local Slaw instance. The subcommands below inspect and control API heartbeat runs.

```sh
pnpm slaw run list --squad-id <squad-id> [--agent-id <agent-id>] [--limit 50]
pnpm slaw run live --squad-id <squad-id> [--limit 50] [--min-count 0]
pnpm slaw run get <run-id>
pnpm slaw run events <run-id> [--after-seq 0] [--limit 200]
pnpm slaw run log <run-id> [--offset 0] [--limit-bytes 16384] [--text]
pnpm slaw run cancel <run-id>
pnpm slaw run issues <run-id>
pnpm slaw run workspace-operations <run-id>
pnpm slaw run workspace-log <operation-id> [--offset 0] [--limit-bytes 16384] [--text]
pnpm slaw run watchdog-decision <run-id> --decision continue [--reason "..."]
```

## Routine Commands

`slaw routines disable-all` remains the local maintenance command. The singular `routine` group maps to the REST API.

```sh
pnpm slaw routine list --squad-id <squad-id> [--project-id <project-id>]
pnpm slaw routine create --squad-id <squad-id> --payload-json '{...}'
pnpm slaw routine get <routine-id>
pnpm slaw routine update <routine-id> --payload-json '{...}'
pnpm slaw routine revisions <routine-id>
pnpm slaw routine revision:restore <routine-id> <revision-id>
pnpm slaw routine runs <routine-id> [--limit 50]
pnpm slaw routine run <routine-id> [--payload-json '{...}']
pnpm slaw routine trigger:create <routine-id> --payload-json '{...}'
pnpm slaw routine trigger:update <trigger-id> --payload-json '{...}'
pnpm slaw routine trigger:delete <trigger-id>
pnpm slaw routine trigger:rotate-secret <trigger-id>
pnpm slaw routine trigger:fire <public-id> [--payload-json '{...}']
```

## Prompt Handoff

Prompt handoff creates Slaw work. It does not create a chat session.

```sh
pnpm slaw agent-prompt <agent-name-or-id> <agent-api-key> "Prompt here"
pnpm slaw agent prompt --agent <agent-name-or-id> --api-key-env SLAW_API_KEY "Prompt here"
pnpm slaw agent prompt --profile my-agent "Prompt here"
pnpm slaw board prompt --squad-id <squad-id> --agent <agent-name-or-id> "Prompt here"
```

By default the command creates a `todo` issue assigned to the target agent and wakes the agent. Use `--issue <issue-id>` to add a comment to existing work, and `--no-wake` to skip the wakeup.

## Skills Commands

`slaw skills` covers three distinct operations:

1. **Squad install** — adds or updates a row in `squad_skills` for the
   whole squad. This is what `skills install`, `skills import`, `skills create`,
   and `skills scan-projects` do.
2. **Agent attach** — replaces an agent's *desired* squad skill set
   (`skills agent sync`/`clear`). This is a desired-state operation on the
   agent's adapter config; it does not change the squad library.
3. **Adapter runtime sync** — the adapter reconciles the desired skill set
   with files on disk and reports an `AgentSkillSnapshot` (`skills agent list`).
   `skills agent sync` triggers this automatically after updating desired state.

Required Slaw runtime skills (heartbeat, etc.) remain server-enforced and
are added on top of whatever the desired set names.

### Catalog (app-shipped skills)

The Slaw app ships a curated catalog under `@slaw/skills-catalog`.
Browse and inspect commands never mutate squad state; `install` adds a catalog
skill to the squad library.

```sh
pnpm slaw skills browse [--kind bundled|optional] [--category <slug>] [--query <text>]
pnpm slaw skills search "<text>" [--kind bundled|optional] [--category <slug>]
pnpm slaw skills inspect <catalog-id-or-key-or-slug>
pnpm slaw skills install <catalog-id-or-key-or-slug> [--as <slug>] [--force] --squad-id <squad-id>
```

Catalog semantics:

- **Bundled** skills live in `packages/skills-catalog/catalog/bundled/<category>/<slug>`
  and are recommended defaults for most squads. They use canonical key
  `slaw/bundled/<category>/<slug>`.
- **Optional** skills live in `packages/skills-catalog/catalog/optional/<category>/<slug>`
  and are role-specific or domain-specific (browser, AWS ops, etc.). Same key
  shape with `optional` in place of `bundled`.
- `skills install` materializes the catalog files into a squad-managed skill
  directory and records provenance (`catalogId`, `catalogKey`, `packageVersion`,
  `originHash`, …) so future updates and audit decisions stay consistent.
- `--as <slug>` overrides the squad skill slug. `--force` may replace a
  same-key catalog-managed skill but never bypasses hard validation or hard-stop
  audit findings.

Examples:

```sh
pnpm slaw skills browse --kind bundled --squad-id <squad-id>
pnpm slaw skills search "pull request" --kind bundled
pnpm slaw skills inspect github-pr-workflow
pnpm slaw skills install github-pr-workflow --squad-id <squad-id>
pnpm slaw skills install slaw:optional:browser:agent-browser --squad-id <squad-id>
```

External GitHub, skills.sh, local-path, and URL sources still go through
`skills import`; catalog commands are for the app-shipped catalog only.

### Squad library

```sh
pnpm slaw skills list --squad-id <squad-id>
pnpm slaw skills show <skill-id-or-key-or-slug> --squad-id <squad-id>
pnpm slaw skills file <skill-id-or-key-or-slug> [--path SKILL.md] --squad-id <squad-id>
pnpm slaw skills import <source> --squad-id <squad-id>
pnpm slaw skills create --name "Review PRs" [--slug review-prs] [--description "..."] [--body-file SKILL.md] --squad-id <squad-id>
pnpm slaw skills scan-projects [--project-id <id>...] [--workspace-id <id>...] --squad-id <squad-id>
pnpm slaw skills check [skill-id-or-key-or-slug] --squad-id <squad-id>
pnpm slaw skills update <skill-id-or-key-or-slug> [--force] --squad-id <squad-id>
pnpm slaw skills update --all [--force] --squad-id <squad-id>
pnpm slaw skills audit [skill-id-or-key-or-slug] --squad-id <squad-id>
pnpm slaw skills reset <skill-id-or-key-or-slug> [--yes] [--force] --squad-id <squad-id>
pnpm slaw skills remove <skill-id-or-key-or-slug> --yes --squad-id <squad-id>
```

`skills import <source>` accepts a skills.sh URL, the equivalent
`<owner>/<repo>/<skill>` shorthand, a GitHub URL, a local path, or an
`npx skills add …` command. See `references/squad-skills.md` in the agent
skill bundle for the source-type table.

`skills check`, `skills update`, `skills audit`, and `skills reset` are the
maintenance loop for catalog-installed skills:

- `check` reports whether each skill's installed bytes match its pinned origin
  (`hasUpdate`, `installedHash`, `originHash`, `updateHoldReason`,
  `auditVerdict`).
- `update` installs the pinned update through the existing install-update API.
  `--all` checks every squad skill and updates only those with
  `hasUpdate=true`. `--force` discards local-modification or soft-audit holds;
  hard-stop audit findings still block the update.
- `audit` re-scans installed bytes and reports findings without executing
  anything.
- `reset` reinstalls a catalog-managed skill from its pinned origin, discarding
  local edits. Prompts in a TTY; requires `--yes` for non-interactive use.

### Agent attach

```sh
pnpm slaw skills agent list <agent-id-or-shortname> --squad-id <squad-id>
pnpm slaw skills agent sync <agent-id-or-shortname> --skill <skill-id-or-key-or-slug> [--skill <skill-id-or-key-or-slug>...] --squad-id <squad-id>
pnpm slaw skills agent clear <agent-id-or-shortname> --yes --squad-id <squad-id>
```

`skills agent sync` replaces the agent's non-required desired skill set (it is
not additive) and returns the resulting adapter `AgentSkillSnapshot`.
`skills agent clear` sends an empty desired list. Required Slaw skills are
still enforced by the server in both cases.

### Notes

- Skill references accept squad skill `id`, canonical `key`, or unique
  `slug`; catalog references accept catalog `id`, `key`, or unique `slug`.
- `skills file` prints raw file content in human mode so it can be piped.
- `skills create --body-file -` reads the skill markdown body from stdin.
- `skills remove`, `skills reset`, and `skills agent clear` prompt in a TTY and
  require `--yes` in non-interactive use.
- `--json` prints the raw API result for each command.

## Secrets Commands

```sh
pnpm slaw secrets list --squad-id <squad-id>
pnpm slaw secrets declarations --squad-id <squad-id> [--include agents,projects] [--kind secret]
pnpm slaw secrets create --squad-id <squad-id> --name anthropic-api-key --value-env ANTHROPIC_API_KEY
pnpm slaw secrets link --squad-id <squad-id> --name prod-stripe-key --provider aws_secrets_manager --external-ref <provider-ref>
pnpm slaw secrets doctor --squad-id <squad-id>
pnpm slaw secrets provider-configs --squad-id <squad-id>
pnpm slaw secrets provider-config:create --squad-id <squad-id> --payload-json '{...}'
pnpm slaw secrets provider-config:discovery-preview --squad-id <squad-id> --payload-json '{...}'
pnpm slaw secrets provider-config:get <config-id>
pnpm slaw secrets provider-config:update <config-id> --payload-json '{...}'
pnpm slaw secrets provider-config:default <config-id>
pnpm slaw secrets provider-config:health <config-id>
pnpm slaw secrets provider-config:delete <config-id>
pnpm slaw secrets remote-import:preview --squad-id <squad-id> --payload-json '{...}'
pnpm slaw secrets remote-import --squad-id <squad-id> --payload-json '{...}'
pnpm slaw secrets migrate-inline-env --squad-id <squad-id> [--apply]
```

Secret listing and declarations never print secret values. `create` accepts
`--value-env` so shell history does not capture the value. `link` records
provider-owned references without copying the secret value into Slaw.
For AWS-backed secrets, `secrets doctor` reports missing non-secret provider
env and the expected AWS SDK runtime credential source; do not store AWS
bootstrap credentials in Slaw secrets.

Per-squad provider vaults (multiple vault instances per provider, default
vault selection, coming-soon GCP/Vault) can be configured from the board UI under
`Squad Settings → Secrets → Provider vaults` or through the provider-config CLI
commands above. See the
[secrets deploy guide](../docs/deploy/secrets.md#provider-vaults) and
[API reference](../docs/api/secrets.md#provider-vaults) for the contract.

## Approval Commands

```sh
pnpm slaw approval list --squad-id <squad-id> [--status pending]
pnpm slaw approval get <approval-id>
pnpm slaw approval create --squad-id <squad-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
pnpm slaw approval approve <approval-id> [--decision-note "..."]
pnpm slaw approval reject <approval-id> [--decision-note "..."]
pnpm slaw approval request-revision <approval-id> [--decision-note "..."]
pnpm slaw approval resubmit <approval-id> [--payload '{"...":"..."}']
pnpm slaw approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm slaw activity list --squad-id <squad-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
pnpm slaw activity create --squad-id <squad-id> --payload-json '{...}'
pnpm slaw activity issue <issue-id>
```

## Dashboard Commands

```sh
pnpm slaw dashboard get --squad-id <squad-id>
```

## Org And Agent Config Commands

```sh
pnpm slaw whoami
pnpm slaw openapi
pnpm slaw org get --squad-id <squad-id>
pnpm slaw org svg --squad-id <squad-id> [--out org.svg]
pnpm slaw org png --squad-id <squad-id> [--out org.png]
pnpm slaw agent-config list --squad-id <squad-id>
```

## Access, Profile, And Instance Commands

```sh
pnpm slaw profile session
pnpm slaw profile get
pnpm slaw profile update --payload-json '{...}'
pnpm slaw profile squad-user <user-slug> --squad-id <squad-id>
pnpm slaw invite list --squad-id <squad-id>
pnpm slaw invite create --squad-id <squad-id> --payload-json '{...}'
pnpm slaw invite revoke <invite-id>
pnpm slaw invite show <token>
pnpm slaw invite accept <token> [--payload-json '{...}']
pnpm slaw invite onboarding:text <token>
pnpm slaw join list --squad-id <squad-id> [--status pending_approval]
pnpm slaw join approve <request-id> --squad-id <squad-id>
pnpm slaw join reject <request-id> --squad-id <squad-id>
pnpm slaw join claim-key <request-id> --claim-secret <secret>
pnpm slaw member list --squad-id <squad-id>
pnpm slaw member update <member-id> --squad-id <squad-id> --payload-json '{...}'
pnpm slaw member role-and-grants <member-id> --squad-id <squad-id> --payload-json '{...}'
pnpm slaw member permissions <member-id> --squad-id <squad-id> --payload-json '{...}'
pnpm slaw member archive <member-id> --squad-id <squad-id> [--payload-json '{...}']
pnpm slaw admin user list [--query <text>]
pnpm slaw admin user promote <user-id>
pnpm slaw admin user demote <user-id>
pnpm slaw admin user squad-access <user-id>
pnpm slaw admin user squad-access:update <user-id> --payload-json '{...}'
```

CLI auth challenge endpoints are also exposed for tooling that needs the raw challenge lifecycle:

```sh
pnpm slaw auth challenge create --payload-json '{...}'
SLAW_CHALLENGE_SECRET=<challenge-secret> pnpm slaw auth challenge get <challenge-id> --token-env SLAW_CHALLENGE_SECRET
SLAW_CHALLENGE_SECRET=<challenge-secret> pnpm slaw auth challenge approve <challenge-id> --token-env SLAW_CHALLENGE_SECRET
SLAW_CHALLENGE_SECRET=<challenge-secret> pnpm slaw auth challenge cancel <challenge-id> --token-env SLAW_CHALLENGE_SECRET
pnpm slaw auth revoke-current
```

`--token <challenge-secret>` is still supported for compatibility, but `--token-env` avoids putting challenge secrets in shell history or process arguments.

```sh
pnpm slaw instance scheduler-heartbeats
pnpm slaw instance settings:general
pnpm slaw instance settings:general:update --payload-json '{...}'
pnpm slaw instance settings:experimental
pnpm slaw instance settings:experimental:update --payload-json '{...}'
pnpm slaw instance database-backup
pnpm slaw sidebar preferences
pnpm slaw sidebar preferences:update --payload-json '{...}'
pnpm slaw sidebar project-preferences --squad-id <squad-id>
pnpm slaw sidebar project-preferences:update --squad-id <squad-id> --payload-json '{...}'
pnpm slaw sidebar badges --squad-id <squad-id>
pnpm slaw inbox dismissals --squad-id <squad-id>
pnpm slaw inbox dismiss --squad-id <squad-id> --payload-json '{"itemKey":"run:<run-id>"}'
pnpm slaw board-claim show <token>
pnpm slaw board-claim claim <token> [--payload-json '{...}']
pnpm slaw available-skill list
pnpm slaw available-skill index
pnpm slaw available-skill get <skill-name>
pnpm slaw llm agent-configuration
pnpm slaw llm agent-configuration:adapter <adapter-type>
pnpm slaw llm agent-icons
```

## Adapter, Asset, And Skill Commands

```sh
pnpm slaw adapter list
pnpm slaw adapter install --payload-json '{"packageName":"@scope/adapter","version":"1.2.3"}'
pnpm slaw adapter get <adapter-type>
pnpm slaw adapter update <adapter-type> --payload-json '{"disabled":true}'
pnpm slaw adapter override <adapter-type> --payload-json '{"paused":true}'
pnpm slaw adapter reload <adapter-type>
pnpm slaw adapter reinstall <adapter-type>
pnpm slaw adapter delete <adapter-type>
pnpm slaw adapter config-schema <adapter-type>
pnpm slaw adapter ui-parser <adapter-type>
pnpm slaw adapter models <adapter-type> --squad-id <squad-id> [--refresh] [--environment-id <id>]
pnpm slaw adapter model-profiles <adapter-type> --squad-id <squad-id>
pnpm slaw adapter detect-model <adapter-type> --squad-id <squad-id>
pnpm slaw adapter test-environment <adapter-type> --squad-id <squad-id> --payload-json '{...}'
```

```sh
pnpm slaw asset image:upload --squad-id <squad-id> --file ./image.png [--namespace docs] [--alt "..."]
pnpm slaw asset logo:upload --squad-id <squad-id> --file ./logo.svg
pnpm slaw asset content <asset-id> --out ./asset.bin
```

```sh
pnpm slaw skill list --squad-id <squad-id>
pnpm slaw skill get <skill-id> --squad-id <squad-id>
pnpm slaw skill file <skill-id> --squad-id <squad-id> [--path SKILL.md]
pnpm slaw skill create --squad-id <squad-id> --payload-json '{...}'
pnpm slaw skill file:update <skill-id> --squad-id <squad-id> --payload-json '{...}'
pnpm slaw skill import --squad-id <squad-id> --payload-json '{"source":"github:owner/repo/path"}'
pnpm slaw skill scan-projects --squad-id <squad-id> --payload-json '{...}'
pnpm slaw skill update-status <skill-id> --squad-id <squad-id>
pnpm slaw skill install-update <skill-id> --squad-id <squad-id>
pnpm slaw skill delete <skill-id> --squad-id <squad-id>
```

## Cost, Finance, And Budget Commands

```sh
pnpm slaw cost summary --squad-id <squad-id>
pnpm slaw cost by-agent --squad-id <squad-id>
pnpm slaw cost by-agent-model --squad-id <squad-id>
pnpm slaw cost by-provider --squad-id <squad-id>
pnpm slaw cost by-biller --squad-id <squad-id>
pnpm slaw cost by-project --squad-id <squad-id>
pnpm slaw cost window-spend --squad-id <squad-id>
pnpm slaw cost quota-windows --squad-id <squad-id>
pnpm slaw cost issue <issue-id>
pnpm slaw cost event:create --squad-id <squad-id> --payload-json '{...}'
```

```sh
pnpm slaw finance event:create --squad-id <squad-id> --payload-json '{...}'
pnpm slaw finance events --squad-id <squad-id>
pnpm slaw finance summary --squad-id <squad-id>
pnpm slaw finance by-biller --squad-id <squad-id>
pnpm slaw finance by-kind --squad-id <squad-id>
pnpm slaw budget overview --squad-id <squad-id>
pnpm slaw budget policy:upsert --squad-id <squad-id> --payload-json '{...}'
pnpm slaw budget squad:update --squad-id <squad-id> --payload-json '{...}'
pnpm slaw budget agent:update <agent-id> --payload-json '{...}'
pnpm slaw budget incident:resolve <incident-id> --squad-id <squad-id> [--payload-json '{...}']
```

## Workspace And Environment Commands

```sh
pnpm slaw workspace list --squad-id <squad-id>
pnpm slaw workspace get <execution-workspace-id>
pnpm slaw workspace close-readiness <execution-workspace-id>
pnpm slaw workspace operations <execution-workspace-id>
pnpm slaw workspace update <execution-workspace-id> --payload-json '{...}'
pnpm slaw workspace runtime-service <execution-workspace-id> start --payload-json '{...}'
pnpm slaw workspace runtime-command <execution-workspace-id> run --payload-json '{...}'
```

```sh
pnpm slaw environment list --squad-id <squad-id>
pnpm slaw environment capabilities --squad-id <squad-id>
pnpm slaw environment create --squad-id <squad-id> --payload-json '{...}'
pnpm slaw environment get <environment-id>
pnpm slaw environment leases <environment-id>
pnpm slaw environment lease <lease-id>
pnpm slaw environment update <environment-id> --payload-json '{...}'
pnpm slaw environment delete <environment-id>
pnpm slaw environment probe <environment-id>
pnpm slaw environment probe-config --squad-id <squad-id> --payload-json '{...}'
```

```sh
pnpm slaw project-workspace list <project-id>
pnpm slaw project-workspace create <project-id> --payload-json '{...}'
pnpm slaw project-workspace update <project-id> <workspace-id> --payload-json '{...}'
pnpm slaw project-workspace delete <project-id> <workspace-id>
pnpm slaw project-workspace runtime-service <project-id> <workspace-id> restart --payload-json '{...}'
pnpm slaw project-workspace runtime-command <project-id> <workspace-id> run --payload-json '{...}'
```

## Plugin Commands

Existing plugin lifecycle commands remain available: `plugin init`, `list`, `install`, `uninstall`, `enable`, `disable`, `inspect`, and `examples`.

```sh
pnpm slaw plugin ui-contributions
pnpm slaw plugin tools
pnpm slaw plugin tool:execute --payload-json '{...}'
pnpm slaw plugin health <plugin-id>
pnpm slaw plugin logs <plugin-id>
pnpm slaw plugin upgrade <plugin-id>
pnpm slaw plugin config <plugin-id>
pnpm slaw plugin config:set <plugin-id> --payload-json '{"configJson":{...}}'
pnpm slaw plugin config:test <plugin-id> --payload-json '{"configJson":{...}}'
pnpm slaw plugin jobs <plugin-id>
pnpm slaw plugin job:runs <plugin-id> <job-id>
pnpm slaw plugin job:trigger <plugin-id> <job-id> [--payload-json '{...}']
pnpm slaw plugin webhook <plugin-id> <endpoint-key> [--payload-json '{...}']
pnpm slaw plugin dashboard <plugin-id>
pnpm slaw plugin bridge:data <plugin-id> --payload-json '{...}'
pnpm slaw plugin bridge:action <plugin-id> --payload-json '{...}'
pnpm slaw plugin bridge:stream <plugin-id> <channel> [--duration-ms 10000]
pnpm slaw plugin data <plugin-id> <key> --payload-json '{...}'
pnpm slaw plugin action <plugin-id> <key> --payload-json '{...}'
pnpm slaw plugin local-folders <plugin-id> --squad-id <squad-id>
pnpm slaw plugin local-folder:status <plugin-id> <folder-key> --squad-id <squad-id>
pnpm slaw plugin local-folder:validate <plugin-id> <folder-key> --squad-id <squad-id> [--payload-json '{...}']
pnpm slaw plugin local-folder:set <plugin-id> <folder-key> --squad-id <squad-id> --payload-json '{...}'
```

Feedback traces can be fetched directly by ID when automating export workflows:

```sh
pnpm slaw feedback trace <trace-id>
pnpm slaw feedback bundle <trace-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
pnpm slaw heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Local Slaw data lives under the selected instance root. `SLAW_HOME` chooses the home directory and `SLAW_INSTANCE_ID` chooses the instance.

```text
~/.slaw/                                     # SLAW_HOME
└── instances/
    └── default/                                  # instance root (SLAW_INSTANCE_ID)
        ├── config.json                           # runtime config
        ├── .env                                  # instance env file
        ├── db/                                   # embedded PostgreSQL data
        ├── data/
        │   ├── storage/                          # local_disk uploads
        │   └── backups/                          # automatic DB backups
        ├── logs/
        ├── secrets/
        │   └── master.key                        # local_encrypted master key
        ├── workspaces/                           # default agent workspaces
        ├── projects/                             # project execution workspaces
        ├── squads/                            # per-squad adapter homes (e.g. codex-home)
        └── codex-home/                           # per-instance codex home (when not squad-scoped)
```

Default paths for the canonical install:

- config: `~/.slaw/instances/default/config.json`
- embedded db: `~/.slaw/instances/default/db`
- logs: `~/.slaw/instances/default/logs`
- storage: `~/.slaw/instances/default/data/storage`
- secrets key: `~/.slaw/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
SLAW_HOME=/custom/home SLAW_INSTANCE_ID=dev pnpm slaw run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm slaw configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
