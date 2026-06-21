import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  createDb,
  goals,
  heartbeatRuns,
  issueComments,
  issues,
  instanceSettings,
  squads,
} from "@slaw-ai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("issueService.getOrCreateLeadThread", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-lead-thread-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(goals);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedSquadWithLead(): Promise<{ squadId: string; leadId: string }> {
    const squadId = randomUUID();
    const leadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: leadId,
      squadId,
      name: "Squad Lead",
      role: "squad_lead",
      status: "active",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return { squadId, leadId };
  }

  it("creates a Lead thread on first call, assigned to the Squad Lead and marked thread_type='lead'", async () => {
    const { squadId, leadId } = await seedSquadWithLead();

    const thread = await svc.getOrCreateLeadThread(squadId);

    expect(thread.threadType).toBe("lead");
    expect(thread.assigneeAgentId).toBe(leadId);
    expect(thread.squadId).toBe(squadId);

    const rows = await db
      .select()
      .from(issues)
      .where(and(eq(issues.squadId, squadId), eq(issues.threadType, "lead")));
    expect(rows).toHaveLength(1);
  });

  it("is idempotent — a second call returns the same Lead thread, not a duplicate", async () => {
    const { squadId } = await seedSquadWithLead();

    const first = await svc.getOrCreateLeadThread(squadId);
    const second = await svc.getOrCreateLeadThread(squadId);

    expect(second.id).toBe(first.id);

    const rows = await db
      .select()
      .from(issues)
      .where(and(eq(issues.squadId, squadId), eq(issues.threadType, "lead")));
    expect(rows).toHaveLength(1);
  });

  it("survives a concurrent create race and still yields exactly one Lead thread", async () => {
    const { squadId } = await seedSquadWithLead();

    const [a, b] = await Promise.all([
      svc.getOrCreateLeadThread(squadId),
      svc.getOrCreateLeadThread(squadId),
    ]);

    expect(a.id).toBe(b.id);

    const rows = await db
      .select()
      .from(issues)
      .where(and(eq(issues.squadId, squadId), eq(issues.threadType, "lead")));
    expect(rows).toHaveLength(1);
  });

  it("does not return another squad's Lead thread", async () => {
    const first = await seedSquadWithLead();
    const second = await seedSquadWithLead();

    const firstThread = await svc.getOrCreateLeadThread(first.squadId);
    const secondThread = await svc.getOrCreateLeadThread(second.squadId);

    expect(secondThread.id).not.toBe(firstThread.id);
    expect(firstThread.squadId).toBe(first.squadId);
    expect(secondThread.squadId).toBe(second.squadId);
  });

  it("throws when the squad has no Squad Lead agent", async () => {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Leaderless",
      issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await expect(svc.getOrCreateLeadThread(squadId)).rejects.toThrow(/Squad Lead/i);
  });
});
