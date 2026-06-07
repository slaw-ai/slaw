import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  squads,
  createDb,
  documentRevisions,
  documents,
  environments,
  executionWorkspaces,
  goals,
  heartbeatRuns,
  instanceSettings,
  issueComments,
  issueInboxArchives,
  issueDocuments,
  issuePlanDecompositions,
  issueRelations,
  issueThreadInteractions,
  issues,
  projectWorkspaces,
  projects,
  workspaceOperations,
} from "@slaw/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.ts";
import {
  clampIssueListLimit,
  deriveIssueCommentRunLogAttribution,
  ISSUE_LIST_MAX_LIMIT,
  issueService,
} from "../services/issues.ts";
import { buildProjectMentionHref, MAX_ISSUE_REQUEST_DEPTH } from "@slaw/shared";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describe("issue list limit helpers", () => {
  it("clamps untrusted issue-list limits to the server maximum", () => {
    expect(clampIssueListLimit(0)).toBe(1);
    expect(clampIssueListLimit(25.9)).toBe(25);
    expect(clampIssueListLimit(ISSUE_LIST_MAX_LIMIT + 10)).toBe(ISSUE_LIST_MAX_LIMIT);
  });
});

describe("deriveIssueCommentRunLogAttribution", () => {
  it("recovers agent attribution from run logs that printed the posted comment id", () => {
    const commentId = randomUUID();
    const runId = randomUUID();
    const agentId = randomUUID();

    const derived = deriveIssueCommentRunLogAttribution(
      [
        {
          id: commentId,
          authorAgentId: null,
          authorUserId: "user-1",
          createdByRunId: null,
          createdAt: new Date("2026-05-11T18:55:40.090Z"),
        },
      ],
      [
        {
          runId,
          agentId,
          createdAt: new Date("2026-05-11T18:51:56.246Z"),
          startedAt: new Date("2026-05-11T18:51:56.257Z"),
          finishedAt: new Date("2026-05-11T18:55:45.600Z"),
          logContent: `comment id: ${commentId}\n`,
        },
      ],
    );

    expect(derived.get(commentId)).toEqual({
      derivedAuthorAgentId: agentId,
      derivedCreatedByRunId: runId,
      derivedAuthorSource: "run_log_comment_post",
    });
  });

  it("does not rewrite comments without exact run-log proof", () => {
    const commentId = randomUUID();
    const derived = deriveIssueCommentRunLogAttribution(
      [
        {
          id: commentId,
          authorAgentId: null,
          authorUserId: "user-1",
          createdByRunId: null,
          createdAt: new Date("2026-05-11T18:55:40.090Z"),
        },
      ],
      [
        {
          runId: randomUUID(),
          agentId: randomUUID(),
          createdAt: new Date("2026-05-11T18:51:56.246Z"),
          startedAt: new Date("2026-05-11T18:51:56.257Z"),
          finishedAt: new Date("2026-05-11T18:55:45.600Z"),
          logContent: "posted results without echoing the comment id",
        },
      ],
    );

    expect(derived.has(commentId)).toBe(false);
  });
});

