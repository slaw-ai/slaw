import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentMemberships,
  agents,
  squads,
  createDb,
  projectMemberships,
  projects,
} from "@slaw/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { resourceMembershipRoutes } from "../routes/resource-memberships.js";
import { errorHandler } from "../middleware/index.js";
import { resourceMembershipService } from "../services/resource-memberships.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres resource membership tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function operatorActor(squadId: string, role: "admin" | "operator" | "viewer" = "viewer") {
  return {
    type: "operator" as const,
    userId: "user-1",
    source: "session" as const,
    isInstanceAdmin: false,
    squadIds: [squadId],
    memberships: [{ squadId, membershipRole: role, status: "active" }],
  };
}

function createApp(db: ReturnType<typeof createDb>, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", resourceMembershipRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("resource membership routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-resource-memberships-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(projectMemberships);
    await db.delete(agentMemberships);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const squadId = randomUUID();
    const otherSquadId = randomUUID();
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();
    await db.insert(squads).values([
      {
        id: squadId,
        name: "Slaw",
        issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireOperatorApprovalForNewAgents: false,
      },
      {
        id: otherSquadId,
        name: "Other",
        issuePrefix: `T${otherSquadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireOperatorApprovalForNewAgents: false,
      },
    ]);
    await db.insert(projects).values([
      { id: projectId, squadId, name: "Growth", status: "in_progress" },
      { id: otherProjectId, squadId: otherSquadId, name: "Other", status: "in_progress" },
    ]);
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
        squadId: otherSquadId,
        name: "OtherAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    return { squadId, otherAgentId, otherProjectId, projectId, agentId };
  }

  it("defaults missing membership rows to joined", async () => {
    const { squadId } = await seed();
    const app = createApp(db, operatorActor(squadId));

    const res = await request(app).get(`/api/squads/${squadId}/resource-memberships/me`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projectMemberships: {},
      agentMemberships: {},
      updatedAt: null,
    });
  });

  it("allows viewer self-service mutations, logs changes, and keeps repeats idempotent", async () => {
    const { squadId, projectId } = await seed();
    const app = createApp(db, operatorActor(squadId, "viewer"));

    const first = await request(app)
      .put(`/api/squads/${squadId}/resource-memberships/me/projects/${projectId}`)
      .send({ state: "left" });
    const second = await request(app)
      .put(`/api/squads/${squadId}/resource-memberships/me/projects/${projectId}`)
      .send({ state: "left" });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ resourceType: "project", resourceId: projectId, state: "left" });
    expect(second.status).toBe(200);

    const rows = await db.select().from(projectMemberships);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ squadId, projectId, userId: "user-1", state: "left" });

    const activity = await db.select().from(activityLog);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      squadId,
      actorType: "user",
      actorId: "user-1",
      action: "resource_membership.left",
      entityType: "project",
      entityId: projectId,
    });
  });

  it("rejects agent API key actors", async () => {
    const { squadId, agentId } = await seed();
    const app = createApp(db, {
      type: "agent",
      agentId,
      squadId,
      source: "agent_key",
    });

    const res = await request(app).get(`/api/squads/${squadId}/resource-memberships/me`);

    expect(res.status).toBe(403);
  });

  it("rejects cross-squad target resources", async () => {
    const { squadId, otherAgentId, otherProjectId } = await seed();
    const app = createApp(db, operatorActor(squadId));

    const projectRes = await request(app)
      .put(`/api/squads/${squadId}/resource-memberships/me/projects/${otherProjectId}`)
      .send({ state: "left" });
    const agentRes = await request(app)
      .put(`/api/squads/${squadId}/resource-memberships/me/agents/${otherAgentId}`)
      .send({ state: "left" });

    expect(projectRes.status).toBe(404);
    expect(agentRes.status).toBe(404);
    await expect(db.select().from(projectMemberships)).resolves.toHaveLength(0);
    await expect(db.select().from(agentMemberships)).resolves.toHaveLength(0);
  });

  it("denies direct service calls that try to mutate another user's membership", async () => {
    const { squadId, projectId } = await seed();
    const svc = resourceMembershipService(db);

    await expect(
      svc.updateProject({
        squadId,
        projectId,
        userId: "other-user",
        state: "left",
        actor: operatorActor(squadId),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
