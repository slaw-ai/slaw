import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  approvals,
  squads,
  createDb,
  heartbeatRuns,
  inboxDismissals,
  invites,
  joinRequests,
} from "@slaw-ai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { inboxDismissalService } from "../services/inbox-dismissals.ts";
import { sidebarBadgeService } from "../services/sidebar-badges.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres inbox dismissal tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("inbox dismissals", () => {
  let db!: ReturnType<typeof createDb>;
  let dismissalsSvc!: ReturnType<typeof inboxDismissalService>;
  let badgesSvc!: ReturnType<typeof sidebarBadgeService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-inbox-dismissals-");
    db = createDb(tempDb.connectionString);
    dismissalsSvc = inboxDismissalService(db);
    badgesSvc = sidebarBadgeService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(inboxDismissals);
    await db.delete(joinRequests);
    await db.delete(invites);
    await db.delete(heartbeatRuns);
    await db.delete(approvals);
    await db.delete(agents);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("upserts a single dismissal record per user and inbox item key", async () => {
    const squadId = randomUUID();
    const userId = "operator-user";
    const firstDismissedAt = new Date("2026-03-11T01:00:00.000Z");
    const secondDismissedAt = new Date("2026-03-11T02:00:00.000Z");

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: "PAP",
      requireOperatorApprovalForNewAgents: false,
    });

    await dismissalsSvc.dismiss(squadId, userId, "approval:approval-1", firstDismissedAt);
    await dismissalsSvc.dismiss(squadId, userId, "approval:approval-1", secondDismissedAt);

    const dismissals = await dismissalsSvc.list(squadId, userId);

    expect(dismissals).toHaveLength(1);
    expect(dismissals[0]?.itemKey).toBe("approval:approval-1");
    expect(new Date(dismissals[0]?.dismissedAt ?? 0).toISOString()).toBe(secondDismissedAt.toISOString());
  });

  it("honors dismissal timestamps and resurfaces approvals with newer activity", async () => {
    const squadId = randomUUID();
    const userId = "operator-user";
    const primaryAgentId = randomUUID();
    const secondaryAgentId = randomUUID();
    const hiddenApprovalId = randomUUID();
    const resurfacedApprovalId = randomUUID();
    const inviteId = randomUUID();
    const hiddenJoinRequestId = randomUUID();
    const hiddenRunId = randomUUID();
    const visibleRunId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: "PAP",
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: primaryAgentId,
        squadId,
        name: "Primary",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: secondaryAgentId,
        squadId,
        name: "Secondary",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(approvals).values([
      {
        id: hiddenApprovalId,
        squadId,
        type: "hire_agent",
        status: "pending",
        payload: {},
        updatedAt: new Date("2026-03-11T01:00:00.000Z"),
      },
      {
        id: resurfacedApprovalId,
        squadId,
        type: "hire_agent",
        status: "revision_requested",
        payload: {},
        updatedAt: new Date("2026-03-11T03:00:00.000Z"),
      },
    ]);

    await db.insert(invites).values({
      id: inviteId,
      squadId,
      inviteType: "squad_join",
      tokenHash: "hash-1",
      allowedJoinTypes: "both",
      expiresAt: new Date("2026-03-12T00:00:00.000Z"),
    });

    await db.insert(joinRequests).values({
      id: hiddenJoinRequestId,
      inviteId,
      squadId,
      requestType: "human",
      status: "pending_approval",
      requestIp: "127.0.0.1",
      createdAt: new Date("2026-03-11T01:00:00.000Z"),
      updatedAt: new Date("2026-03-11T01:00:00.000Z"),
    });

    await db.insert(heartbeatRuns).values([
      {
        id: hiddenRunId,
        squadId,
        agentId: primaryAgentId,
        invocationSource: "assignment",
        status: "failed",
        createdAt: new Date("2026-03-11T01:00:00.000Z"),
        updatedAt: new Date("2026-03-11T01:00:00.000Z"),
      },
      {
        id: visibleRunId,
        squadId,
        agentId: secondaryAgentId,
        invocationSource: "assignment",
        status: "timed_out",
        createdAt: new Date("2026-03-11T04:00:00.000Z"),
        updatedAt: new Date("2026-03-11T04:00:00.000Z"),
      },
    ]);

    await dismissalsSvc.dismiss(squadId, userId, `approval:${hiddenApprovalId}`, new Date("2026-03-11T02:00:00.000Z"));
    await dismissalsSvc.dismiss(squadId, userId, `approval:${resurfacedApprovalId}`, new Date("2026-03-11T02:00:00.000Z"));
    await dismissalsSvc.dismiss(squadId, userId, `join:${hiddenJoinRequestId}`, new Date("2026-03-11T02:00:00.000Z"));
    await dismissalsSvc.dismiss(squadId, userId, `run:${hiddenRunId}`, new Date("2026-03-11T02:00:00.000Z"));

    const dismissedAtByKey = new Map(
      (await dismissalsSvc.list(squadId, userId)).map((dismissal) => [
        dismissal.itemKey,
        new Date(dismissal.dismissedAt).getTime(),
      ]),
    );

    const badges = await badgesSvc.get(squadId, {
      dismissals: dismissedAtByKey,
      joinRequests: [{
        id: hiddenJoinRequestId,
        createdAt: new Date("2026-03-11T01:00:00.000Z"),
        updatedAt: new Date("2026-03-11T01:00:00.000Z"),
      }],
      unreadTouchedIssues: 1,
    });

    expect(badges).toEqual({
      inbox: 3,
      approvals: 1,
      failedRuns: 1,
      joinRequests: 0,
    });
  });
});
