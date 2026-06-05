---
title: Importing & Exporting Squads
summary: Export squads to portable packages and import them from local paths or GitHub
---

Slaw squads can be exported to portable markdown packages and imported from local directories or GitHub repositories. This lets you share squad configurations, duplicate setups, and version-control your agent teams.

## Package Format

Exported packages follow the [Agent Squads specification](/squads/squads-spec) and use a markdown-first structure:

```text
my-squad/
├── SQUAD.md          # Squad metadata
├── agents/
│   ├── squad_lead/AGENT.md    # Agent instructions + frontmatter
│   └── cto/AGENT.md
├── projects/
│   └── main/PROJECT.md
├── skills/
│   └── review/SKILL.md
├── tasks/
│   └── onboarding/TASK.md
└── .slaw.yaml     # Adapter config, env inputs, routines
```

- **SQUAD.md** defines squad name, description, and metadata.
- **AGENT.md** files contain agent identity, role, and instructions.
- **SKILL.md** files are compatible with the Agent Skills ecosystem.
- **.slaw.yaml** holds Slaw-specific config (adapter types, env inputs, budgets) as an optional sidecar.

## Exporting a Squad

Export a squad into a portable folder:

```sh
slaw squad export <squad-id> --out ./my-export
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--out <path>` | Output directory (required) | — |
| `--include <values>` | Comma-separated set: `squad`, `agents`, `projects`, `issues`, `tasks`, `skills` | `squad,agents` |
| `--skills <values>` | Export only specific skill slugs | all |
| `--projects <values>` | Export only specific project shortnames or IDs | all |
| `--issues <values>` | Export specific issue identifiers or IDs | none |
| `--project-issues <values>` | Export issues belonging to specific projects | none |
| `--expand-referenced-skills` | Vendor skill file contents instead of keeping upstream references | `false` |

### Examples

```sh
# Export squad with agents and projects
slaw squad export abc123 --out ./backup --include squad,agents,projects

# Export everything including tasks and skills
slaw squad export abc123 --out ./full-export --include squad,agents,projects,tasks,skills

# Export only specific skills
slaw squad export abc123 --out ./skills-only --include skills --skills review,deploy
```

### What Gets Exported

- Squad name, description, and metadata
- Agent names, roles, reporting structure, and instructions
- Project definitions and workspace config
- Task/issue descriptions (when included)
- Skill packages (as references or vendored content)
- Adapter type and env input declarations in `.slaw.yaml`

Secret values, machine-local paths, and database IDs are **never** exported.

## Importing a Squad

Import from a local directory, GitHub URL, or GitHub shorthand:

```sh
# From a local folder
slaw squad import ./my-export

# From a GitHub URL
slaw squad import https://github.com/org/repo

# From a GitHub subfolder
slaw squad import https://github.com/org/repo/tree/main/squads/acme

# From GitHub shorthand
slaw squad import org/repo
slaw squad import org/repo/squads/acme
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--target <mode>` | `new` (create a new squad) or `existing` (merge into existing) | inferred from context |
| `--squad-id <id>` | Target squad ID for `--target existing` | current context |
| `--new-squad-name <name>` | Override squad name for `--target new` | from package |
| `--include <values>` | Comma-separated set: `squad`, `agents`, `projects`, `issues`, `tasks`, `skills` | auto-detected |
| `--agents <list>` | Comma-separated agent slugs to import, or `all` | `all` |
| `--collision <mode>` | How to handle name conflicts: `rename`, `skip`, or `replace` | `rename` |
| `--ref <value>` | Git ref for GitHub imports (branch, tag, or commit) | default branch |
| `--dry-run` | Preview what would be imported without applying | `false` |
| `--yes` | Skip the interactive confirmation prompt | `false` |
| `--json` | Output result as JSON | `false` |

### Target Modes

- **`new`** — Creates a fresh squad from the package. Good for duplicating a squad template.
- **`existing`** — Merges the package into an existing squad. Use `--squad-id` to specify the target.

If `--target` is not specified, Slaw infers it: if a `--squad-id` is provided (or one exists in context), it defaults to `existing`; otherwise `new`.

### Collision Strategies

When importing into an existing squad, agent or project names may conflict with existing ones:

- **`rename`** (default) — Appends a suffix to avoid conflicts (e.g., `squad_lead` becomes `squad_lead-2`).
- **`skip`** — Skips entities that already exist.
- **`replace`** — Overwrites existing entities. Only available for non-safe imports (not available through the Squad Lead API).

### Interactive Selection

When running interactively (no `--yes` or `--json` flags), the import command shows a selection picker before applying. You can choose exactly which agents, projects, skills, and tasks to import using a checkbox interface.

### Preview Before Applying

Always preview first with `--dry-run`:

```sh
slaw squad import org/repo --target existing --squad-id abc123 --dry-run
```

The preview shows:
- **Package contents** — How many agents, projects, tasks, and skills are in the source
- **Import plan** — What will be created, renamed, skipped, or replaced
- **Env inputs** — Environment variables that may need values after import
- **Warnings** — Potential issues like missing skills or unresolved references

Imported agents always land with timer heartbeats disabled. Assignment/on-demand wake behavior from the package is preserved, but scheduled runs stay off until a board operator re-enables them.

### Common Workflows

**Clone a squad template from GitHub:**

```sh
slaw squad import org/squad-templates/engineering-team \
  --target new \
  --new-squad-name "My Engineering Team"
```

**Add agents from a package into your existing squad:**

```sh
slaw squad import ./shared-agents \
  --target existing \
  --squad-id abc123 \
  --include agents \
  --collision rename
```

**Import a specific branch or tag:**

```sh
slaw squad import org/repo --ref v2.0.0 --dry-run
```

**Non-interactive import (CI/scripts):**

```sh
slaw squad import ./package \
  --target new \
  --yes \
  --json
```

## API Endpoints

The CLI commands use these API endpoints under the hood:

| Action | Endpoint |
|--------|----------|
| Export squad | `POST /api/squads/{squadId}/export` |
| Preview import (existing squad) | `POST /api/squads/{squadId}/imports/preview` |
| Apply import (existing squad) | `POST /api/squads/{squadId}/imports/apply` |
| Preview import (new squad) | `POST /api/squads/import/preview` |
| Apply import (new squad) | `POST /api/squads/import` |

Squad Lead agents can also use the safe import routes (`/imports/preview` and `/imports/apply`) which enforce non-destructive rules: `replace` is rejected, collisions resolve with `rename` or `skip`, and issues are always created as new.

## GitHub Sources

Slaw supports several GitHub URL formats:

- Full URL: `https://github.com/org/repo`
- Subfolder URL: `https://github.com/org/repo/tree/main/path/to/squad`
- Shorthand: `org/repo`
- Shorthand with path: `org/repo/path/to/squad`

Use `--ref` to pin to a specific branch, tag, or commit hash when importing from GitHub.
