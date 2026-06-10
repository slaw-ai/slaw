import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSquadService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockSquadPortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/access.js", () => ({
  accessService: () => mockAccessService,
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => mockAgentService,
}));

vi.mock("../services/budgets.js", () => ({
  budgetService: () => mockBudgetService,
}));

vi.mock("../services/squads.js", () => ({
  squadService: () => mockSquadService,
}));

vi.mock("../services/squad-portability.js", () => ({
  squadPortabilityService: () => mockSquadPortabilityService,
}));

vi.mock("../services/feedback.js", () => ({
}));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  budgetService: () => mockBudgetService,
  squadPortabilityService: () => mockSquadPortabilityService,
  squadService: () => mockSquadService,
  logActivity: mockLogActivity,
}));

function registerSquadRouteMocks() {
  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    budgetService: () => mockBudgetService,
    squadPortabilityService: () => mockSquadPortabilityService,
    squadService: () => mockSquadService,
    logActivity: mockLogActivity,
  }));
}

let appImportCounter = 0;

async function createApp(actor: Record<string, unknown>) {
  registerSquadRouteMocks();
  appImportCounter += 1;
  const routeModulePath = `../routes/squads.js?squad-portability-routes-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?squad-portability-routes-${appImportCounter}`;
  const [{ squadRoutes }, { errorHandler }] = await Promise.all([
    import(routeModulePath) as Promise<typeof import("../routes/squads.js")>,
    import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api/squads", squadRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const squadId = "11111111-1111-4111-8111-111111111111";
const ceoAgentId = "squad_lead-agent";
const engineerAgentId = "engineer-agent";

const exportRequest = {
  include: { squad: true, agents: true, projects: true },
};

function createExportResult() {
  return {
    rootPath: "slaw",
    manifest: {
      agents: [],
      skills: [],
      projects: [],
      issues: [],
      envInputs: [],
      includes: { squad: true, agents: true, projects: true, issues: false, skills: false },
      squad: null,
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      source: null,
    },
    files: {},
    warnings: [],
  };
}

const importRequest = {
  source: { type: "inline", files: { "SQUAD.md": "---\nname: Test\n---\n" } },
  include: { squad: true, agents: true, projects: false, issues: false },
  target: { mode: "existing_squad", squadId },
  collisionStrategy: "rename",
};

const cloudHeaders = {
  "x-slaw-cloud-stack-id": "stack-alpha",
  "x-slaw-cloud-slaw-squad-id": squadId,
};

function cloudTenantActor() {
  return {
    type: "operator",
    userId: "cloud-user-1",
    userName: "Cloud User",
    userEmail: "cloud-user@example.com",
    squadIds: [squadId],
    memberships: [{ squadId, membershipRole: "owner", status: "active" }],
    isInstanceAdmin: true,
    source: "cloud_tenant",
  };
}

function createImportResult(action = "updated") {
  return {
    squad: { id: squadId, action },
    agents: [{ id: "agent-1" }],
    warnings: [],
  };
}

async function waitForImportJobStatus(app: express.Express, statusUrl: string, status: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await request(app).get(statusUrl).set(cloudHeaders);
    if (res.body.job?.status === status) {
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for import job to reach ${status}`);
}

async function waitForCondition(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe.sequential("squad portability routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockImplementation(async (id: string) => ({
      id,
      squadId,
      role: id === ceoAgentId ? "squad_lead" : "engineer",
    }));
    mockSquadPortabilityService.exportBundle.mockResolvedValue(createExportResult());
    mockSquadPortabilityService.previewExport.mockResolvedValue({
      rootPath: "slaw",
      manifest: { agents: [], skills: [], projects: [], issues: [], envInputs: [], includes: { squad: true, agents: true, projects: true, issues: false, skills: false }, squad: null, schemaVersion: 1, generatedAt: new Date().toISOString(), source: null },
      files: {},
      fileInventory: [],
      counts: { files: 0, agents: 0, skills: 0, projects: 0, issues: 0 },
      warnings: [],
      slawExtensionPath: ".slaw.yaml",
    });
    mockSquadPortabilityService.previewImport.mockResolvedValue({ ok: true });
    mockSquadPortabilityService.importBundle.mockResolvedValue({
      squad: { id: squadId, action: "created" },
      agents: [],
      warnings: [],
    });
  });

  it.sequential("rejects non-Squad Lead agents from Squad Lead-safe export preview routes", async () => {
    const app = await createApp({
      type: "agent",
      agentId: engineerAgentId,
      squadId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post(`/api/squads/${squadId}/exports/preview`)
      .send(exportRequest);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only Squad Lead agents");
    expect(mockSquadPortabilityService.previewExport).not.toHaveBeenCalled();
  });

  it.sequential("rejects non-Squad Lead agents from legacy and Squad Lead-safe export bundle routes", async () => {
    const app = await createApp({
      type: "agent",
      agentId: engineerAgentId,
      squadId,
      source: "agent_key",
      runId: "run-1",
    });

    for (const path of [`/api/squads/${squadId}/export`, `/api/squads/${squadId}/exports`]) {
      const res = await request(app).post(path).send(exportRequest);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Only Squad Lead agents");
    }
    expect(mockSquadPortabilityService.exportBundle).not.toHaveBeenCalled();
  });

  it.sequential("allows Squad Lead agents to use squad-scoped export preview routes", async () => {
    mockSquadPortabilityService.previewExport.mockResolvedValue({
      rootPath: "slaw",
      manifest: { agents: [], skills: [], projects: [], issues: [], envInputs: [], includes: { squad: true, agents: true, projects: true, issues: false, skills: false }, squad: null, schemaVersion: 1, generatedAt: new Date().toISOString(), source: null },
      files: {},
      fileInventory: [],
      counts: { files: 0, agents: 0, skills: 0, projects: 0, issues: 0 },
      warnings: [],
      slawExtensionPath: ".slaw.yaml",
    });
    const app = await createApp({
      type: "agent",
      agentId: ceoAgentId,
      squadId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post(`/api/squads/${squadId}/exports/preview`)
      .send(exportRequest);

    expect(res.status).toBe(200);
    expect(res.body.rootPath).toBe("slaw");
  });

  it.sequential("allows Squad Lead agents to export through legacy and Squad Lead-safe bundle routes", async () => {
    mockSquadPortabilityService.exportBundle.mockResolvedValue(createExportResult());
    const app = await createApp({
      type: "agent",
      agentId: ceoAgentId,
      squadId,
      source: "agent_key",
      runId: "run-1",
    });

    for (const path of [`/api/squads/${squadId}/export`, `/api/squads/${squadId}/exports`]) {
      const res = await request(app).post(path).send(exportRequest);

      expect(res.status).toBe(200);
      expect(res.body.rootPath).toBe("slaw");
    }
    expect(mockSquadPortabilityService.exportBundle).toHaveBeenCalledTimes(2);
    expect(mockSquadPortabilityService.exportBundle).toHaveBeenNthCalledWith(1, squadId, exportRequest);
    expect(mockSquadPortabilityService.exportBundle).toHaveBeenNthCalledWith(2, squadId, exportRequest);
  });

  it.sequential("allows operator users to export through legacy and Squad Lead-safe bundle routes", async () => {
    mockSquadPortabilityService.exportBundle.mockResolvedValue(createExportResult());
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      squadIds: [squadId],
      source: "session",
      isInstanceAdmin: false,
    });

    for (const path of [`/api/squads/${squadId}/export`, `/api/squads/${squadId}/exports`]) {
      const res = await request(app).post(path).send(exportRequest);

      expect(res.status).toBe(200);
      expect(res.body.rootPath).toBe("slaw");
    }
    expect(mockSquadPortabilityService.exportBundle).toHaveBeenCalledTimes(2);
  });

  it.sequential("rejects replace collision strategy on Squad Lead-safe import routes", async () => {
    const app = await createApp({
      type: "agent",
      agentId: ceoAgentId,
      squadId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/squads/11111111-1111-4111-8111-111111111111/imports/preview")
      .send({
        source: { type: "inline", files: { "SQUAD.md": "---\nname: Test\n---\n" } },
        include: { squad: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_squad", squadId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "replace",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("does not allow replace");
    expect(mockSquadPortabilityService.previewImport).not.toHaveBeenCalled();
  });

  it.sequential("keeps global import preview routes operator-only", async () => {
    const app = await createApp({
      type: "agent",
      agentId: engineerAgentId,
      squadId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/squads/import/preview")
      .send({
        source: { type: "inline", files: { "SQUAD.md": "---\nname: Test\n---\n" } },
        include: { squad: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_squad", squadId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "rename",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Operator access required");
  });

  it.sequential("requires instance admin for new-squad import preview", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      squadIds: ["11111111-1111-4111-8111-111111111111"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .post("/api/squads/import/preview")
      .send({
        source: { type: "inline", files: { "SQUAD.md": "---\nname: Test\n---\n" } },
        include: { squad: true, agents: true, projects: false, issues: false },
        target: { mode: "new_squad", newSquadName: "Imported Test" },
        collisionStrategy: "rename",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Instance admin");
    expect(mockSquadPortabilityService.previewImport).not.toHaveBeenCalled();
  });

  it.sequential("rejects replace collision strategy on Squad Lead-safe import apply routes", async () => {
    const app = await createApp({
      type: "agent",
      agentId: ceoAgentId,
      squadId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/squads/11111111-1111-4111-8111-111111111111/imports/apply")
      .send({
        source: { type: "inline", files: { "SQUAD.md": "---\nname: Test\n---\n" } },
        include: { squad: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_squad", squadId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "replace",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("does not allow replace");
    expect(mockSquadPortabilityService.importBundle).not.toHaveBeenCalled();
  });

  it.sequential("rejects non-Squad Lead agents from Squad Lead-safe import preview routes", async () => {
    const app = await createApp({
      type: "agent",
      agentId: engineerAgentId,
      squadId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/squads/11111111-1111-4111-8111-111111111111/imports/preview")
      .send({
        source: { type: "inline", files: { "SQUAD.md": "---\nname: Test\n---\n" } },
        include: { squad: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_squad", squadId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "rename",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only Squad Lead agents");
    expect(mockSquadPortabilityService.previewImport).not.toHaveBeenCalled();
  });

  it.sequential("rejects non-Squad Lead agents from Squad Lead-safe import apply routes", async () => {
    const app = await createApp({
      type: "agent",
      agentId: engineerAgentId,
      squadId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/squads/11111111-1111-4111-8111-111111111111/imports/apply")
      .send({
        source: { type: "inline", files: { "SQUAD.md": "---\nname: Test\n---\n" } },
        include: { squad: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_squad", squadId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "rename",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only Squad Lead agents");
    expect(mockSquadPortabilityService.importBundle).not.toHaveBeenCalled();
  });

  it.sequential("requires instance admin for new-squad import apply", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      squadIds: ["11111111-1111-4111-8111-111111111111"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .post("/api/squads/import")
      .send({
        source: { type: "inline", files: { "SQUAD.md": "---\nname: Test\n---\n" } },
        include: { squad: true, agents: true, projects: false, issues: false },
        target: { mode: "new_squad", newSquadName: "Imported Test" },
        collisionStrategy: "rename",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Instance admin");
    expect(mockSquadPortabilityService.importBundle).not.toHaveBeenCalled();
  });

  it.sequential("accepts trusted Cloud async import jobs and reports success by job id", async () => {
    let resolveImport: (value: ReturnType<typeof createImportResult>) => void = () => undefined;
    const pendingImport = new Promise<ReturnType<typeof createImportResult>>((resolve) => {
      resolveImport = resolve;
    });
    mockSquadPortabilityService.importBundle.mockReturnValueOnce(pendingImport);
    const app = await createApp(cloudTenantActor());

    const accepted = await request(app)
      .post("/api/squads/import")
      .set("x-slaw-cloud-async-import", "1")
      .set(cloudHeaders)
      .send(importRequest);

    expect(accepted.status).toBe(202);
    expect(accepted.body.job.status).toBe("running");
    expect(accepted.body.statusUrl).toMatch(/^\/api\/squads\/import\/jobs\/tenant-import-/);
    expect(accepted.body.retryAfterMs).toBe(1000);
    await waitForCondition(() => mockSquadPortabilityService.importBundle.mock.calls.length === 1, "import job start");
    expect(mockSquadPortabilityService.importBundle).toHaveBeenCalledWith(importRequest, "cloud-user-1");
    expect(mockLogActivity).not.toHaveBeenCalled();

    resolveImport(createImportResult("updated"));
    const succeeded = await waitForImportJobStatus(app, accepted.body.statusUrl, "succeeded");

    expect(succeeded.status).toBe(200);
    expect(succeeded.body.job.status).toBe("succeeded");
    expect(succeeded.body.job.result.squadId).toBe(squadId);
    expect(succeeded.body.retryAfterMs).toBeUndefined();
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "squad.imported",
      squadId,
      details: expect.objectContaining({
        agentCount: 1,
        warningCount: 0,
        squadAction: "updated",
      }),
    }));

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.parse(succeeded.body.job.completedAt) + (5 * 60 * 1000) + 1);
    try {
      const expired = await request(app).get(accepted.body.statusUrl).set(cloudHeaders);
      expect(expired.status).toBe(404);
      expect(expired.body.error).toBe("Import job not found");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it.sequential("reports trusted Cloud async import job failures with the tenant error message", async () => {
    mockSquadPortabilityService.importBundle.mockRejectedValueOnce(new Error("tenant import exploded"));
    const app = await createApp(cloudTenantActor());

    const accepted = await request(app)
      .post("/api/squads/import")
      .set("x-slaw-cloud-async-import", "1")
      .set(cloudHeaders)
      .send(importRequest);

    expect(accepted.status).toBe(202);
    const failed = await waitForImportJobStatus(app, accepted.body.statusUrl, "failed");

    expect(failed.status).toBe(200);
    expect(failed.body.job.status).toBe("failed");
    expect(failed.body.job.error.message).toBe("tenant import exploded");
    expect(failed.body.retryAfterMs).toBeUndefined();
    expect(failed.body.message).toBe("tenant import exploded");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it.sequential("accepts trusted Cloud async import jobs before validating the full import payload", async () => {
    const app = await createApp(cloudTenantActor());

    const accepted = await request(app)
      .post("/api/squads/import")
      .set("x-slaw-cloud-async-import", "1")
      .set(cloudHeaders)
      .send({ target: { mode: "existing_squad", squadId } });

    expect(accepted.status).toBe(202);
    expect(accepted.body.job.status).toBe("running");
    expect(mockSquadPortabilityService.importBundle).not.toHaveBeenCalled();

    const failed = await waitForImportJobStatus(app, accepted.body.statusUrl, "failed");

    expect(failed.status).toBe(200);
    expect(failed.body.job.status).toBe("failed");
    expect(failed.body.job.error.message).toEqual(expect.any(String));
    expect(mockSquadPortabilityService.importBundle).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it.sequential("keeps global import apply synchronous when Cloud async opt-in is absent", async () => {
    mockSquadPortabilityService.importBundle.mockResolvedValueOnce(createImportResult("created"));
    const app = await createApp(cloudTenantActor());

    const res = await request(app)
      .post("/api/squads/import")
      .set(cloudHeaders)
      .send(importRequest);

    expect(res.status).toBe(200);
    expect(res.body.squad.id).toBe(squadId);
    expect(res.body.squad.action).toBe("created");
    expect(res.body.job).toBeUndefined();
    expect(mockSquadPortabilityService.importBundle).toHaveBeenCalledWith(importRequest, "cloud-user-1");
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "squad.imported",
      squadId,
    }));
  });
});
