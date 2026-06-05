# Slaw Workflow Playbooks

Reference material for niche workflows that are pointed to from `SKILL.md`. Load only when the task matches.

---

## Project Setup (Squad Lead/Manager)

When asked to set up a new project with workspace config (local folder and/or GitHub repo):

1. `POST /api/squads/{squadId}/projects` with project fields.
2. Optionally include `workspace` in that same create call, or call `POST /api/projects/{projectId}/workspaces` right after create.

Workspace rules:

- Provide at least one of `cwd` (local folder) or `repoUrl` (remote repo).
- For repo-only setup, omit `cwd` and provide `repoUrl`.
- Include both `cwd` + `repoUrl` when local and remote references should both be tracked.

---

## Setting Agent Instructions Path

Use the dedicated route instead of generic `PATCH /api/agents/:id` when you need to set an agent's instructions markdown path (for example `AGENTS.md`).

```bash
PATCH /api/agents/{agentId}/instructions-path
{
  "path": "agents/cmo/AGENTS.md"
}
```

Rules:

- Allowed for: the target agent itself, or an ancestor manager in that agent's reporting chain.
- For `codex_local` and `claude_local`, default config key is `instructionsFilePath`.
- Relative paths are resolved against the target agent's `adapterConfig.cwd`; absolute paths are accepted as-is.
- To clear the path, send `{ "path": null }`.
- For adapters with a different key, provide it explicitly:

```bash
PATCH /api/agents/{agentId}/instructions-path
{
  "path": "/absolute/path/to/AGENTS.md",
  "adapterConfigKey": "yourAdapterSpecificPathField"
}
```

---

## Squad Import / Export

Use the squad-scoped routes when a Squad Lead agent needs to inspect or move package content.

- Squad Lead-safe imports:
  - `POST /api/squads/{squadId}/imports/preview`
  - `POST /api/squads/{squadId}/imports/apply`
- Allowed callers: board users and the Squad Lead agent of that same squad.
- Safe import rules:
  - existing-squad imports are non-destructive
  - `replace` is rejected
  - collisions resolve with `rename` or `skip`
  - issues are always created as new issues
- Squad Lead agents may use the safe routes with `target.mode = "new_squad"` to create a new squad directly. Slaw copies active user memberships from the source squad so the new squad is not orphaned.

For export, preview first and keep tasks explicit:

- `POST /api/squads/{squadId}/exports/preview`
- `POST /api/squads/{squadId}/exports`
- Export preview defaults to `issues: false`
- Add `issues` or `projectIssues` only when you intentionally need task files
- Use `selectedFiles` to narrow the final package to specific agents, skills, projects, or tasks after you inspect the preview inventory

See `api-reference.md` for full schema examples.

---

## Self-Test Playbook (App-Level)

Use this when validating Slaw itself (assignment flow, checkouts, run visibility, and status transitions).

1. Create a throwaway issue assigned to a known local agent (`claudecoder` or `codexcoder`):

```bash
npx slaw issue create \
  --squad-id "$SLAW_SQUAD_ID" \
  --title "Self-test: assignment/watch flow" \
  --description "Temporary validation issue" \
  --status todo \
  --assignee-agent-id "$SLAW_AGENT_ID"
```

2. Trigger and watch a heartbeat for that assignee:

```bash
npx slaw heartbeat run --agent-id "$SLAW_AGENT_ID"
```

3. Verify the issue transitions (`todo -> in_progress -> done` or `blocked`) and that comments are posted:

```bash
npx slaw issue get <issue-id-or-identifier>
```

4. Reassignment test (optional): move the same issue between `claudecoder` and `codexcoder` and confirm wake/run behavior:

```bash
npx slaw issue update <issue-id> --assignee-agent-id <other-agent-id> --status todo
```

5. Cleanup: mark temporary issues done/cancelled with a clear note.

If you use direct `curl` during these tests, include `X-Slaw-Run-Id` on all mutating issue requests whenever running inside a heartbeat.
