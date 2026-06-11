import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, squads, createDb, environmentLeases, environments, heartbeatRuns } from "@slaw-ai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { environmentService } from "../services/environments.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres environment service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("environmentService leases", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof environmentService>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("environment-service");
    stopDb = started.stop;
    db = createDb(started.connectionString);
    svc = environmentService(db);
  });

  afterEach(async () => {
    await db.delete(environmentLeases);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(environments);
    await db.delete(squads);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedEnvironment() {
    const squadId = randomUUID();
    const agentId = randomUUID();
    const environmentId = randomUUID();
    const runId = randomUUID();

    await db.insert(squads).values({
      id: squadId,
      name: "Acme",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(environments).values({
      id: environmentId,
      squadId,
      name: "Local",
      driver: "local",
      status: "active",
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      squadId,
      agentId,
      invocationSource: "manual",
      status: "running",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { squadId, agentId, environmentId, runId };
  }

  it("acquires and releases a lease for a run", async () => {
    const { squadId, environmentId, runId } = await seedEnvironment();

    const lease = await svc.acquireLease({
      squadId,
      environmentId,
      heartbeatRunId: runId,
      metadata: { driver: "local" },
    });

    expect(lease.status).toBe("active");
    expect(lease.heartbeatRunId).toBe(runId);

    const released = await svc.releaseLease(lease.id);

    expect(released?.status).toBe("released");
    expect(released?.releasedAt).not.toBeNull();
  });

  it("releases all active leases for a run without touching unrelated rows", async () => {
    const { squadId, agentId, environmentId, runId } = await seedEnvironment();
    const otherRunId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: otherRunId,
      squadId,
      agentId,
      invocationSource: "manual",
      status: "running",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const targetLease = await svc.acquireLease({
      squadId,
      environmentId,
      heartbeatRunId: runId,
    });
    const otherLease = await svc.acquireLease({
      squadId,
      environmentId,
      heartbeatRunId: otherRunId,
    });

    const released = await svc.releaseLeasesForRun(runId);

    expect(released.map((lease) => lease.id)).toEqual([targetLease.id]);

    const stillActive = await svc.listLeases(environmentId, { status: "active" });
    expect(stillActive.map((lease) => lease.id)).toEqual([otherLease.id]);
  });

  it("creates and then reuses the default local environment for a squad", async () => {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Acme",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const created = await svc.ensureLocalEnvironment(squadId);
    const reused = await svc.ensureLocalEnvironment(squadId);

    expect(created.driver).toBe("local");
    expect(reused.id).toBe(created.id);

    const rows = await db.select().from(environments).where(eq(environments.squadId, squadId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Local");
  });

  it("leaves an existing default local environment untouched", async () => {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Acme",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const archivedAt = new Date("2025-01-01T00:00:00.000Z");
    const [existing] = await db
      .insert(environments)
      .values({
        squadId,
        name: "Archived Local",
        description: "Operator-managed local environment",
        driver: "local",
        status: "archived",
        config: { shell: "zsh" },
        metadata: { owner: "operator" },
        createdAt: archivedAt,
        updatedAt: archivedAt,
      })
      .returning();

    const ensured = await svc.ensureLocalEnvironment(squadId);

    expect(ensured.id).toBe(existing?.id);
    expect(ensured.name).toBe("Archived Local");
    expect(ensured.status).toBe("archived");
    expect(ensured.metadata).toEqual({ owner: "operator" });

    const rows = await db.select().from(environments).where(eq(environments.squadId, squadId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.updatedAt.toISOString()).toBe(archivedAt.toISOString());
  });

  it("deduplicates concurrent default local environment creation", async () => {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Acme",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => svc.ensureLocalEnvironment(squadId)),
    );

    expect(new Set(results.map((environment) => environment.id)).size).toBe(1);

    const rows = await db.select().from(environments).where(eq(environments.squadId, squadId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.driver).toBe("local");
    expect(rows[0]?.status).toBe("active");
  });

  it("allows multiple SSH environments for the same squad", async () => {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Acme",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const first = await svc.create(squadId, {
      name: "Production SSH",
      driver: "ssh",
      config: { host: "prod.example.com", username: "deploy" },
    });
    const second = await svc.create(squadId, {
      name: "Staging SSH",
      driver: "ssh",
      config: { host: "staging.example.com", username: "deploy" },
    });

    expect(first.id).not.toBe(second.id);

    const rows = await db.select().from(environments).where(eq(environments.squadId, squadId));
    expect(rows.filter((row) => row.driver === "ssh")).toHaveLength(2);
  });
});
