import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  squads,
  createDb,
  projects,
  routines,
} from "@slaw-ai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { disableAllRoutinesInConfig } from "../commands/routines.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres routines CLI tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function writeTestConfig(configPath: string, tempRoot: string, connectionString: string) {
  const config = {
    $meta: {
      version: 1,
      updatedAt: new Date().toISOString(),
      source: "doctor" as const,
    },
    database: {
      mode: "postgres" as const,
      connectionString,
      embeddedPostgresDataDir: path.join(tempRoot, "embedded-db"),
      embeddedPostgresPort: 54329,
      backup: {
        enabled: false,
        intervalMinutes: 60,
        retentionDays: 30,
        dir: path.join(tempRoot, "backups"),
      },
    },
    logging: {
      mode: "file" as const,
      logDir: path.join(tempRoot, "logs"),
    },
    server: {
      deploymentMode: "local_trusted" as const,
      exposure: "private" as const,
      host: "127.0.0.1",
      port: 3100,
      allowedHostnames: [],
      serveUi: false,
    },
    auth: {
      baseUrlMode: "auto" as const,
      disableSignUp: false,
    },
    storage: {
      provider: "local_disk" as const,
      localDisk: {
        baseDir: path.join(tempRoot, "storage"),
      },
      s3: {
        bucket: "slaw",
        region: "us-east-1",
        prefix: "",
        forcePathStyle: false,
      },
    },
    secrets: {
      provider: "local_encrypted" as const,
      strictMode: false,
      localEncrypted: {
        keyFilePath: path.join(tempRoot, "secrets", "master.key"),
      },
    },
  };

  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

describeEmbeddedPostgres("disableAllRoutinesInConfig", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let tempRoot = "";
  let configPath = "";

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-routines-cli-db-");
    db = createDb(tempDb.connectionString);
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "slaw-routines-cli-config-"));
    configPath = path.join(tempRoot, "config.json");
    writeTestConfig(configPath, tempRoot, tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(routines);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("pauses only non-archived routines for the selected squad", async () => {
    const squadId = randomUUID();
    const otherSquadId = randomUUID();
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();
    const activeRoutineId = randomUUID();
    const pausedRoutineId = randomUUID();
    const archivedRoutineId = randomUUID();
    const otherSquadRoutineId = randomUUID();

    await db.insert(squads).values([
      {
        id: squadId,
        name: "Slaw",
        issuePrefix: `T${squadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireOperatorApprovalForNewAgents: false,
      },
      {
        id: otherSquadId,
        name: "Other squad",
        issuePrefix: `T${otherSquadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireOperatorApprovalForNewAgents: false,
      },
    ]);

    await db.insert(agents).values([
      {
        id: agentId,
        squadId,
        name: "Coder",
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherAgentId,
        squadId: otherSquadId,
        name: "Other coder",
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(projects).values([
      {
        id: projectId,
        squadId,
        name: "Project",
        status: "in_progress",
      },
      {
        id: otherProjectId,
        squadId: otherSquadId,
        name: "Other project",
        status: "in_progress",
      },
    ]);

    await db.insert(routines).values([
      {
        id: activeRoutineId,
        squadId,
        projectId,
        assigneeAgentId: agentId,
        title: "Active routine",
        status: "active",
      },
      {
        id: pausedRoutineId,
        squadId,
        projectId,
        assigneeAgentId: agentId,
        title: "Paused routine",
        status: "paused",
      },
      {
        id: archivedRoutineId,
        squadId,
        projectId,
        assigneeAgentId: agentId,
        title: "Archived routine",
        status: "archived",
      },
      {
        id: otherSquadRoutineId,
        squadId: otherSquadId,
        projectId: otherProjectId,
        assigneeAgentId: otherAgentId,
        title: "Other squad routine",
        status: "active",
      },
    ]);

    const result = await disableAllRoutinesInConfig({
      config: configPath,
      squadId,
    });

    expect(result).toMatchObject({
      squadId,
      totalRoutines: 3,
      pausedCount: 1,
      alreadyPausedCount: 1,
      archivedCount: 1,
    });

    const squadRoutines = await db
      .select({
        id: routines.id,
        status: routines.status,
      })
      .from(routines)
      .where(eq(routines.squadId, squadId));
    const statusById = new Map(squadRoutines.map((routine) => [routine.id, routine.status]));

    expect(statusById.get(activeRoutineId)).toBe("paused");
    expect(statusById.get(pausedRoutineId)).toBe("paused");
    expect(statusById.get(archivedRoutineId)).toBe("archived");

    const otherSquadRoutine = await db
      .select({
        status: routines.status,
      })
      .from(routines)
      .where(eq(routines.id, otherSquadRoutineId));
    expect(otherSquadRoutine[0]?.status).toBe("active");
  });
});
