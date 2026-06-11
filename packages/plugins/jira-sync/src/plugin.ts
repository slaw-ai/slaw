import { definePlugin, type PluginContext } from "@slaw-ai/plugin-sdk";

import {
  COMPLETION_STATUSES,
  DEFAULT_SLAW_PRIORITY,
  DEFAULT_SLAW_STATUS,
  JOB_KEYS,
  ORIGIN_KIND,
  PRIORITY_MAP,
  SLAW_STATUS_TO_JIRA_TRANSITION,
  STATE,
  STATUS_MAP,
  WEBHOOK_KEYS,
} from "./constants.js";
import { JiraClient, type JiraIssue } from "./jira-client.js";
import { findByJiraKey, findBySlawIssueId, insertMapping, touchMapping } from "./mappings.js";

interface JiraSyncConfig {
  jiraUrl: string;
  jiraBoardId: string;
  jiraUsername: string;
  jiraApiTokenRef: string;
  targetSquadId: string;
  targetProjectId?: string;
  targetAssigneeAgentId?: string;
  syncStatusBack?: boolean;
}

/**
 * Module-level handle to the live context so the webhook handler (which is a
 * top-level plugin method, not a closure created in `setup`) can reach the
 * host APIs.
 */
let currentContext: PluginContext | null = null;

function readConfig(raw: Record<string, unknown>): JiraSyncConfig {
  return {
    jiraUrl: String(raw.jiraUrl ?? ""),
    jiraBoardId: String(raw.jiraBoardId ?? ""),
    jiraUsername: String(raw.jiraUsername ?? ""),
    jiraApiTokenRef: String(raw.jiraApiTokenRef ?? ""),
    targetSquadId: String(raw.targetSquadId ?? ""),
    targetProjectId: raw.targetProjectId ? String(raw.targetProjectId) : undefined,
    targetAssigneeAgentId: raw.targetAssigneeAgentId ? String(raw.targetAssigneeAgentId) : undefined,
    syncStatusBack: raw.syncStatusBack === true,
  };
}

async function buildClient(ctx: PluginContext, config: JiraSyncConfig): Promise<JiraClient> {
  const apiToken = await ctx.secrets.resolve(config.jiraApiTokenRef);
  return new JiraClient({
    baseUrl: config.jiraUrl,
    boardId: config.jiraBoardId,
    username: config.jiraUsername,
    apiToken,
    fetch: (url, init) => ctx.http.fetch(url, init),
  });
}

function mapPriority(jiraPriorityName: string | undefined | null): string {
  if (!jiraPriorityName) return DEFAULT_SLAW_PRIORITY;
  return PRIORITY_MAP[jiraPriorityName] ?? DEFAULT_SLAW_PRIORITY;
}

function mapStatus(jiraStatusName: string | undefined | null): string {
  if (!jiraStatusName) return DEFAULT_SLAW_STATUS;
  return STATUS_MAP[jiraStatusName] ?? DEFAULT_SLAW_STATUS;
}

/**
 * Create a Slaw issue for a Jira issue if it does not already exist.
 * Idempotent: keyed on the Jira issue key via the mapping table.
 */
async function syncJiraIssue(
  ctx: PluginContext,
  config: JiraSyncConfig,
  issue: JiraIssue,
): Promise<"created" | "skipped"> {
  const existing = await findByJiraKey(ctx.db, issue.key);
  if (existing) {
    await touchMapping(ctx.db, issue.key);
    return "skipped";
  }

  const created = await ctx.issues.create({
    squadId: config.targetSquadId,
    projectId: config.targetProjectId,
    title: `[${issue.key}] ${issue.fields.summary}`,
    description: issue.fields.description ?? undefined,
    priority: mapPriority(issue.fields.priority?.name) as never,
    status: mapStatus(issue.fields.status?.name) as never,
    assigneeAgentId: config.targetAssigneeAgentId,
    originKind: ORIGIN_KIND,
    originId: issue.key,
  });

  await insertMapping(ctx.db, created.id, issue.key, issue.id);

  const link = `${config.jiraUrl.replace(/\/+$/, "")}/browse/${issue.key}`;
  await ctx.issues.createComment(created.id, `Synced from Jira: ${link}`, config.targetSquadId);

  await ctx.activity.log({
    squadId: config.targetSquadId,
    message: `Created Slaw issue from Jira ${issue.key}`,
    entityType: "issue",
    entityId: created.id,
    metadata: { jiraKey: issue.key, jiraId: issue.id },
  });

  return "created";
}

