import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@slaw/db";
import { heartbeatService } from "../services/heartbeat.ts";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.ts";


async function closeDbClient(db: ReturnType<typeof createDb> | undefined) {
  await db?.$client?.end?.({ timeout: 0 });
}

describe("heartbeat comment wake batching", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("slaw-heartbeat-comment-wake-");
    db = createDb(started.connectionString);
    tempDb = started;
  }, 120_000);

  afterAll(async () => {
    await closeDbClient(db);
    await tempDb?.cleanup();
  });

  it("defers approval-approved wakes for a running issue so the assignee resumes after the run", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const heartbeat = heartbeatService(db);

    await db.insert(companies).values({
      id: companyId,
      name: "Slaw",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "running",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      contextSnapshot: {
        issueId,
        taskId: issueId,
        wakeReason: "issue_assigned",
      },
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Hire an agent",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: runId,
      executionAgentNameKey: "ceo",
      executionLockedAt: new Date(),
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    const followupRun = await heartbeat.wakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "approval_approved",
      payload: {
        issueId,
        approvalId: "approval-1",
        approvalStatus: "approved",
      },
      contextSnapshot: {
        issueId,
        taskId: issueId,
        approvalId: "approval-1",
        approvalStatus: "approved",
        wakeReason: "approval_approved",
      },
      requestedByActorType: "user",
      requestedByActorId: "local-board",
    });

    expect(followupRun).toBeNull();

    const deferred = await db
      .select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, agentId),
          eq(agentWakeupRequests.status, "deferred_issue_execution"),
        ),
      )
      .then((rows) => rows[0] ?? null);

    expect(deferred).not.toBeNull();
    expect(deferred?.reason).toBe("issue_execution_deferred");
    expect(deferred?.payload).toMatchObject({
      issueId,
      approvalId: "approval-1",
      approvalStatus: "approved",
    });
    expect((deferred?.payload as Record<string, unknown>)._slawWakeContext).toMatchObject({
      issueId,
      taskId: issueId,
      approvalId: "approval-1",
      approvalStatus: "approved",
      wakeReason: "approval_approved",
    });

    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe(runId);
  });
});
