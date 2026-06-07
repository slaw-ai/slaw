/**
 * CRUD helpers over the plugin-namespaced `jira_issue_mappings` table.
 *
 * The host derives the schema name from the plugin id; `ctx.db.namespace`
 * resolves to it at runtime (e.g. `plugin_jira_sync_58648c8018`). All table
 * references are qualified with that namespace.
 */

import type { PluginDatabaseClient } from "@slaw/plugin-sdk";

export interface JiraIssueMapping {
  id: number;
  slaw_issue_id: string;
  jira_key: string;
  jira_id: string;
  created_at: string;
  last_seen_at: string;
}

function table(db: PluginDatabaseClient): string {
  return `${db.namespace}.jira_issue_mappings`;
}

export async function findByJiraKey(
  db: PluginDatabaseClient,
  jiraKey: string,
): Promise<JiraIssueMapping | null> {
  const rows = await db.query<JiraIssueMapping>(
    `SELECT * FROM ${table(db)} WHERE jira_key = $1 LIMIT 1`,
    [jiraKey],
  );
  return rows[0] ?? null;
}

export async function findBySlawIssueId(
  db: PluginDatabaseClient,
  slawIssueId: string,
): Promise<JiraIssueMapping | null> {
  const rows = await db.query<JiraIssueMapping>(
    `SELECT * FROM ${table(db)} WHERE slaw_issue_id = $1 LIMIT 1`,
    [slawIssueId],
  );
  return rows[0] ?? null;
}

export async function insertMapping(
  db: PluginDatabaseClient,
  slawIssueId: string,
  jiraKey: string,
  jiraId: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO ${table(db)} (slaw_issue_id, jira_key, jira_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (jira_key) DO UPDATE
       SET slaw_issue_id = EXCLUDED.slaw_issue_id,
           jira_id = EXCLUDED.jira_id,
           last_seen_at = NOW()`,
    [slawIssueId, jiraKey, jiraId],
  );
}

export async function touchMapping(db: PluginDatabaseClient, jiraKey: string): Promise<void> {
  await db.execute(`UPDATE ${table(db)} SET last_seen_at = NOW() WHERE jira_key = $1`, [jiraKey]);
}
