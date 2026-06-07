# @slaw/plugin-jira-sync

Bidirectional sync between a Jira board and a Slaw squad.

## Sync directions

- **Jira → Slaw** — real-time via the `jira-event` webhook, plus an hourly
  `full-sync` job that reconciles the whole board. New Jira issues become Slaw
  issues stamped with `originKind = plugin:slaw.jira-sync:issue` and
  `originId = <JIRA-KEY>`. Deduplication is keyed on the Jira issue key via the
  plugin-owned `jira_issue_mappings` table, so an issue is never created twice.
- **Slaw → Jira** — on `issue.updated`, completion (`done`/`cancelled`) is always
  reflected back to Jira with a summary comment. Other status changes are pushed
  only when `syncStatusBack` is enabled on the instance.

## Managed resources

Provisioning is declarative — the manifest declares a **managed agent**
(`jira-sync-agent`) and a **managed routine** (`jira-full-sync`, hourly). The
host hires the agent and creates the routine when an operator installs the plugin
into a squad; both start paused so the operator opts in. There is no separate
setup script.

## Configuration (per instance)

| Key | Required | Description |
| --- | --- | --- |
| `jiraUrl` | yes | Jira site base URL, e.g. `https://acme.atlassian.net` |
| `jiraBoardId` | yes | Numeric board id |
| `jiraUsername` | yes | Atlassian account email (Basic auth) |
| `jiraApiTokenRef` | yes | Name of the Slaw secret holding the Jira API token |
| `targetSquadId` | yes | Squad mirrored issues are created in |
| `targetProjectId` | no | Project for mirrored issues |
| `targetAssigneeAgentId` | no | Agent assigned to mirrored issues (unassigned if omitted) |
| `syncStatusBack` | no | Push all status changes back to Jira (default: completion only) |

## Webhook

The host exposes `POST /api/plugins/<pluginId>/webhooks/jira-event`. Register that
URL in Jira (Settings → System → Webhooks) for issue created/updated events.

## The skill

The operator-facing "how to connect a Jira board" knowledge lives in the
**Botfather standard skills catalog** (`jira-board-sync`), governed by the control
tower, not bundled here — consistent with Slaw's skill-governance model.
