import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockSquadSkillService = vi.hoisted(() => ({
  importFromSource: vi.fn(),
  installFromCatalog: vi.fn(),
  deleteSkill: vi.fn(),
}));

const mockCatalogService = vi.hoisted(() => ({
  listCatalogSkills: vi.fn(),
  getCatalogSkillOrThrow: vi.fn(),
  readCatalogSkillFile: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("../routes/authz.js", async () => vi.importActual("../routes/authz.js"));



  vi.doMock("../services/access.js", () => ({
    accessService: () => mockAccessService,
  }));

  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
  }));

  vi.doMock("../services/agents.js", () => ({
    agentService: () => mockAgentService,
  }));

  vi.doMock("../services/squad-skills.js", () => ({
    squadSkillService: () => mockSquadSkillService,
  }));

  vi.doMock("../services/skills-catalog.js", () => mockCatalogService);

  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    squadSkillService: () => mockSquadSkillService,
    logActivity: mockLogActivity,
  }));
}

async function createApp(actor: Record<string, unknown>) {
  const [{ squadSkillRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/squad-skills.js")>("../routes/squad-skills.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", squadSkillRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("squad skill mutation permissions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/access.js");
    vi.doUnmock("../services/activity-log.js");
    vi.doUnmock("../services/agents.js");
    vi.doUnmock("../services/squad-skills.js");
    vi.doUnmock("../services/skills-catalog.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/squad-skills.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockSquadSkillService.importFromSource.mockResolvedValue({
      imported: [],
      warnings: [],
    });
    mockSquadSkillService.installFromCatalog.mockResolvedValue({
      action: "created",
      skill: {
        id: "skill-1",
        squadId: "squad-1",
        key: "slaw/bundled/software-development/review",
        slug: "review",
        name: "review",
        description: "Review code",
        markdown: "# Review",
        sourceType: "catalog",
        sourceLocator: "/tmp/review",
        sourceRef: "sha256:abc",
        trustLevel: "markdown_only",
        compatibility: "compatible",
        fileInventory: [{ path: "SKILL.md", kind: "skill" }],
        metadata: {
          sourceKind: "catalog",
          catalogId: "slaw:bundled:software-development:review",
          originHash: "sha256:abc",
        },
        createdAt: new Date("2026-05-26T00:00:00.000Z"),
        updatedAt: new Date("2026-05-26T00:00:00.000Z"),
      },
      catalogSkill: {
        id: "slaw:bundled:software-development:review",
        key: "slaw/bundled/software-development/review",
        kind: "bundled",
        category: "software-development",
        slug: "review",
        name: "review",
        description: "Review code",
        path: "catalog/bundled/software-development/review",
        entrypoint: "SKILL.md",
        trustLevel: "markdown_only",
        compatibility: "compatible",
        defaultInstall: false,
        recommendedForRoles: ["engineer"],
        requires: [],
        tags: ["review"],
        files: [{ path: "SKILL.md", kind: "skill", sizeBytes: 8, sha256: "abc" }],
        contentHash: "sha256:abc",
      },
      warnings: [],
    });
    mockSquadSkillService.deleteSkill.mockResolvedValue({
      id: "skill-1",
      slug: "find-skills",
      name: "Find Skills",
    });
    mockCatalogService.listCatalogSkills.mockReturnValue([]);
    mockCatalogService.getCatalogSkillOrThrow.mockReturnValue({
      id: "slaw:bundled:software-development:review",
      key: "slaw/bundled/software-development/review",
      kind: "bundled",
      category: "software-development",
      slug: "review",
      name: "review",
      description: "Review code",
      path: "catalog/bundled/software-development/review",
      entrypoint: "SKILL.md",
      trustLevel: "markdown_only",
      compatibility: "compatible",
      defaultInstall: false,
      recommendedForRoles: ["engineer"],
      requires: [],
      tags: ["review"],
      files: [{ path: "SKILL.md", kind: "skill", sizeBytes: 8, sha256: "abc" }],
      contentHash: "sha256:abc",
    });
    mockCatalogService.readCatalogSkillFile.mockResolvedValue({
      catalogSkillId: "slaw:bundled:software-development:review",
      path: "SKILL.md",
      kind: "skill",
      content: "# Review",
      language: "markdown",
      markdown: true,
    });
    mockLogActivity.mockResolvedValue(undefined);
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.hasPermission.mockResolvedValue(false);
  });

  it("allows local operator operators to mutate squad skills", async () => {
    const res = await request(await createApp({
      type: "operator",
      userId: "local-operator",
      squadIds: ["squad-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    }))
      .post("/api/squads/squad-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body).toEqual({
      imported: [],
      warnings: [],
    });
  });

  it("serves catalog listing without mutating squad skills", async () => {
    mockCatalogService.listCatalogSkills.mockReturnValue([
      {
        id: "slaw:bundled:software-development:review",
        key: "slaw/bundled/software-development/review",
        kind: "bundled",
        category: "software-development",
        slug: "review",
        name: "review",
        description: "Review code",
        path: "catalog/bundled/software-development/review",
        entrypoint: "SKILL.md",
        trustLevel: "markdown_only",
        compatibility: "compatible",
        defaultInstall: false,
        recommendedForRoles: ["engineer"],
        requires: [],
        tags: ["review"],
        files: [{ path: "SKILL.md", kind: "skill", sizeBytes: 8, sha256: "abc" }],
        contentHash: "sha256:abc",
      },
    ]);

    const res = await request(await createApp({
      type: "operator",
      userId: "local-operator",
      squadIds: ["squad-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    }))
      .get("/api/skills/catalog?kind=bundled&q=review");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCatalogService.listCatalogSkills).toHaveBeenCalledWith({ kind: "bundled", q: "review" });
    expect(mockSquadSkillService.importFromSource).not.toHaveBeenCalled();
    expect(mockSquadSkillService.installFromCatalog).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("requires authentication for catalog read routes", async () => {
    const app = await createApp({ type: "none" });

    const list = await request(app).get("/api/skills/catalog");
    const detail = await request(app).get("/api/skills/catalog/review");
    const file = await request(app).get("/api/skills/catalog/review/files?path=SKILL.md");

    expect(list.status, JSON.stringify(list.body)).toBe(401);
    expect(detail.status, JSON.stringify(detail.body)).toBe(401);
    expect(file.status, JSON.stringify(file.body)).toBe(401);
    expect(mockCatalogService.listCatalogSkills).not.toHaveBeenCalled();
    expect(mockCatalogService.getCatalogSkillOrThrow).not.toHaveBeenCalled();
    expect(mockCatalogService.readCatalogSkillFile).not.toHaveBeenCalled();
  });

  it("serves catalog detail and files by catalog reference", async () => {
    const app = await createApp({
      type: "operator",
      userId: "local-operator",
      squadIds: ["squad-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    });

    const detail = await request(app)
      .get("/api/skills/catalog/review");
    const file = await request(app)
      .get("/api/skills/catalog/review/files?path=SKILL.md");

    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(file.status, JSON.stringify(file.body)).toBe(200);
    expect(mockCatalogService.getCatalogSkillOrThrow).toHaveBeenCalledWith("review");
    expect(mockCatalogService.readCatalogSkillFile).toHaveBeenCalledWith("review", "SKILL.md");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("installs catalog skills with mutation permissions and logs provenance", async () => {
    const res = await request(await createApp({
      type: "operator",
      userId: "local-operator",
      squadIds: ["squad-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    }))
      .post("/api/squads/squad-1/skills/install-catalog")
      .send({
        catalogSkillId: "slaw:bundled:software-development:review",
        slug: "review",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockSquadSkillService.installFromCatalog).toHaveBeenCalledWith("squad-1", {
      catalogSkillId: "slaw:bundled:software-development:review",
      slug: "review",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      squadId: "squad-1",
      action: "squad.skill_catalog_installed",
      entityType: "squad_skill",
      entityId: "skill-1",
      details: expect.objectContaining({
        catalogId: "slaw:bundled:software-development:review",
        catalogKey: "slaw/bundled/software-development/review",
        originHash: "sha256:abc",
      }),
    }));
  });

  it("blocks same-squad agents without management permission from mutating squad skills", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      squadId: "squad-1",
      permissions: {},
    });

    const res = await request(await createApp({
      type: "agent",
      agentId: "agent-1",
      squadId: "squad-1",
      runId: "run-1",
    }))
      .post("/api/squads/squad-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(mockSquadSkillService.importFromSource).not.toHaveBeenCalled();
  });

  it("blocks agent catalog installs for other squads", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      squadId: "squad-1",
      permissions: { canCreateAgents: true },
    });

    const res = await request(await createApp({
      type: "agent",
      agentId: "agent-1",
      squadId: "squad-1",
      runId: "run-1",
    }))
      .post("/api/squads/squad-2/skills/install-catalog")
      .send({ catalogSkillId: "slaw:bundled:software-development:review" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(mockSquadSkillService.installFromCatalog).not.toHaveBeenCalled();
  });

  it("allows agents with canCreateAgents to mutate squad skills", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      squadId: "squad-1",
      permissions: { canCreateAgents: true },
    });

    const res = await request(await createApp({
      type: "agent",
      agentId: "agent-1",
      squadId: "squad-1",
      runId: "run-1",
    }))
      .post("/api/squads/squad-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockSquadSkillService.importFromSource).toHaveBeenCalledWith(
      "squad-1",
      "https://github.com/vercel-labs/agent-browser",
    );
  });

  it("returns a blocking error when attempting to delete a skill still used by agents", async () => {
    const { unprocessable } = await import("../errors.js");
    mockSquadSkillService.deleteSkill.mockImplementationOnce(async () => {
      throw unprocessable(
        'Cannot delete skill "Find Skills" while it is still used by Builder, Reviewer. Detach it from those agents first.',
      );
    });

    const res = await request(await createApp({
      type: "operator",
      userId: "local-operator",
      squadIds: ["squad-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    }))
      .delete("/api/squads/squad-1/skills/skill-1");

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toEqual({
      error: 'Cannot delete skill "Find Skills" while it is still used by Builder, Reviewer. Detach it from those agents first.',
    });
    expect(mockSquadSkillService.deleteSkill).toHaveBeenCalledWith("squad-1", "skill-1");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});