/** Reflect a Slaw status change back into Jira. */
async function pushStatusToJira(
  ctx: PluginContext,
  config: JiraSyncConfig,
  jiraKey: string,
  slawStatus: string,
  issue: { identifier?: string | null; title: string; occurredAt: string },
): Promise<void> {
  const client = await buildClient(ctx, config);
  const transitionName = SLAW_STATUS_TO_JIRA_TRANSITION[slawStatus];
  if (!transitionName) return;

  const applied = await client.updateIssueStatus(jiraKey, transitionName);
  if (!applied) {
    ctx.logger.warn("No matching Jira transition", { jiraKey, slawStatus, transitionName });
  }

  if (COMPLETION_STATUSES.has(slawStatus)) {
    const verb = slawStatus === "done" ? "done" : "cancelled";
    await client.addComment(jiraKey, [
      `Issue ${verb} in Slaw (${issue.identifier ?? jiraKey})`,
      `Title: ${issue.title}`,
      `Status: ${slawStatus}`,
      `Completed at: ${issue.occurredAt}`,
    ]);
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    ctx.logger.info("jira-sync plugin setup");

    // Slaw → Jira: reflect status changes for issues that originated from Jira.
    ctx.events.on("issue.updated", async (event) => {
      const config = readConfig(await ctx.config.get());
      const payload = (event.payload ?? {}) as { issueId?: string };
      const slawIssueId = payload.issueId ?? event.entityId;
      if (!slawIssueId) return;

      const mapping = await findBySlawIssueId(ctx.db, slawIssueId);
      if (!mapping) return; // Not a Jira-originated issue.

      // Read authoritative state from the host rather than trusting the
      // event payload shape (status/title may not be embedded).
      const issue = await ctx.issues.get(slawIssueId, config.targetSquadId);
      if (!issue) return;
      const slawStatus = String(issue.status);

      const isCompletion = COMPLETION_STATUSES.has(slawStatus);
      if (!isCompletion && !config.syncStatusBack) return;

      await pushStatusToJira(ctx, config, mapping.jira_key, slawStatus, {
        identifier: issue.identifier ?? null,
        title: issue.title,
        occurredAt: event.occurredAt,
      });
    });

    // Jira → Slaw: hourly full reconciliation of the board.
    ctx.jobs.register(JOB_KEYS.fullSync, async () => {
      const config = readConfig(await ctx.config.get());
      const client = await buildClient(ctx, config);
      const issues = await client.getBoardIssues();
      let created = 0;
      let skipped = 0;
      for (const issue of issues) {
        const result = await syncJiraIssue(ctx, config, issue);
        if (result === "created") created += 1;
        else skipped += 1;
      }
      await ctx.state.set(
        { scopeKind: "instance", namespace: STATE.namespace, stateKey: STATE.lastSyncKey },
        { at: new Date().toISOString(), total: issues.length, created, skipped },
      );
      ctx.logger.info("jira-sync full sync complete", { total: issues.length, created, skipped });
    });
  },

  // Jira → Slaw: real-time webhook for created/updated issues.
  async onWebhook(input) {
    if (input.endpointKey !== WEBHOOK_KEYS.jiraEvent) return;
    const ctx = currentContext;
    if (!ctx) {
      throw new Error("jira-sync webhook received before setup completed");
    }
    const config = readConfig(await ctx.config.get());

    const body = (input.parsedBody ?? safeJson(input.rawBody)) as {
      webhookEvent?: string;
      issue?: JiraIssue;
    };
    const issue = body.issue;
    if (!issue?.key) {
      ctx.logger.warn("jira-sync webhook missing issue payload", { requestId: input.requestId });
      return;
    }
    await syncJiraIssue(ctx, config, issue);
  },

  async onHealth() {
    return { status: "ok", message: "jira-sync ready" };
  },
});

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default plugin;
export { syncJiraIssue, readConfig };