async function ensureIssueRelationsTable(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "issue_relations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "squad_id" uuid NOT NULL,
      "issue_id" uuid NOT NULL,
      "related_issue_id" uuid NOT NULL,
      "type" text NOT NULL,
      "created_by_agent_id" uuid,
      "created_by_user_id" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `));
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issueService.list participantAgentId", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-issues-service-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns issues an agent participated in across the supported signals", async () => {
    const squadId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: agentId,
        squadId,
        name: "CodexCoder",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherAgentId,
        squadId,
        name: "OtherAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    const assignedIssueId = randomUUID();
    const createdIssueId = randomUUID();
    const commentedIssueId = randomUUID();
    const activityIssueId = randomUUID();
    const excludedIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: assignedIssueId,
        squadId,
        title: "Assigned issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        createdByAgentId: otherAgentId,
      },
      {
        id: createdIssueId,
        squadId,
        title: "Created issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: agentId,
      },
      {
        id: commentedIssueId,
        squadId,
        title: "Commented issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: otherAgentId,
      },
      {
        id: activityIssueId,
        squadId,
        title: "Activity issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: otherAgentId,
      },
      {
        id: excludedIssueId,
        squadId,
        title: "Excluded issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: otherAgentId,
        assigneeAgentId: otherAgentId,
      },
    ]);

    await db.insert(issueComments).values({
      squadId,
      issueId: commentedIssueId,
      authorAgentId: agentId,
      body: "Investigating this issue.",
    });

    await db.insert(activityLog).values({
      squadId,
      actorType: "agent",
      actorId: agentId,
      action: "issue.updated",
      entityType: "issue",
      entityId: activityIssueId,
      agentId,
      details: { changed: true },
    });

    const result = await svc.list(squadId, { participantAgentId: agentId });
    const resultIds = new Set(result.map((issue) => issue.id));

    expect(resultIds).toEqual(new Set([
      assignedIssueId,
      createdIssueId,
      commentedIssueId,
      activityIssueId,
    ]));
    expect(resultIds.has(excludedIssueId)).toBe(false);
  });

  it("combines participation filtering with search", async () => {
    const squadId = randomUUID();
    const agentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      squadId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const matchedIssueId = randomUUID();
    const otherIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: matchedIssueId,
        squadId,
        title: "Invoice reconciliation",
        status: "todo",
        priority: "medium",
        createdByAgentId: agentId,
      },
      {
        id: otherIssueId,
        squadId,
        title: "Weekly planning",
        status: "todo",
        priority: "medium",
        createdByAgentId: agentId,
      },
    ]);

    const result = await svc.list(squadId, {
      participantAgentId: agentId,
      q: "invoice",
    });

    expect(result.map((issue) => issue.id)).toEqual([matchedIssueId]);
  });

  it("applies result limits to issue search", async () => {
    const squadId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    const exactIdentifierId = randomUUID();
    const titleMatchId = randomUUID();
    const descriptionMatchId = randomUUID();

    await db.insert(issues).values([
      {
        id: exactIdentifierId,
        squadId,
        issueNumber: 42,
        identifier: "PAP-42",
        title: "Completely unrelated",
        status: "todo",
        priority: "medium",
      },
      {
        id: titleMatchId,
        squadId,
        title: "Search ranking issue",
        status: "todo",
        priority: "medium",
      },
      {
        id: descriptionMatchId,
        squadId,
        title: "Another item",
        description: "Contains the search keyword",
        status: "todo",
        priority: "medium",
      },
    ]);

    const result = await svc.list(squadId, {
      q: "search",
      limit: 2,
    });

    expect(result.map((issue) => issue.id)).toEqual([titleMatchId, descriptionMatchId]);
  });

  it("can page issues by most recently updated before priority", async () => {
    const squadId = randomUUID();
    const oldCriticalIssueId = randomUUID();
    const recentMediumIssueId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values([
      {
        id: oldCriticalIssueId,
        squadId,
        title: "Old critical issue",
        status: "todo",
        priority: "critical",
        updatedAt: new Date("2026-05-01T10:00:00.000Z"),
      },
      {
        id: recentMediumIssueId,
        squadId,
        title: "Recent medium issue",
        status: "todo",
        priority: "medium",
        updatedAt: new Date("2026-05-17T21:12:29.993Z"),
      },
    ]);

    const result = await svc.list(squadId, {
      limit: 1,
      sortField: "updated",
      sortDir: "desc",
    });

    expect(result.map((issue) => issue.id)).toEqual([recentMediumIssueId]);
  });

  it("ranks comment matches ahead of description-only matches", async () => {
    const squadId = randomUUID();
    const commentMatchId = randomUUID();
    const descriptionMatchId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values([
      {
        id: commentMatchId,
        squadId,
        title: "Comment match",
        status: "todo",
        priority: "medium",
      },
      {
        id: descriptionMatchId,
        squadId,
        title: "Description match",
        description: "Contains pull/3303 in the description",
        status: "todo",
        priority: "medium",
      },
    ]);

    await db.insert(issueComments).values({
      squadId,
      issueId: commentMatchId,
      body: "Reference: https://github.com/slaw/slaw/pull/3303",
    });

    const result = await svc.list(squadId, {
      q: "pull/3303",
      limit: 2,
      includeRoutineExecutions: true,
    });

    expect(result.map((issue) => issue.id)).toEqual([commentMatchId, descriptionMatchId]);
  });

  it("filters issue lists to the full descendant tree for a root issue", async () => {
    const squadId = randomUUID();
    const rootId = randomUUID();
    const childId = randomUUID();
    const grandchildId = randomUUID();
    const siblingId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values([
      {
        id: rootId,
        squadId,
        title: "Root",
        status: "todo",
        priority: "medium",
      },
      {
        id: childId,
        squadId,
        parentId: rootId,
        title: "Child",
        status: "todo",
        priority: "medium",
      },
      {
        id: grandchildId,
        squadId,
        parentId: childId,
        title: "Grandchild",
        status: "todo",
        priority: "medium",
      },
      {
        id: siblingId,
        squadId,
        title: "Sibling",
        status: "todo",
        priority: "medium",
      },
    ]);

    const result = await svc.list(squadId, { descendantOf: rootId });

    expect(new Set(result.map((issue) => issue.id))).toEqual(new Set([childId, grandchildId]));
  });

  it("combines descendant filtering with search", async () => {
    const squadId = randomUUID();
    const rootId = randomUUID();
    const childId = randomUUID();
    const grandchildId = randomUUID();
    const outsideMatchId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values([
      {
        id: rootId,
        squadId,
        title: "Root",
        status: "todo",
        priority: "medium",
      },
      {
        id: childId,
        squadId,
        parentId: rootId,
        title: "Relevant parent",
        status: "todo",
        priority: "medium",
      },
      {
        id: grandchildId,
        squadId,
        parentId: childId,
        title: "Needle grandchild",
        status: "todo",
        priority: "medium",
      },
      {
        id: outsideMatchId,
        squadId,
        title: "Needle outside",
        status: "todo",
        priority: "medium",
      },
    ]);

    const result = await svc.list(squadId, { descendantOf: rootId, q: "needle" });

    expect(result.map((issue) => issue.id)).toEqual([grandchildId]);
  });

  it("accepts issue identifiers with alphanumeric prefixes through getById", async () => {
    const squadId = randomUUID();
    const issueId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: "PC1A2",
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values({
      id: issueId,
      squadId,
      issueNumber: 1064,
      identifier: "PC1A2-1064",
      title: "Feedback votes error",
      status: "todo",
      priority: "medium",
      createdByUserId: "user-1",
    });

    const issue = await svc.getById("pc1a2-1064");

    expect(issue).toEqual(
      expect.objectContaining({
        id: issueId,
        identifier: "PC1A2-1064",
      }),
    );
  });

  it("returns null instead of throwing for malformed non-uuid issue refs", async () => {
    await expect(svc.getById("not-a-uuid")).resolves.toBeNull();
  });
  it("filters issues by execution workspace id", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const targetWorkspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const linkedIssueId = randomUUID();
    const otherLinkedIssueId = randomUUID();
    const unlinkedIssueId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(executionWorkspaces).values([
      {
        id: targetWorkspaceId,
        squadId,
        projectId,
        mode: "shared_workspace",
        strategyType: "project_primary",
        name: "Target workspace",
        status: "active",
        providerType: "local_fs",
      },
      {
        id: otherWorkspaceId,
        squadId,
        projectId,
        mode: "shared_workspace",
        strategyType: "project_primary",
        name: "Other workspace",
        status: "active",
        providerType: "local_fs",
      },
    ]);

    await db.insert(issues).values([
      {
        id: linkedIssueId,
        squadId,
        projectId,
        title: "Linked issue",
        status: "todo",
        priority: "medium",
        executionWorkspaceId: targetWorkspaceId,
      },
      {
        id: otherLinkedIssueId,
        squadId,
        projectId,
        title: "Other linked issue",
        status: "todo",
        priority: "medium",
        executionWorkspaceId: otherWorkspaceId,
      },
      {
        id: unlinkedIssueId,
        squadId,
        projectId,
        title: "Unlinked issue",
        status: "todo",
        priority: "medium",
      },
    ]);

    const result = await svc.list(squadId, { executionWorkspaceId: targetWorkspaceId });

    expect(result.map((issue) => issue.id)).toEqual([linkedIssueId]);
  });

  it("filters issues by generic workspace id across execution and project workspace links", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();
    const executionLinkedIssueId = randomUUID();
    const projectLinkedIssueId = randomUUID();
    const otherIssueId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Feature workspace",
      sourceType: "local_path",
      visibility: "default",
      isPrimary: false,
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      squadId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Execution workspace",
      status: "active",
      providerType: "git_worktree",
    });

    await db.insert(issues).values([
      {
        id: executionLinkedIssueId,
        squadId,
        projectId,
        projectWorkspaceId,
        title: "Execution linked issue",
        status: "done",
        priority: "medium",
        executionWorkspaceId,
      },
      {
        id: projectLinkedIssueId,
        squadId,
        projectId,
        projectWorkspaceId,
        title: "Project linked issue",
        status: "todo",
        priority: "medium",
      },
      {
        id: otherIssueId,
        squadId,
        projectId,
        title: "Other issue",
        status: "todo",
        priority: "medium",
      },
    ]);

    const executionResult = await svc.list(squadId, { workspaceId: executionWorkspaceId });
    const projectResult = await svc.list(squadId, { workspaceId: projectWorkspaceId });

    expect(executionResult.map((issue) => issue.id)).toEqual([executionLinkedIssueId]);
    expect(projectResult.map((issue) => issue.id).sort()).toEqual([executionLinkedIssueId, projectLinkedIssueId].sort());
  });

  it("hides plugin operation issues from default lists and inbox-style filters while preserving explicit retrieval", async () => {
    const squadId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const normalIssueId = randomUUID();
    const pluginVisibleIssueId = randomUUID();
    const operationIssueId = randomUUID();
    const typedOperationIssueId = randomUUID();
    const legacyContentMachineOperationIssueId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      squadId,
      name: "Plugin Runner",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Plugin operations",
      status: "in_progress",
    });
    await db.insert(issues).values([
      {
        id: normalIssueId,
        squadId,
        title: "Normal issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
      },
      {
        id: pluginVisibleIssueId,
        squadId,
        title: "Plugin-visible issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        originKind: "plugin:slaw.missions:feature",
      },
      {
        id: operationIssueId,
        squadId,
        projectId,
        title: "Plugin operation issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        originKind: "plugin:slaw.missions:operation",
        originId: "mission-alpha:operation-1",
      },
      {
        id: typedOperationIssueId,
        squadId,
        projectId,
        title: "Typed plugin operation issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        originKind: "plugin:slaw.missions:operation:evaluation",
        originId: "mission-alpha:operation-2",
      },
      {
        id: legacyContentMachineOperationIssueId,
        squadId,
        projectId,
        title: "Legacy Content Machine operation issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        originKind: "plugin:slaw.content-machine:evaluation",
        originId: "content-machine-operation-1",
      },
    ]);

    const defaultIssueIds = (await svc.list(squadId)).map((issue) => issue.id);
    expect(defaultIssueIds).toContain(normalIssueId);
    expect(defaultIssueIds).toContain(pluginVisibleIssueId);
    expect(defaultIssueIds).not.toContain(operationIssueId);
    expect(defaultIssueIds).not.toContain(typedOperationIssueId);
    expect(defaultIssueIds).not.toContain(legacyContentMachineOperationIssueId);

    const inboxIssueIds = (await svc.list(squadId, {
      assigneeAgentId: agentId,
      status: "todo,in_progress,blocked",
      includeRoutineExecutions: true,
    })).map((issue) => issue.id);
    expect(inboxIssueIds).toContain(normalIssueId);
    expect(inboxIssueIds).not.toContain(operationIssueId);
    expect(inboxIssueIds).not.toContain(typedOperationIssueId);
    expect(inboxIssueIds).not.toContain(legacyContentMachineOperationIssueId);

    await expect(svc.list(squadId, { originKind: "plugin:slaw.missions:operation" }))
      .resolves.toEqual([expect.objectContaining({ id: operationIssueId })]);
    await expect(svc.list(squadId, { originId: "mission-alpha:operation-1" }))
      .resolves.toEqual([expect.objectContaining({ id: operationIssueId })]);
    await expect(svc.list(squadId, { originKindPrefix: "plugin:slaw.missions:operation" }))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: operationIssueId }),
        expect.objectContaining({ id: typedOperationIssueId }),
      ]));

    const projectIssueIds = (await svc.list(squadId, { projectId })).map((issue) => issue.id);
    expect(projectIssueIds).toContain(operationIssueId);
    expect(projectIssueIds).toContain(typedOperationIssueId);
    expect(projectIssueIds).toContain(legacyContentMachineOperationIssueId);

    const advancedIssueIds = (await svc.list(squadId, { includePluginOperations: true })).map((issue) => issue.id);
    expect(advancedIssueIds).toContain(operationIssueId);
    expect(advancedIssueIds).toContain(typedOperationIssueId);
    expect(advancedIssueIds).toContain(legacyContentMachineOperationIssueId);
  });

  it("excludes plugin operation issues from unread inbox counts", async () => {
    const squadId = randomUUID();
    const userId = "operator-user";
    const otherUserId = "other-user";
    const normalIssueId = randomUUID();
    const operationIssueId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(issues).values([
      {
        id: normalIssueId,
        squadId,
        title: "Normal touched issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
      },
      {
        id: operationIssueId,
        squadId,
        title: "Plugin operation touched issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        originKind: "plugin:slaw.missions:operation",
      },
    ]);
    await db.insert(issueComments).values([
      {
        squadId,
        issueId: normalIssueId,
        authorUserId: otherUserId,
        body: "Unread normal update.",
      },
      {
        squadId,
        issueId: operationIssueId,
        authorUserId: otherUserId,
        body: "Unread operation update.",
      },
    ]);

    await expect(svc.countUnreadTouchedByUser(squadId, userId, "todo")).resolves.toBe(1);
  });

  it("hides archived inbox issues until new external activity arrives", async () => {
    const squadId = randomUUID();
    const userId = "user-1";
    const otherUserId = "user-2";

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    const visibleIssueId = randomUUID();
    const archivedIssueId = randomUUID();
    const resurfacedIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: visibleIssueId,
        squadId,
        title: "Visible issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: archivedIssueId,
        squadId,
        title: "Archived issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        createdAt: new Date("2026-03-26T11:00:00.000Z"),
        updatedAt: new Date("2026-03-26T11:00:00.000Z"),
      },
      {
        id: resurfacedIssueId,
        squadId,
        title: "Resurfaced issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      },
    ]);

    await svc.archiveInbox(squadId, archivedIssueId, userId, new Date("2026-03-26T12:30:00.000Z"));
    await svc.archiveInbox(squadId, resurfacedIssueId, userId, new Date("2026-03-26T13:00:00.000Z"));

    await db.insert(issueComments).values({
      squadId,
      issueId: resurfacedIssueId,
      authorUserId: otherUserId,
      body: "This should bring the issue back into Mine.",
      createdAt: new Date("2026-03-26T13:30:00.000Z"),
      updatedAt: new Date("2026-03-26T13:30:00.000Z"),
    });

    const archivedFiltered = await svc.list(squadId, {
      touchedByUserId: userId,
      inboxArchivedByUserId: userId,
    });

    expect(archivedFiltered.map((issue) => issue.id)).toEqual([
      resurfacedIssueId,
      visibleIssueId,
    ]);

    await svc.unarchiveInbox(squadId, archivedIssueId, userId);

    const afterUnarchive = await svc.list(squadId, {
      touchedByUserId: userId,
      inboxArchivedByUserId: userId,
    });

    expect(new Set(afterUnarchive.map((issue) => issue.id))).toEqual(new Set([
      visibleIssueId,
      archivedIssueId,
      resurfacedIssueId,
    ]));
  });

  it("resurfaces archived issue when status/updatedAt changes after archiving", async () => {
    const squadId = randomUUID();
    const userId = "user-1";
    const otherUserId = "user-2";

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    const issueId = randomUUID();

    await db.insert(issues).values({
      id: issueId,
      squadId,
      title: "Issue with old comment then status change",
      status: "todo",
      priority: "medium",
      createdByUserId: userId,
      createdAt: new Date("2026-03-26T10:00:00.000Z"),
      updatedAt: new Date("2026-03-26T10:00:00.000Z"),
    });

    // Old external comment before archiving
    await db.insert(issueComments).values({
      squadId,
      issueId,
      authorUserId: otherUserId,
      body: "Old comment before archive",
      createdAt: new Date("2026-03-26T11:00:00.000Z"),
      updatedAt: new Date("2026-03-26T11:00:00.000Z"),
    });

    // Archive after seeing the comment
    await svc.archiveInbox(
      squadId,
      issueId,
      userId,
      new Date("2026-03-26T12:00:00.000Z"),
    );

    // Verify it's archived
    const afterArchive = await svc.list(squadId, {
      touchedByUserId: userId,
      inboxArchivedByUserId: userId,
    });
    expect(afterArchive.map((i) => i.id)).not.toContain(issueId);

    // Status/work update changes updatedAt (no new comment)
    await db
      .update(issues)
      .set({
        status: "in_progress",
        updatedAt: new Date("2026-03-26T13:00:00.000Z"),
      })
      .where(eq(issues.id, issueId));

    // Should resurface because updatedAt > archivedAt
    const afterUpdate = await svc.list(squadId, {
      touchedByUserId: userId,
      inboxArchivedByUserId: userId,
    });
    expect(afterUpdate.map((i) => i.id)).toContain(issueId);
  });

  it("sorts and exposes last activity from comments and non-local issue activity logs", async () => {
    const squadId = randomUUID();
    const olderIssueId = randomUUID();
    const commentIssueId = randomUUID();
    const activityIssueId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values([
      {
        id: olderIssueId,
        squadId,
        title: "Older issue",
        status: "todo",
        priority: "medium",
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: commentIssueId,
        squadId,
        title: "Comment activity issue",
        status: "todo",
        priority: "medium",
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: activityIssueId,
        squadId,
        title: "Logged activity issue",
        status: "todo",
        priority: "medium",
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
    ]);

    await db.insert(issueComments).values({
      squadId,
      issueId: commentIssueId,
      body: "New comment without touching issue.updatedAt",
      createdAt: new Date("2026-03-26T11:00:00.000Z"),
      updatedAt: new Date("2026-03-26T11:00:00.000Z"),
    });

    await db.insert(activityLog).values([
      {
        squadId,
        actorType: "system",
        actorId: "system",
        action: "issue.document_updated",
        entityType: "issue",
        entityId: activityIssueId,
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
      },
      {
        squadId,
        actorType: "user",
        actorId: "user-1",
        action: "issue.read_marked",
        entityType: "issue",
        entityId: olderIssueId,
        createdAt: new Date("2026-03-26T13:00:00.000Z"),
      },
    ]);

    const result = await svc.list(squadId, {});

    expect(result.map((issue) => issue.id)).toEqual([
      activityIssueId,
      commentIssueId,
      olderIssueId,
    ]);
    expect(result.find((issue) => issue.id === activityIssueId)?.lastActivityAt?.toISOString()).toBe(
      "2026-03-26T12:00:00.000Z",
    );
    expect(result.find((issue) => issue.id === commentIssueId)?.lastActivityAt?.toISOString()).toBe(
      "2026-03-26T11:00:00.000Z",
    );
    expect(result.find((issue) => issue.id === olderIssueId)?.lastActivityAt?.toISOString()).toBe(
      "2026-03-26T10:00:00.000Z",
    );
  });

  it("paginates earlier comments in descending order from an anchor comment", async () => {
    const squadId = randomUUID();
    const issueId = randomUUID();
    const firstCommentId = randomUUID();
    const anchorCommentId = randomUUID();
    const latestCommentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values({
      id: issueId,
      squadId,
      title: "Paged comments issue",
      status: "todo",
      priority: "medium",
    });

    await db.insert(issueComments).values([
      {
        id: firstCommentId,
        squadId,
        issueId,
        body: "First comment",
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: anchorCommentId,
        squadId,
        issueId,
        body: "Anchor comment",
        createdAt: new Date("2026-03-26T11:00:00.000Z"),
        updatedAt: new Date("2026-03-26T11:00:00.000Z"),
      },
      {
        id: latestCommentId,
        squadId,
        issueId,
        body: "Latest comment",
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      },
    ]);

    const comments = await svc.listComments(issueId, {
      afterCommentId: anchorCommentId,
      order: "desc",
      limit: 50,
    });

    expect(comments.map((comment) => comment.id)).toEqual([firstCommentId]);
  });

  it("paginates later comments in ascending order from an anchor comment", async () => {
    const squadId = randomUUID();
    const issueId = randomUUID();
    const firstCommentId = randomUUID();
    const anchorCommentId = randomUUID();
    const latestCommentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values({
      id: issueId,
      squadId,
      title: "Paged comments issue",
      status: "todo",
      priority: "medium",
    });

    await db.insert(issueComments).values([
      {
        id: firstCommentId,
        squadId,
        issueId,
        body: "First comment",
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: anchorCommentId,
        squadId,
        issueId,
        body: "Anchor comment",
        createdAt: new Date("2026-03-26T11:00:00.000Z"),
        updatedAt: new Date("2026-03-26T11:00:00.000Z"),
      },
      {
        id: latestCommentId,
        squadId,
        issueId,
        body: "Latest comment",
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      },
    ]);

    const comments = await svc.listComments(issueId, {
      afterCommentId: anchorCommentId,
      order: "asc",
      limit: 50,
    });

    expect(comments.map((comment) => comment.id)).toEqual([latestCommentId]);
  });

  it("lists user comments when derived run attribution scans a timestamp window", async () => {
    const squadId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const commentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      squadId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(issues).values({
      id: issueId,
      squadId,
      title: "Comments issue",
      status: "todo",
      priority: "medium",
    });

    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      squadId,
      agentId,
      contextSnapshot: { issueId },
      createdAt: new Date("2026-05-12T22:58:00.000Z"),
      startedAt: new Date("2026-05-12T22:58:00.000Z"),
      finishedAt: new Date("2026-05-12T23:14:00.000Z"),
    });

    await db.insert(issueComments).values({
      id: commentId,
      squadId,
      issueId,
      authorUserId: "user-1",
      body: "Comment should be visible",
      createdAt: new Date("2026-05-12T23:00:00.000Z"),
      updatedAt: new Date("2026-05-12T23:00:00.000Z"),
    });

    const comments = await svc.listComments(issueId, {
      order: "desc",
      limit: 50,
    });

    expect(comments.map((comment) => comment.id)).toEqual([commentId]);
    expect(comments[0]?.body).toBe("Comment should be visible");
  });

  it("lists user comments when a candidate attribution run log is missing", async () => {
    const squadId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const commentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      squadId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(issues).values({
      id: issueId,
      squadId,
      title: "Comments issue with missing run log",
      status: "todo",
      priority: "medium",
    });

    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      squadId,
      agentId,
      contextSnapshot: { issueId },
      createdAt: new Date("2026-05-12T22:58:00.000Z"),
      startedAt: new Date("2026-05-12T22:58:00.000Z"),
      finishedAt: new Date("2026-05-12T23:14:00.000Z"),
      logStore: "local_file",
      logRef: "missing/run-log.ndjson",
      logBytes: 128,
    });

    await db.insert(issueComments).values({
      id: commentId,
      squadId,
      issueId,
      authorUserId: "user-1",
      body: "Comment should still be visible",
      createdAt: new Date("2026-05-12T23:00:00.000Z"),
      updatedAt: new Date("2026-05-12T23:00:00.000Z"),
    });

    const comments = await svc.listComments(issueId, {
      order: "desc",
      limit: 50,
    });

    expect(comments.map((comment) => comment.id)).toEqual([commentId]);
    expect(comments[0]?.body).toBe("Comment should still be visible");
    expect(comments[0]?.metadata).toBeNull();
  });

  it("includes blockedBy summaries on list rows in one batched pass", async () => {
    const squadId = randomUUID();
    const blockerId = randomUUID();
    const blockedId = randomUUID();
    const unblockedId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values([
      {
        id: blockerId,
        squadId,
        title: "Blocker issue",
        status: "todo",
        priority: "high",
      },
      {
        id: blockedId,
        squadId,
        title: "Blocked issue",
        status: "blocked",
        priority: "medium",
      },
      {
        id: unblockedId,
        squadId,
        title: "Unblocked issue",
        status: "todo",
        priority: "medium",
      },
    ]);

    await db.insert(issueRelations).values({
      squadId,
      issueId: blockerId,
      relatedIssueId: blockedId,
      type: "blocks",
    });

    const defaultResult = await svc.list(squadId);
    expect(defaultResult.find((issue) => issue.id === blockedId)?.blockedBy).toBeUndefined();

    const result = await svc.list(squadId, { includeBlockedBy: true });
    const byId = new Map(result.map((issue) => [issue.id, issue]));

    expect(byId.get(blockedId)?.blockedBy).toEqual([
      expect.objectContaining({
        id: blockerId,
        identifier: null,
        title: "Blocker issue",
        status: "todo",
        priority: "high",
      }),
    ]);
    expect(byId.get(blockerId)?.blockedBy).toEqual([]);
    expect(byId.get(unblockedId)?.blockedBy).toEqual([]);
  });

  it("trims list payload fields that can grow large on issue index routes", async () => {
    const squadId = randomUUID();
    const issueId = randomUUID();
    const longDescription = "x".repeat(5_000);

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values({
      id: issueId,
      squadId,
      title: "Large issue",
      description: longDescription,
      status: "todo",
      priority: "medium",
      executionPolicy: { stages: Array.from({ length: 20 }, (_, index) => ({ index, kind: "review", notes: "y".repeat(400) })) },
      executionState: { history: Array.from({ length: 20 }, (_, index) => ({ index, body: "z".repeat(400) })) },
      executionWorkspaceSettings: { notes: "w".repeat(2_000) },
    });

    const [result] = await svc.list(squadId);

    expect(result).toBeTruthy();
    expect(result?.description).toHaveLength(1200);
    expect(result?.executionPolicy).toBeNull();
    expect(result?.executionState).toBeNull();
    expect(result?.executionWorkspaceSettings).toBeNull();
  });

  it("does not let description preview truncation split multibyte characters", async () => {
    const squadId = randomUUID();
    const issueId = randomUUID();
    const description = `${"x".repeat(1199)}— still valid after truncation`;

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(issues).values({
      id: issueId,
      squadId,
      title: "Multibyte boundary issue",
      description,
      status: "todo",
      priority: "medium",
    });

    const [result] = await svc.list(squadId);

    expect(result?.description).toHaveLength(1200);
    expect(result?.description?.endsWith("—")).toBe(true);
  });
});

describeEmbeddedPostgres("issueService.create workspace inheritance", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-issues-create-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("inherits the parent issue workspace linkage when child workspace fields are omitted", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const parentIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
      sharedWorkspaceKey: "workspace-key",
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      squadId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Issue worktree",
      status: "active",
      providerType: "git_worktree",
      providerRef: `/tmp/${executionWorkspaceId}`,
    });

    await db.insert(issues).values({
      id: parentIssueId,
      squadId,
      projectId,
      projectWorkspaceId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        workspaceRuntime: { profile: "agent" },
      },
    });

    const child = await svc.create(squadId, {
      parentId: parentIssueId,
      projectId,
      title: "Child issue",
    });

    expect(child.parentId).toBe(parentIssueId);
    expect(child.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(child.executionWorkspaceId).toBe(executionWorkspaceId);
    expect(child.executionWorkspacePreference).toBe("reuse_existing");
    expect(child.executionWorkspaceSettings).toEqual({
      mode: "isolated_workspace",
      workspaceRuntime: { profile: "agent" },
    });
  });

  it("captures the assignee default environment when neither issue nor project specifies one", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const assigneeEnvironmentId = randomUUID();
    const assigneeAgentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(environments).values([
      {
        id: assigneeEnvironmentId,
        squadId,
        name: "QA E2B",
        driver: "sandbox",
        status: "active",
        config: { provider: "e2b" },
      },
    ]);

    await db.insert(agents).values({
      id: assigneeAgentId,
      squadId,
      name: "QA E2B Codex",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      defaultEnvironmentId: assigneeEnvironmentId,
      permissions: {},
    });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "shared_workspace",
        allowIssueOverride: true,
        defaultProjectWorkspaceId: projectWorkspaceId,
      },
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    const issue = await svc.create(squadId, {
      projectId,
      assigneeAgentId,
      title: "Environment matrix: e2b / codex_local",
      status: "todo",
      priority: "medium",
    });

    expect(issue.executionWorkspaceSettings).toEqual({
      mode: "shared_workspace",
      environmentId: assigneeEnvironmentId,
    });
  });

  it("does not promote the assignee default environment when the project policy already specifies one", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const projectEnvironmentId = randomUUID();
    const assigneeEnvironmentId = randomUUID();
    const assigneeAgentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(environments).values([
      {
        id: projectEnvironmentId,
        squadId,
        name: "QA SSH",
        driver: "ssh",
        status: "active",
        config: {},
      },
      {
        id: assigneeEnvironmentId,
        squadId,
        name: "QA E2B",
        driver: "sandbox",
        status: "active",
        config: { provider: "e2b" },
      },
    ]);

    await db.insert(agents).values({
      id: assigneeAgentId,
      squadId,
      name: "QA E2B Codex",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      defaultEnvironmentId: assigneeEnvironmentId,
      permissions: {},
    });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "shared_workspace",
        allowIssueOverride: true,
        defaultProjectWorkspaceId: projectWorkspaceId,
        environmentId: projectEnvironmentId,
      },
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    const issue = await svc.create(squadId, {
      projectId,
      assigneeAgentId,
      title: "Environment matrix: e2b / codex_local",
      status: "todo",
      priority: "medium",
    });

    // Project policy's environmentId must win over the assignee's default;
    // executionWorkspaceSettings should not bake in an environmentId in this case
    // so resolveExecutionWorkspaceEnvironmentId can fall through to the project
    // policy's value at run time.
    expect(issue.executionWorkspaceSettings).toEqual({ mode: "shared_workspace" });
  });

  it("captures the new assignee's default environment on reassignment", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const firstEnvironmentId = randomUUID();
    const secondEnvironmentId = randomUUID();
    const firstAgentId = randomUUID();
    const secondAgentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(environments).values([
      {
        id: firstEnvironmentId,
        squadId,
        name: "QA SSH",
        driver: "ssh",
        status: "active",
        config: {},
      },
      {
        id: secondEnvironmentId,
        squadId,
        name: "QA E2B",
        driver: "sandbox",
        status: "active",
        config: { provider: "e2b" },
      },
    ]);

    await db.insert(agents).values([
      {
        id: firstAgentId,
        squadId,
        name: "QA SSH Codex",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        defaultEnvironmentId: firstEnvironmentId,
        permissions: {},
      },
      {
        id: secondAgentId,
        squadId,
        name: "QA E2B Codex",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        defaultEnvironmentId: secondEnvironmentId,
        permissions: {},
      },
    ]);

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "shared_workspace",
        allowIssueOverride: true,
        defaultProjectWorkspaceId: projectWorkspaceId,
      },
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    const created = await svc.create(squadId, {
      projectId,
      assigneeAgentId: firstAgentId,
      title: "Environment matrix: ssh / codex_local",
      status: "todo",
      priority: "medium",
    });

    expect(created.executionWorkspaceSettings).toMatchObject({
      environmentId: firstEnvironmentId,
    });

    const reassigned = await svc.update(created.id, {
      assigneeAgentId: secondAgentId,
    });

    expect(reassigned).not.toBeNull();
    expect(reassigned!.executionWorkspaceSettings).toMatchObject({
      environmentId: secondEnvironmentId,
    });
  });

  it("preserves an operator-set environmentId across reassignment", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const firstEnvironmentId = randomUUID();
    const secondEnvironmentId = randomUUID();
    const operatorEnvironmentId = randomUUID();
    const firstAgentId = randomUUID();
    const secondAgentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(environments).values([
      { id: firstEnvironmentId, squadId, name: "Env 1", driver: "ssh", status: "active", config: {} },
      { id: secondEnvironmentId, squadId, name: "Env 2", driver: "sandbox", status: "active", config: { provider: "e2b" } },
      { id: operatorEnvironmentId, squadId, name: "Operator pick", driver: "ssh", status: "active", config: {} },
    ]);

    await db.insert(agents).values([
      {
        id: firstAgentId, squadId, name: "First agent", role: "engineer", status: "active",
        adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {},
        defaultEnvironmentId: firstEnvironmentId, permissions: {},
      },
      {
        id: secondAgentId, squadId, name: "Second agent", role: "engineer", status: "active",
        adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {},
        defaultEnvironmentId: secondEnvironmentId, permissions: {},
      },
    ]);

    await db.insert(projects).values({
      id: projectId, squadId, name: "Workspace project", status: "in_progress",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "shared_workspace",
        allowIssueOverride: true,
        defaultProjectWorkspaceId: projectWorkspaceId,
      },
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId, squadId, projectId, name: "Primary workspace", isPrimary: true,
    });

    const created = await svc.create(squadId, {
      projectId,
      assigneeAgentId: firstAgentId,
      title: "Operator overrides env then reassigns",
      status: "todo",
      priority: "medium",
    });

    // Operator explicitly overrides the environmentId in a separate update.
    const overridden = await svc.update(created.id, {
      executionWorkspaceSettings: {
        mode: "shared_workspace",
        environmentId: operatorEnvironmentId,
      },
    });
    expect(overridden!.executionWorkspaceSettings).toMatchObject({
      environmentId: operatorEnvironmentId,
    });

    // A subsequent reassignment-only update must NOT overwrite the operator's
    // explicit choice with the new assignee's default.
    const reassigned = await svc.update(created.id, {
      assigneeAgentId: secondAgentId,
    });
    expect(reassigned!.executionWorkspaceSettings).toMatchObject({
      environmentId: operatorEnvironmentId,
    });
  });

  it("keeps explicit workspace fields instead of inheriting the parent linkage", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const parentIssueId = randomUUID();
    const parentProjectWorkspaceId = randomUUID();
    const parentExecutionWorkspaceId = randomUUID();
    const explicitProjectWorkspaceId = randomUUID();
    const explicitExecutionWorkspaceId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(projectWorkspaces).values([
      {
        id: parentProjectWorkspaceId,
        squadId,
        projectId,
        name: "Parent workspace",
      },
      {
        id: explicitProjectWorkspaceId,
        squadId,
        projectId,
        name: "Explicit workspace",
      },
    ]);

    await db.insert(executionWorkspaces).values([
      {
        id: parentExecutionWorkspaceId,
        squadId,
        projectId,
        projectWorkspaceId: parentProjectWorkspaceId,
        mode: "isolated_workspace",
        strategyType: "git_worktree",
        name: "Parent worktree",
        status: "active",
        providerType: "git_worktree",
      },
      {
        id: explicitExecutionWorkspaceId,
        squadId,
        projectId,
        projectWorkspaceId: explicitProjectWorkspaceId,
        mode: "shared_workspace",
        strategyType: "project_primary",
        name: "Explicit shared workspace",
        status: "active",
        providerType: "local_fs",
      },
    ]);

    await db.insert(issues).values({
      id: parentIssueId,
      squadId,
      projectId,
      projectWorkspaceId: parentProjectWorkspaceId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceId: parentExecutionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
      },
    });

    const child = await svc.create(squadId, {
      parentId: parentIssueId,
      projectId,
      title: "Child issue",
      projectWorkspaceId: explicitProjectWorkspaceId,
      executionWorkspaceId: explicitExecutionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "shared_workspace",
      },
    });

    expect(child.projectWorkspaceId).toBe(explicitProjectWorkspaceId);
    expect(child.executionWorkspaceId).toBe(explicitExecutionWorkspaceId);
    expect(child.executionWorkspacePreference).toBe("reuse_existing");
    expect(child.executionWorkspaceSettings).toEqual({
      mode: "shared_workspace",
    });
  });

  it("inherits workspace linkage from an explicit source issue without creating a parent-child relationship", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const sourceIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Primary workspace",
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      squadId,
      projectId,
      projectWorkspaceId,
      mode: "operator_branch",
      strategyType: "git_worktree",
      name: "Operator branch",
      status: "active",
      providerType: "git_worktree",
    });

    await db.insert(issues).values({
      id: sourceIssueId,
      squadId,
      projectId,
      projectWorkspaceId,
      title: "Source issue",
      status: "todo",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "operator_branch",
      },
    });

    const followUp = await svc.create(squadId, {
      projectId,
      title: "Follow-up issue",
      inheritExecutionWorkspaceFromIssueId: sourceIssueId,
    });

    expect(followUp.parentId).toBeNull();
    expect(followUp.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(followUp.executionWorkspaceId).toBe(executionWorkspaceId);
    expect(followUp.executionWorkspacePreference).toBe("reuse_existing");
    expect(followUp.executionWorkspaceSettings).toEqual({
      mode: "operator_branch",
    });
  });

  it("createChild applies parent defaults, acceptance criteria, workspace inheritance, and optional parent blocker chaining", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const goalId = randomUUID();
    const parentIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(goals).values({
      id: goalId,
      squadId,
      title: "Ship child helpers",
      level: "task",
      status: "active",
    });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      goalId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      squadId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Issue worktree",
      status: "active",
      providerType: "git_worktree",
      providerRef: `/tmp/${executionWorkspaceId}`,
    });

    await db.insert(issues).values({
      id: parentIssueId,
      squadId,
      projectId,
      projectWorkspaceId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      requestDepth: 1,
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
      },
    });

    const { issue: child, parentBlockerAdded } = await svc.createChild(parentIssueId, {
      title: "Child helper",
      status: "todo",
      description: "Implement the helper.",
      acceptanceCriteria: ["Uses the parent issue as parentId", "Reuses the parent execution workspace"],
      blockParentUntilDone: true,
    });

    expect(parentBlockerAdded).toBe(true);
    expect(child.parentId).toBe(parentIssueId);
    expect(child.projectId).toBe(projectId);
    expect(child.goalId).toBe(goalId);
    expect(child.requestDepth).toBe(2);
    expect(child.description).toContain("## Acceptance Criteria");
    expect(child.description).toContain("- Uses the parent issue as parentId");
    expect(child.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(child.executionWorkspaceId).toBe(executionWorkspaceId);
    expect(child.executionWorkspacePreference).toBe("reuse_existing");

    const parentRelations = await svc.getRelationSummaries(parentIssueId);
    expect(parentRelations.blockedBy).toEqual([
      expect.objectContaining({
        id: child.id,
        title: "Child helper",
      }),
    ]);
  });

  it("clamps helper-created child requestDepth to the safe maximum", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const goalId = randomUUID();
    const parentIssueId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      squadId,
      title: "Ship child helpers",
      level: "task",
      status: "active",
    });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      goalId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(issues).values({
      id: parentIssueId,
      squadId,
      projectId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      requestDepth: MAX_ISSUE_REQUEST_DEPTH,
    });

    const { issue: child } = await svc.createChild(parentIssueId, {
      title: "Child helper",
      status: "todo",
      requestDepth: MAX_ISSUE_REQUEST_DEPTH + 100,
    });

    expect(child.requestDepth).toBe(MAX_ISSUE_REQUEST_DEPTH);
  });
});

describeEmbeddedPostgres("issueService blockers and dependency wake readiness", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-issues-blockers-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(workspaceOperations);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("persists blocked-by relations and exposes both blockedBy and blocks summaries", async () => {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    const blockerId = randomUUID();
    const blockedId = randomUUID();
    await db.insert(issues).values([
      {
        id: blockerId,
        squadId,
        title: "Blocker",
        status: "todo",
        priority: "high",
      },
      {
        id: blockedId,
        squadId,
        title: "Blocked issue",
        status: "blocked",
        priority: "medium",
      },
    ]);

    await svc.update(blockedId, {
      blockedByIssueIds: [blockerId],
    });

    const blockerRelations = await svc.getRelationSummaries(blockerId);
    const blockedRelations = await svc.getRelationSummaries(blockedId);

    expect(blockerRelations.blocks.map((relation) => relation.id)).toEqual([blockedId]);
    expect(blockedRelations.blockedBy.map((relation) => relation.id)).toEqual([blockerId]);
  });

  it("adds terminal blockers to immediate blocked-by summaries", async () => {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    const issueA = randomUUID();
    const issueB = randomUUID();
    const issueC = randomUUID();
    const issueD = randomUUID();
    await db.insert(issues).values([
      { id: issueA, squadId, identifier: "PAP-1", title: "Issue A", status: "blocked", priority: "medium" },
      { id: issueB, squadId, identifier: "PAP-2", title: "Issue B", status: "blocked", priority: "medium" },
      { id: issueC, squadId, identifier: "PAP-3", title: "Issue C", status: "blocked", priority: "medium" },
      { id: issueD, squadId, identifier: "PAP-4", title: "Issue D", status: "todo", priority: "high" },
    ]);

    await svc.update(issueC, { blockedByIssueIds: [issueD] });
    await svc.update(issueB, { blockedByIssueIds: [issueC] });
    await svc.update(issueA, { blockedByIssueIds: [issueB] });

    const relations = await svc.getRelationSummaries(issueA);

    expect(relations.blockedBy).toHaveLength(1);
    expect(relations.blockedBy[0]).toMatchObject({
      id: issueB,
      identifier: "PAP-2",
      title: "Issue B",
      terminalBlockers: [
        expect.objectContaining({
          id: issueD,
          identifier: "PAP-4",
          title: "Issue D",
          status: "todo",
          priority: "high",
        }),
      ],
    });
  });

  it("rejects blocking cycles", async () => {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    const issueA = randomUUID();
    const issueB = randomUUID();
    await db.insert(issues).values([
      { id: issueA, squadId, title: "Issue A", status: "todo", priority: "medium" },
      { id: issueB, squadId, title: "Issue B", status: "todo", priority: "medium" },
    ]);

    await svc.update(issueA, { blockedByIssueIds: [issueB] });

    await expect(
      svc.update(issueB, { blockedByIssueIds: [issueA] }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("only returns dependents once every blocker is done", async () => {
    const squadId = randomUUID();
    const assigneeAgentId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: assigneeAgentId,
      squadId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const blockerA = randomUUID();
    const blockerB = randomUUID();
    const blockedIssueId = randomUUID();
    await db.insert(issues).values([
      { id: blockerA, squadId, title: "Blocker A", status: "done", priority: "medium" },
      { id: blockerB, squadId, title: "Blocker B", status: "todo", priority: "medium" },
      {
        id: blockedIssueId,
        squadId,
        title: "Blocked issue",
        status: "blocked",
        priority: "medium",
        assigneeAgentId,
      },
    ]);

    await svc.update(blockedIssueId, { blockedByIssueIds: [blockerA, blockerB] });

    expect(await svc.listWakeableBlockedDependents(blockerA)).toEqual([]);

    await svc.update(blockerB, { status: "done" });

    await expect(svc.listWakeableBlockedDependents(blockerA)).resolves.toEqual([
      expect.objectContaining({
        id: blockedIssueId,
        assigneeAgentId,
        blockerIssueIds: expect.arrayContaining([blockerA, blockerB]),
      }),
    ]);
  });

  it("gates dependents on the workspace-finalize barrier when a done blocker's execution workspace has not synced back", async () => {
    const squadId = randomUUID();
    const assigneeAgentId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: assigneeAgentId,
      squadId,
      name: "QA",
      role: "qa",
      status: "active",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Shared workspace project",
      status: "in_progress",
    });
    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Shared workspace",
      sourceType: "local_path",
      visibility: "default",
      isPrimary: true,
    });
    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      squadId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Shared exec workspace",
      status: "active",
      providerType: "git_worktree",
    });

    const blockerId = randomUUID();
    const dependentId = randomUUID();
    await db.insert(issues).values([
      {
        id: blockerId,
        squadId,
        projectId,
        title: "Predecessor",
        status: "done",
        priority: "medium",
        executionWorkspaceId,
      },
      {
        id: dependentId,
        squadId,
        projectId,
        title: "Dependent",
        status: "blocked",
        priority: "medium",
        assigneeAgentId,
      },
    ]);
    await svc.update(dependentId, { blockedByIssueIds: [blockerId] });

    // A run touched the workspace (prepare phase) but has not yet recorded
    // workspace_finalize — the dependent must NOT wake.
    await db.insert(workspaceOperations).values({
      squadId,
      executionWorkspaceId,
      phase: "worktree_prepare",
      status: "succeeded",
      startedAt: new Date("2026-05-23T22:00:00.000Z"),
    });

    expect(await svc.listWakeableBlockedDependents(blockerId)).toEqual([]);
    await expect(svc.getDependencyReadiness(dependentId)).resolves.toMatchObject({
      isDependencyReady: false,
      pendingFinalizeBlockerIssueIds: [blockerId],
      unresolvedBlockerIssueIds: [blockerId],
    });

    // A failed finalize must keep the gate closed.
    await db.insert(workspaceOperations).values({
      squadId,
      executionWorkspaceId,
      phase: "workspace_finalize",
      status: "failed",
      startedAt: new Date("2026-05-23T22:05:00.000Z"),
    });
    expect(await svc.listWakeableBlockedDependents(blockerId)).toEqual([]);

    // Once a workspace_finalize succeeded row lands AFTER the failed one,
    // the gate opens and the dependent is wakeable.
    await db.insert(workspaceOperations).values({
      squadId,
      executionWorkspaceId,
      phase: "workspace_finalize",
      status: "succeeded",
      startedAt: new Date("2026-05-23T22:10:00.000Z"),
    });

    await expect(svc.listWakeableBlockedDependents(blockerId)).resolves.toEqual([
      expect.objectContaining({
        id: dependentId,
        assigneeAgentId,
        blockerIssueIds: [blockerId],
      }),
    ]);
    await expect(svc.getDependencyReadiness(dependentId)).resolves.toMatchObject({
      isDependencyReady: true,
      pendingFinalizeBlockerIssueIds: [],
    });
  });

  it("treats blockers with no executionWorkspaceId as not subject to the workspace-finalize barrier", async () => {
    const squadId = randomUUID();
    const assigneeAgentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: assigneeAgentId,
      squadId,
      name: "QA",
      role: "qa",
      status: "active",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const blockerId = randomUUID();
    const dependentId = randomUUID();
    await db.insert(issues).values([
      // Done blocker with no execution workspace ever attached (e.g. closed manually).
      { id: blockerId, squadId, title: "Manual done blocker", status: "done", priority: "medium" },
      {
        id: dependentId,
        squadId,
        title: "Dependent",
        status: "blocked",
        priority: "medium",
        assigneeAgentId,
      },
    ]);
    await svc.update(dependentId, { blockedByIssueIds: [blockerId] });

    // No executionWorkspaceId → no barrier → dependent should be wakeable.
    await expect(svc.listWakeableBlockedDependents(blockerId)).resolves.toEqual([
      expect.objectContaining({
        id: dependentId,
        assigneeAgentId,
        blockerIssueIds: [blockerId],
      }),
    ]);
  });

  it("reports dependency readiness for blocked issue chains", async () => {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    const blockerId = randomUUID();
    const blockedId = randomUUID();
    await db.insert(issues).values([
      { id: blockerId, squadId, title: "Blocker", status: "todo", priority: "medium" },
      { id: blockedId, squadId, title: "Blocked", status: "todo", priority: "medium" },
    ]);
    await svc.update(blockedId, { blockedByIssueIds: [blockerId] });

    await expect(svc.getDependencyReadiness(blockedId)).resolves.toMatchObject({
      issueId: blockedId,
      blockerIssueIds: [blockerId],
      unresolvedBlockerIssueIds: [blockerId],
      unresolvedBlockerCount: 1,
      allBlockersDone: false,
      isDependencyReady: false,
    });

    await svc.update(blockerId, { status: "done" });

    await expect(svc.getDependencyReadiness(blockedId)).resolves.toMatchObject({
      issueId: blockedId,
      blockerIssueIds: [blockerId],
      unresolvedBlockerIssueIds: [],
      unresolvedBlockerCount: 0,
      allBlockersDone: true,
      isDependencyReady: true,
    });
  });

  it("unblocks a source issue when a liveness escalation recovery issue is marked done", async () => {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    const sourceIssueId = randomUUID();
    const recoveryIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: sourceIssueId,
        squadId,
        title: "Source issue",
        status: "blocked",
        priority: "medium",
      },
      {
        id: recoveryIssueId,
        squadId,
        title: "Liveness escalation issue",
        status: "in_progress",
        priority: "high",
        originKind: "harness_liveness_escalation",
        originId: `harness_liveness:${squadId}:${sourceIssueId}:invalid_review_participant:none`,
      },
    ]);

    await svc.update(sourceIssueId, {
      blockedByIssueIds: [recoveryIssueId],
    });
    await expect(svc.getRelationSummaries(sourceIssueId)).resolves.toMatchObject({
      blockedBy: [expect.objectContaining({ id: recoveryIssueId })],
    });

    await svc.update(recoveryIssueId, {
      status: "done",
    });

    await expect(svc.getRelationSummaries(sourceIssueId)).resolves.toMatchObject({
      blockedBy: [],
    });
  });

  it("rejects execution when unresolved blockers remain", async () => {
    const squadId = randomUUID();
    const assigneeAgentId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: assigneeAgentId,
      squadId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const blockerId = randomUUID();
    const blockedId = randomUUID();
    await db.insert(issues).values([
      { id: blockerId, squadId, title: "Blocker", status: "todo", priority: "medium" },
      {
        id: blockedId,
        squadId,
        title: "Blocked",
        status: "todo",
        priority: "medium",
        assigneeAgentId,
      },
    ]);
    await svc.update(blockedId, { blockedByIssueIds: [blockerId] });

    await expect(
      svc.update(blockedId, { status: "in_progress" }),
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      svc.checkout(blockedId, assigneeAgentId, ["todo", "blocked"], null),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("wakes parents only when all direct children are terminal", async () => {
    const squadId = randomUUID();
    const assigneeAgentId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: assigneeAgentId,
      squadId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const parentId = randomUUID();
    const childA = randomUUID();
    const childB = randomUUID();
    await db.insert(issues).values([
      {
        id: parentId,
        squadId,
        title: "Parent issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId,
      },
      {
        id: childA,
        squadId,
        parentId,
        title: "Child A",
        status: "done",
        priority: "medium",
      },
      {
        id: childB,
        squadId,
        parentId,
        title: "Child B",
        status: "blocked",
        priority: "medium",
      },
    ]);

    expect(await svc.getWakeableParentAfterChildCompletion(parentId)).toBeNull();

    await svc.update(childB, { status: "cancelled" });

    expect(await svc.getWakeableParentAfterChildCompletion(parentId)).toMatchObject({
      id: parentId,
      assigneeAgentId,
      childIssueIds: [childA, childB],
      childIssueSummaries: [
        expect.objectContaining({ id: childA, title: "Child A", status: "done" }),
        expect.objectContaining({ id: childB, title: "Child B", status: "cancelled" }),
      ],
      childIssueSummaryTruncated: false,
    });
  });
});

describeEmbeddedPostgres("issueService.create workspace inheritance", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-issues-create-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("inherits the parent issue workspace linkage when child workspace fields are omitted", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const parentIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
      sharedWorkspaceKey: "workspace-key",
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      squadId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Issue worktree",
      status: "active",
      providerType: "git_worktree",
      providerRef: `/tmp/${executionWorkspaceId}`,
    });

    await db.insert(issues).values({
      id: parentIssueId,
      squadId,
      projectId,
      projectWorkspaceId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        workspaceRuntime: { profile: "agent" },
      },
    });

    const child = await svc.create(squadId, {
      parentId: parentIssueId,
      projectId,
      title: "Child issue",
    });

    expect(child.parentId).toBe(parentIssueId);
    expect(child.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(child.executionWorkspaceId).toBe(executionWorkspaceId);
    expect(child.executionWorkspacePreference).toBe("reuse_existing");
    expect(child.executionWorkspaceSettings).toEqual({
      mode: "isolated_workspace",
      workspaceRuntime: { profile: "agent" },
    });
  });

  it("keeps explicit workspace fields instead of inheriting the parent linkage", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const parentIssueId = randomUUID();
    const parentProjectWorkspaceId = randomUUID();
    const parentExecutionWorkspaceId = randomUUID();
    const explicitProjectWorkspaceId = randomUUID();
    const explicitExecutionWorkspaceId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(projectWorkspaces).values([
      {
        id: parentProjectWorkspaceId,
        squadId,
        projectId,
        name: "Parent workspace",
      },
      {
        id: explicitProjectWorkspaceId,
        squadId,
        projectId,
        name: "Explicit workspace",
      },
    ]);

    await db.insert(executionWorkspaces).values([
      {
        id: parentExecutionWorkspaceId,
        squadId,
        projectId,
        projectWorkspaceId: parentProjectWorkspaceId,
        mode: "isolated_workspace",
        strategyType: "git_worktree",
        name: "Parent worktree",
        status: "active",
        providerType: "git_worktree",
      },
      {
        id: explicitExecutionWorkspaceId,
        squadId,
        projectId,
        projectWorkspaceId: explicitProjectWorkspaceId,
        mode: "shared_workspace",
        strategyType: "project_primary",
        name: "Explicit shared workspace",
        status: "active",
        providerType: "local_fs",
      },
    ]);

    await db.insert(issues).values({
      id: parentIssueId,
      squadId,
      projectId,
      projectWorkspaceId: parentProjectWorkspaceId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceId: parentExecutionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
      },
    });

    const child = await svc.create(squadId, {
      parentId: parentIssueId,
      projectId,
      title: "Child issue",
      projectWorkspaceId: explicitProjectWorkspaceId,
      executionWorkspaceId: explicitExecutionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "shared_workspace",
      },
    });

    expect(child.projectWorkspaceId).toBe(explicitProjectWorkspaceId);
    expect(child.executionWorkspaceId).toBe(explicitExecutionWorkspaceId);
    expect(child.executionWorkspacePreference).toBe("reuse_existing");
    expect(child.executionWorkspaceSettings).toEqual({
      mode: "shared_workspace",
    });
  });

  it("inherits workspace linkage from an explicit source issue without creating a parent-child relationship", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const sourceIssueId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Primary workspace",
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      squadId,
      projectId,
      projectWorkspaceId,
      mode: "operator_branch",
      strategyType: "git_worktree",
      name: "Operator branch",
      status: "active",
      providerType: "git_worktree",
    });

    await db.insert(issues).values({
      id: sourceIssueId,
      squadId,
      projectId,
      projectWorkspaceId,
      title: "Source issue",
      status: "todo",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "operator_branch",
      },
    });

    const followUp = await svc.create(squadId, {
      projectId,
      title: "Follow-up issue",
      inheritExecutionWorkspaceFromIssueId: sourceIssueId,
    });

    expect(followUp.parentId).toBeNull();
    expect(followUp.projectWorkspaceId).toBe(projectWorkspaceId);
    expect(followUp.executionWorkspaceId).toBe(executionWorkspaceId);
    expect(followUp.executionWorkspacePreference).toBe("reuse_existing");
    expect(followUp.executionWorkspaceSettings).toEqual({
      mode: "operator_branch",
    });
  });

  it("syncs reused execution workspace config when issue workspace settings are updated", async () => {
    const squadId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();
    const issueId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace project",
      status: "in_progress",
    });

    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Primary workspace",
    });

    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      squadId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Issue worktree",
      status: "active",
      providerType: "git_worktree",
      metadata: {
        config: {
          environmentId: "env-old",
          provisionCommand: "bash ./scripts/provision-old.sh",
          teardownCommand: "bash ./scripts/teardown-old.sh",
          workspaceRuntime: { profile: "old" },
        },
      },
    });

    await db.insert(issues).values({
      id: issueId,
      squadId,
      projectId,
      projectWorkspaceId,
      title: "Recovery issue",
      status: "in_progress",
      priority: "medium",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        environmentId: "env-old",
        workspaceStrategy: {
          type: "git_worktree",
          provisionCommand: "bash ./scripts/provision-old.sh",
          teardownCommand: "bash ./scripts/teardown-old.sh",
        },
        workspaceRuntime: { profile: "old" },
      },
    });

    await svc.update(issueId, {
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        environmentId: "env-new",
        workspaceStrategy: {
          type: "cloud_sandbox",
          provisionCommand: "bash ./scripts/provision-new.sh",
          teardownCommand: "bash ./scripts/teardown-new.sh",
        },
        workspaceRuntime: { profile: "new" },
      },
    });

    const workspace = await db
      .select({ metadata: executionWorkspaces.metadata })
      .from(executionWorkspaces)
      .where(eq(executionWorkspaces.id, executionWorkspaceId))
      .then((rows) => rows[0] ?? null);

    expect(workspace?.metadata).toEqual({
      config: {
        environmentId: "env-new",
        provisionCommand: "bash ./scripts/provision-new.sh",
        teardownCommand: "bash ./scripts/teardown-new.sh",
        cleanupCommand: null,
        workspaceRuntime: { profile: "new" },
        desiredState: null,
        serviceStates: null,
      },
    });
  });
});

describeEmbeddedPostgres("issueService.findMentionedProjectIds", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-issues-mentioned-projects-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("can skip comment-body scans for bounded issue detail reads", async () => {
    const squadId = randomUUID();
    const issueId = randomUUID();
    const titleProjectId = randomUUID();
    const commentProjectId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(projects).values([
      {
        id: titleProjectId,
        squadId,
        name: "Title project",
        status: "in_progress",
      },
      {
        id: commentProjectId,
        squadId,
        name: "Comment project",
        status: "in_progress",
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      squadId,
      title: `Link [Title](${buildProjectMentionHref(titleProjectId)})`,
      description: null,
      status: "todo",
      priority: "medium",
    });

    await db.insert(issueComments).values({
      squadId,
      issueId,
      body: `Comment link [Comment](${buildProjectMentionHref(commentProjectId)})`,
    });

    expect(await svc.findMentionedProjectIds(issueId, { includeCommentBodies: false })).toEqual([titleProjectId]);
    expect(await svc.findMentionedProjectIds(issueId)).toEqual([
      titleProjectId,
      commentProjectId,
    ]);
  });
});

describeEmbeddedPostgres("issueService.clearExecutionRunIfTerminal", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-issues-execution-lock-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedIssueWithRun(status: string | null) {
    const squadId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = status ? randomUUID() : null;

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      squadId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    if (runId) {
      await db.insert(heartbeatRuns).values({
        id: runId,
        squadId,
        agentId,
        status,
        invocationSource: "manual",
      });
    }
    await db.insert(issues).values({
      id: issueId,
      squadId,
      title: "Execution lock",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: runId,
      executionAgentNameKey: runId ? "codexcoder" : null,
      executionLockedAt: runId ? new Date() : null,
    });

    return { issueId, runId };
  }

  it("clears execution locks owned by terminal runs", async () => {
    const { issueId } = await seedIssueWithRun("failed");

    await expect(svc.clearExecutionRunIfTerminal(issueId)).resolves.toBe(true);

    const row = await db
      .select({
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row).toEqual({
      executionRunId: null,
      executionAgentNameKey: null,
      executionLockedAt: null,
    });
  });

  it("does not clear execution locks owned by live runs", async () => {
    const { issueId, runId } = await seedIssueWithRun("running");

    await expect(svc.clearExecutionRunIfTerminal(issueId)).resolves.toBe(false);

    const row = await db
      .select({
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row?.executionRunId).toBe(runId);
    expect(row?.executionAgentNameKey).toBe("codexcoder");
    expect(row?.executionLockedAt).toBeInstanceOf(Date);
  });

  it("does not update issues without an execution lock", async () => {
    const { issueId } = await seedIssueWithRun(null);

    await expect(svc.clearExecutionRunIfTerminal(issueId)).resolves.toBe(false);

    const row = await db
      .select({ executionRunId: issues.executionRunId, executionLockedAt: issues.executionLockedAt })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row).toEqual({ executionRunId: null, executionLockedAt: null });
  });
});

describeEmbeddedPostgres("accepted plan decomposition", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-accepted-plan-decomposition-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issuePlanDecompositions);
    await db.delete(issueThreadInteractions);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAcceptedPlanContext() {
    const squadId = randomUUID();
    const goalId = randomUUID();
    const assigneeAgentId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });
    await db.insert(agents).values({
      id: assigneeAgentId,
      squadId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(goals).values({
      id: goalId,
      squadId,
      title: "Accepted plan decomposition",
      level: "task",
      status: "active",
    });

    return { squadId, goalId, assigneeAgentId };
  }

  async function seedAcceptedPlanIssue(args?: {
    squadId?: string;
    goalId?: string;
    assigneeAgentId?: string;
    sourceIssueId?: string;
    issueTitle?: string;
    workMode?: "planning" | "standard";
  }) {
    const squadId = args?.squadId ?? randomUUID();
    const goalId = args?.goalId ?? randomUUID();
    const assigneeAgentId = args?.assigneeAgentId ?? randomUUID();
    const sourceIssueId = args?.sourceIssueId ?? randomUUID();
    const planDocumentId = randomUUID();
    const acceptedPlanRevisionId = randomUUID();
    const acceptedInteractionId = randomUUID();

    if (!args?.squadId || !args?.goalId || !args?.assigneeAgentId) {
      await db.insert(squads).values({
        id: squadId,
        name: "Slaw",
        issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireOperatorApprovalForNewAgents: false,
      });
      await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });
      await db.insert(agents).values({
        id: assigneeAgentId,
        squadId,
        name: "CodexCoder",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });
      await db.insert(goals).values({
        id: goalId,
        squadId,
        title: "Accepted plan decomposition",
        level: "task",
        status: "active",
      });
    }

    await db.insert(issues).values({
      id: sourceIssueId,
      squadId,
      goalId,
      title: args?.issueTitle ?? "Planning issue",
      status: "in_progress",
      priority: "medium",
      workMode: args?.workMode ?? "planning",
      assigneeAgentId: assigneeAgentId,
    });
    await db.insert(documents).values({
      id: planDocumentId,
      squadId,
      title: "Plan",
      format: "markdown",
      latestBody: "Plan body",
      latestRevisionId: acceptedPlanRevisionId,
      latestRevisionNumber: 1,
      createdByAgentId: assigneeAgentId,
      updatedByAgentId: assigneeAgentId,
    });
    await db.insert(documentRevisions).values({
      id: acceptedPlanRevisionId,
      squadId,
      documentId: planDocumentId,
      revisionNumber: 1,
      title: "Plan",
      format: "markdown",
      body: "Plan body",
      createdByAgentId: assigneeAgentId,
    });
    await db.insert(issueDocuments).values({
      squadId,
      issueId: sourceIssueId,
      documentId: planDocumentId,
      key: "plan",
    });
    await db.insert(issueThreadInteractions).values({
      id: acceptedInteractionId,
      squadId,
      issueId: sourceIssueId,
      kind: "request_confirmation",
      status: "accepted",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        prompt: "Approve this plan?",
        target: {
          type: "issue_document",
          issueId: sourceIssueId,
          documentId: planDocumentId,
          key: "plan",
          revisionId: acceptedPlanRevisionId,
          revisionNumber: 1,
        },
      },
      result: {
        version: 1,
        outcome: "accepted",
      },
      resolvedAt: new Date(),
      createdByUserId: "local-operator",
      resolvedByUserId: "local-operator",
    });

    return { squadId, sourceIssueId, acceptedPlanRevisionId, assigneeAgentId };
  }

  async function getAcceptedPlanClaim(sourceIssueId: string) {
    return db
      .select()
      .from(issuePlanDecompositions)
      .where(eq(issuePlanDecompositions.sourceIssueId, sourceIssueId))
      .then((rows) => rows[0] ?? null);
  }

  it("reuses the same child issue set on repeat decomposition attempts for an accepted plan revision", async () => {
    const { squadId, sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();

    const children = [
      {
        title: "Implement the claim table",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
        assigneeAgentId,
      },
      {
        title: "Add decomposition route tests",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
    ];

    const first = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });

    expect(first.decomposition).not.toHaveProperty("requestedChildren");
    expect(first.childIssueIds).toHaveLength(2);
    expect(first.newlyCreatedIssues).toHaveLength(2);
    expect(first.decomposition.status).toBe("completed");

    const second = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });

    expect(second.childIssueIds).toEqual(first.childIssueIds);
    expect(second.newlyCreatedIssues).toHaveLength(0);
    expect(second.decomposition.status).toBe("completed");

    const persistedClaims = await db
      .select()
      .from(issuePlanDecompositions)
      .where(eq(issuePlanDecompositions.sourceIssueId, sourceIssueId));
    expect(persistedClaims).toHaveLength(1);
    expect(persistedClaims[0]?.requestedChildCount).toBe(2);
    expect(persistedClaims[0]?.childIssueIds).toEqual(first.childIssueIds);

    const childrenRows = await db
      .select({ id: issues.id, title: issues.title })
      .from(issues)
      .where(eq(issues.parentId, sourceIssueId));
    expect(childrenRows).toHaveLength(2);
    expect(childrenRows.map((row) => row.id).sort()).toEqual([...first.childIssueIds].sort());

    const squadIssues = await svc.list(squadId, { parentId: sourceIssueId });
    expect(squadIssues).toHaveLength(2);
  });

  it("rejects a different child set for the same accepted plan fingerprint", async () => {
    const { sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();

    await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children: [
        {
          title: "Implement the claim table",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    });

    await expect(svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children: [
        {
          title: "Implement the claim table",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
        {
          title: "This duplicate should be rejected",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("allows accepted-plan decomposition on a standard-work issue with an accepted plan document", async () => {
    const { sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue({
      workMode: "standard",
      issueTitle: "Implement after planning",
    });

    const result = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children: [
        {
          title: "Implement the approved first slice",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    });

    expect(result.childIssueIds).toHaveLength(1);
    expect(result.newlyCreatedIssues).toHaveLength(1);
    expect(result.decomposition.status).toBe("completed");
  });

  it("serializes concurrent accepted-plan retries for the same parent issue without duplicate children", async () => {
    const { sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();
    const children = [
      {
        title: "Persist exact-once decomposition claim",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
      {
        title: "Guard concurrent retry callers",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
    ];

    const initial = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });
    const claim = await getAcceptedPlanClaim(sourceIssueId);
    expect(claim).not.toBeNull();

    for (const childIssueId of initial.childIssueIds) {
      await db.delete(issues).where(eq(issues.id, childIssueId));
    }
    await db
      .update(issuePlanDecompositions)
      .set({
        status: "in_flight",
        childIssueIds: [],
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(issuePlanDecompositions.id, claim!.id));

    const svcA = issueService(db);
    const svcB = issueService(db);
    const [first, second] = await Promise.all([
      svcA.decomposeAcceptedPlan(sourceIssueId, {
        acceptedPlanRevisionId,
        children,
        actorAgentId: assigneeAgentId,
      }),
      svcB.decomposeAcceptedPlan(sourceIssueId, {
        acceptedPlanRevisionId,
        children,
        actorAgentId: assigneeAgentId,
      }),
    ]);

    expect(first.childIssueIds).toEqual(second.childIssueIds);
    expect(first.childIssueIds).toHaveLength(2);
    expect(first.newlyCreatedIssues.length + second.newlyCreatedIssues.length).toBe(2);

    const persistedClaim = await getAcceptedPlanClaim(sourceIssueId);
    expect(persistedClaim?.status).toBe("completed");
    expect(persistedClaim?.childIssueIds).toEqual(first.childIssueIds);

    const childrenRows = await db
      .select({ id: issues.id, title: issues.title })
      .from(issues)
      .where(eq(issues.parentId, sourceIssueId));
    expect(childrenRows).toHaveLength(2);
    expect(childrenRows.map((row) => row.id).sort()).toEqual([...first.childIssueIds].sort());
  });

  it("rejects another planning parent's accepted revision even when both issues share the assignee", async () => {
    const { squadId, goalId, assigneeAgentId } = await seedAcceptedPlanContext();
    const firstIssue = await seedAcceptedPlanIssue({
      squadId,
      goalId,
      assigneeAgentId,
      issueTitle: "Earlier accepted plan",
    });
    const secondIssue = await seedAcceptedPlanIssue({
      squadId,
      goalId,
      assigneeAgentId,
      issueTitle: "Later accepted plan",
    });

    await svc.decomposeAcceptedPlan(firstIssue.sourceIssueId, {
      acceptedPlanRevisionId: firstIssue.acceptedPlanRevisionId,
      children: [
        {
          title: "Decompose the first issue only",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    });

    await expect(svc.decomposeAcceptedPlan(secondIssue.sourceIssueId, {
      acceptedPlanRevisionId: firstIssue.acceptedPlanRevisionId,
      children: [
        {
          title: "This must not land on the second parent",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    })).rejects.toMatchObject({
      status: 422,
    });

    const secondIssueChildren = await db
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.parentId, secondIssue.sourceIssueId));
    expect(secondIssueChildren).toHaveLength(0);
  });

  it("resumes partial child creation under the claimed fingerprint without duplicating completed children", async () => {
    const { sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();
    const children = [
      {
        title: "Create the first child once",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
      {
        title: "Recreate only the missing tail child",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
    ];

    const initial = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });
    const claim = await getAcceptedPlanClaim(sourceIssueId);
    expect(claim).not.toBeNull();

    const [firstChildId, secondChildId] = initial.childIssueIds;
    expect(firstChildId).toBeTruthy();
    expect(secondChildId).toBeTruthy();

    await db.delete(issues).where(eq(issues.id, secondChildId!));
    await db
      .update(issuePlanDecompositions)
      .set({
        status: "in_flight",
        childIssueIds: [firstChildId!],
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(issuePlanDecompositions.id, claim!.id));

    const retried = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });

    expect(retried.decomposition.status).toBe("completed");
    expect(retried.childIssueIds[0]).toBe(firstChildId);
    expect(retried.newlyCreatedIssues).toHaveLength(1);
    expect(retried.newlyCreatedIssues[0]?.title).toBe("Recreate only the missing tail child");

    const childrenRows = await db
      .select({ id: issues.id, title: issues.title })
      .from(issues)
      .where(eq(issues.parentId, sourceIssueId));
    expect(childrenRows).toHaveLength(2);
    expect(childrenRows.some((row) => row.id === firstChildId)).toBe(true);
    expect(childrenRows.map((row) => row.title).sort()).toEqual(children.map((child) => child.title).sort());
  });

  it("resumes a partial decomposition after reassignment when only actor metadata changes", async () => {
    const { squadId, sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();
    const reassignedAgentId = randomUUID();
    await db.insert(agents).values({
      id: reassignedAgentId,
      squadId,
      name: "SecondCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const children = [
      {
        title: "Keep the original child",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
        createdByAgentId: assigneeAgentId,
        actorAgentId: assigneeAgentId,
      },
      {
        title: "Create only the missing child after reassignment",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
        createdByAgentId: assigneeAgentId,
        actorAgentId: assigneeAgentId,
      },
    ];

    const initial = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
    });
    const claim = await getAcceptedPlanClaim(sourceIssueId);
    const [firstChildId, secondChildId] = initial.childIssueIds;

    expect(claim).not.toBeNull();
    expect(firstChildId).toBeTruthy();
    expect(secondChildId).toBeTruthy();

    await db.delete(issues).where(eq(issues.id, secondChildId!));
    await db
      .update(issues)
      .set({ assigneeAgentId: reassignedAgentId, updatedAt: new Date() })
      .where(eq(issues.id, sourceIssueId));
    await db
      .update(issuePlanDecompositions)
      .set({
        status: "in_flight",
        childIssueIds: [firstChildId!],
        completedAt: null,
        ownerAgentId: assigneeAgentId,
        updatedAt: new Date(),
      })
      .where(eq(issuePlanDecompositions.id, claim!.id));

    const retried = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children: children.map((child) => ({
        ...child,
        createdByAgentId: reassignedAgentId,
        actorAgentId: reassignedAgentId,
      })),
      actorAgentId: reassignedAgentId,
    });

    expect(retried.decomposition.status).toBe("completed");
    expect(retried.decomposition.ownerAgentId).toBe(reassignedAgentId);
    expect(retried.childIssueIds[0]).toBe(firstChildId);
    expect(retried.newlyCreatedIssues).toHaveLength(1);
    expect(retried.newlyCreatedIssues[0]?.title).toBe("Create only the missing child after reassignment");

    const childrenRows = await db
      .select({ id: issues.id, title: issues.title, createdByAgentId: issues.createdByAgentId })
      .from(issues)
      .where(eq(issues.parentId, sourceIssueId))
      .orderBy(asc(issues.createdAt), asc(issues.id));
    expect(childrenRows).toHaveLength(2);
    expect(childrenRows.map((row) => row.id).sort()).toEqual([...retried.childIssueIds].sort());
    expect(childrenRows.find((row) => row.id !== firstChildId)?.createdByAgentId).toBe(reassignedAgentId);
  });

  it("preserves the existing live claim owner when another actor resumes the same fingerprint", async () => {
    const { squadId, sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();
    const competingAgentId = randomUUID();
    const liveOwnerRunId = randomUUID();
    const competingRunId = randomUUID();
    await db.insert(agents).values({
      id: competingAgentId,
      squadId,
      name: "SecondCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values([
      {
        id: liveOwnerRunId,
        squadId,
        agentId: assigneeAgentId,
        status: "running",
        invocationSource: "manual",
      },
      {
        id: competingRunId,
        squadId,
        agentId: competingAgentId,
        status: "running",
        invocationSource: "manual",
      },
    ]);

    const children = [
      {
        title: "Keep the first created child",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
      {
        title: "Create the missing second child",
        status: "todo" as const,
        workMode: "standard" as const,
        priority: "medium" as const,
      },
    ];

    const initial = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: assigneeAgentId,
      actorRunId: liveOwnerRunId,
    });
    const [firstChildId, secondChildId] = initial.childIssueIds;
    const claim = await getAcceptedPlanClaim(sourceIssueId);

    await db.delete(issues).where(eq(issues.id, secondChildId!));
    await db
      .update(issuePlanDecompositions)
      .set({
        status: "in_flight",
        childIssueIds: [firstChildId!],
        completedAt: null,
        ownerAgentId: assigneeAgentId,
        ownerRunId: liveOwnerRunId,
        updatedAt: new Date(),
      })
      .where(eq(issuePlanDecompositions.id, claim!.id));

    const retried = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children,
      actorAgentId: competingAgentId,
      actorRunId: competingRunId,
    });

    expect(retried.decomposition.status).toBe("completed");
    expect(retried.decomposition.ownerAgentId).toBe(assigneeAgentId);
    expect(retried.decomposition.ownerRunId).toBe(liveOwnerRunId);
  });

  it("lists persisted decompositions with child issue summaries", async () => {
    const { sourceIssueId, acceptedPlanRevisionId, assigneeAgentId } = await seedAcceptedPlanIssue();

    const initial = await svc.listAcceptedPlanDecompositions(sourceIssueId);
    expect(initial).toEqual([]);

    const result = await svc.decomposeAcceptedPlan(sourceIssueId, {
      acceptedPlanRevisionId,
      children: [
        {
          title: "Surface decomposition status in operator UI",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
        {
          title: "Add regression coverage",
          status: "todo",
          workMode: "standard",
          priority: "medium",
        },
      ],
      actorAgentId: assigneeAgentId,
    });

    const decompositions = await svc.listAcceptedPlanDecompositions(sourceIssueId);
    expect(decompositions).toHaveLength(1);
    const [record] = decompositions;
    expect(record?.status).toBe("completed");
    expect(record?.acceptedPlanRevisionId).toBe(acceptedPlanRevisionId);
    expect(record?.acceptedPlanRevisionNumber).toBeTypeOf("number");
    expect(record?.childIssues.map((child) => child.id).sort()).toEqual(
      [...result.childIssueIds].sort(),
    );
    expect(record).not.toHaveProperty("requestedChildren");
    expect(record?.childIssues.every((child) => typeof child.title === "string")).toBe(true);
  });
});
