import type { SlawPluginManifestV1 } from "@slaw/plugin-sdk";
import { JOB_KEYS, MANAGED, PLUGIN_ID, PLUGIN_VERSION, WEBHOOK_KEYS, DB_NAMESPACE_SLUG } from "./constants.js";

/**
 * Instructions injected into the managed Jira Sync agent. The host writes this
 * as the agent's AGENTS.md when it reconciles the managed agent into a squad.
 */
const AGENT_INSTRUCTIONS = `# Jira Sync Agent

You keep a single Jira board in sync with this Slaw squad.

## Responsibilities
- Mirror Jira issues into Slaw tasks (the \`slaw.jira-sync\` plugin does the
  mechanical sync; you supervise, triage, and resolve exceptions).
- When a Slaw task that originated from Jira is completed or cancelled, confirm
  the status was reflected back to Jira and a summary comment was posted.
- Investigate and report sync failures (auth errors, missing transitions,
  rate limits) rather than silently retrying forever.

## How sync works
- **Jira → Slaw:** real-time via the plugin's \`jira-event\` webhook, plus an
  hourly \`full-sync\` job that reconciles the whole board. New Jira issues
  become Slaw issues stamped with \`originKind = plugin:slaw.jira-sync:issue\`
  and \`originId = <JIRA-KEY>\` so they are never duplicated.
- **Slaw → Jira:** on \`issue.updated\`, completion (done/cancelled) is always
  reflected back to Jira with a summary comment. Other status changes are only
  pushed when the operator enabled \`syncStatusBack\`.

## Handling Jira API errors
- 401/403: the API token is invalid or lacks board access — surface to the
  operator; do not loop.
- 404 on a transition: the Jira workflow has no matching transition for the
  target status — note it on the Slaw issue and move on.
- 429: back off; the next hourly full-sync will reconcile.

One agent per board. The board is configured on the plugin instance, not here.`;

const manifest: SlawPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Jira Sync",
  description:
    "Bidirectional sync between a Jira board and Slaw issues. Receives Jira webhooks and an hourly reconciliation job to mirror issues into Slaw, and reflects Slaw completion (and optionally all status changes) back to Jira.",
  author: "Slaw",
  categories: ["connector", "automation"],
  capabilities: [
    "squads.read",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.create",
    "events.subscribe",
    "jobs.schedule",
    "webhooks.receive",
    "http.outbound",
    "secrets.read-ref",
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "plugin.state.read",
    "plugin.state.write",
    "activity.log.write",
    "routines.managed",
    "agents.managed",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  database: {
    namespaceSlug: DB_NAMESPACE_SLUG,
    migrationsDir: "migrations",
    coreReadTables: ["squads", "issues"],
  },
  instanceConfigSchema: {
    type: "object",
    required: ["jiraUrl", "jiraBoardId", "jiraUsername", "jiraApiTokenRef", "targetSquadId"],
    properties: {
      jiraUrl: {
        type: "string",
        description: "Base URL of the Jira site, e.g. https://acme.atlassian.net",
      },
      jiraBoardId: {
        type: "string",
        description: "Numeric id of the Jira board to sync.",
      },
      jiraUsername: {
        type: "string",
        description: "Atlassian account email used for Basic auth.",
      },
      jiraApiTokenRef: {
        type: "string",
        description: "Name of the Slaw secret holding the Jira API token.",
      },
      targetSquadId: {
        type: "string",
        description: "Slaw squad that mirrored Jira issues are created in.",
      },
      targetProjectId: {
        type: "string",
        description: "Optional Slaw project for mirrored issues.",
      },
      targetAssigneeAgentId: {
        type: "string",
        description: "Optional Slaw agent assigned to mirrored issues. If omitted, issues are unassigned.",
      },
      syncStatusBack: {
        type: "boolean",
        default: false,
        description:
          "When true, all Slaw status changes are pushed to Jira. When false, only completion (done/cancelled) is reflected back.",
      },
    },
  },
  webhooks: [
    {
      endpointKey: WEBHOOK_KEYS.jiraEvent,
      displayName: "Jira Issue Event",
      description: "Receives Jira issue created/updated webhook deliveries for real-time sync.",
    },
  ],
  jobs: [
    {
      jobKey: JOB_KEYS.fullSync,
      displayName: "Full Jira Board Sync",
      description:
        "Fetches all issues from the configured Jira board and creates any missing Slaw issues.",
      schedule: "0 * * * *",
    },
  ],
  agents: [
    {
      agentKey: MANAGED.agentKey,
      displayName: "Jira Sync Agent",
      role: "engineer",
      title: "Jira Board Sync",
      adapterType: "claude_local",
      status: "paused",
      budgetMonthlyCents: 0,
      capabilities: "Monitors a Jira board and keeps Slaw issues in sync in both directions.",
      instructions: {
        content: AGENT_INSTRUCTIONS,
      },
    },
  ],
  routines: [
    {
      routineKey: MANAGED.routineKey,
      title: "Reconcile Jira board",
      description: "Hourly full reconciliation of the configured Jira board into Slaw.",
      assigneeRef: { resourceKind: "agent", resourceKey: MANAGED.agentKey },
      status: "paused",
      priority: "medium",
      concurrencyPolicy: "skip_if_active",
      catchUpPolicy: "skip_missed",
      triggers: [
        {
          kind: "schedule",
          label: "Hourly",
          enabled: false,
          cronExpression: "0 * * * *",
          timezone: "UTC",
          signingMode: null,
          replayWindowSec: null,
        },
      ],
    },
  ],
};

export default manifest;
