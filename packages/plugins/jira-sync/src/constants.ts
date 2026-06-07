/**
 * Stable identifiers and value mappings for the Jira Sync plugin.
 *
 * The plugin id drives the host-derived database namespace and the
 * `originKind` used to deduplicate Slaw issues mirrored from Jira.
 */

export const PLUGIN_ID = "slaw.jira-sync";
export const PLUGIN_VERSION = "0.1.0";

/** Slug component of the host-derived DB namespace (`plugin_jira_sync_<hash>`). */
export const DB_NAMESPACE_SLUG = "jira_sync";

/**
 * `originKind` stamped on every Slaw issue created from a Jira issue.
 * Combined with `originId` (the Jira issue key) this lets the host and the
 * plugin recognise issues that already originate from Jira and avoid
 * re-creating or echoing them back.
 *
 * Must be of the form `plugin:${string}` (PluginIssueOriginKind).
 */
export const ORIGIN_KIND = `plugin:${PLUGIN_ID}:issue` as const;

export const JOB_KEYS = {
  /** Hourly full reconciliation of the configured Jira board. */
  fullSync: "full-sync",
} as const;

export const WEBHOOK_KEYS = {
  /** Receives Jira issue created/updated webhook deliveries. */
  jiraEvent: "jira-event",
} as const;

/** Stable manifest keys for the managed agent and routine. */
export const MANAGED = {
  agentKey: "jira-sync-agent",
  routineKey: "jira-full-sync",
} as const;

/** State namespace/key used to record the last successful full sync. */
export const STATE = {
  namespace: "jira-sync",
  lastSyncKey: "last-full-sync",
} as const;

/** Map Jira priority names → Slaw issue priority. */
export const PRIORITY_MAP: Record<string, string> = {
  Highest: "critical",
  High: "high",
  Medium: "medium",
  Low: "low",
  Lowest: "low",
};

/** Map Jira status names → Slaw issue status. */
export const STATUS_MAP: Record<string, string> = {
  "To Do": "todo",
  "In Progress": "in_progress",
  "In Review": "in_review",
  Done: "done",
  Blocked: "blocked",
  Cancelled: "cancelled",
};

/** Slaw statuses that represent terminal completion. */
export const COMPLETION_STATUSES = new Set(["done", "cancelled"]);

/**
 * Reverse lookup: Slaw status → preferred Jira transition (target status)
 * name. Used when reflecting Slaw status changes back into Jira.
 */
export const SLAW_STATUS_TO_JIRA_TRANSITION: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

export const DEFAULT_SLAW_PRIORITY = "medium";
export const DEFAULT_SLAW_STATUS = "todo";
