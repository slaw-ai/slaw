import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRegistry = vi.hoisted(() => ({
  getById: vi.fn(),
  getByKey: vi.fn(),
  upsertConfig: vi.fn(),
  getSquadSettings: vi.fn(),
  upsertSquadSettings: vi.fn(),
}));

const mockLifecycle = vi.hoisted(() => ({
  load: vi.fn(),
  upgrade: vi.fn(),
  unload: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => mockRegistry,
}));

vi.mock("../services/plugin-lifecycle.js", () => ({
  pluginLifecycleManager: () => mockLifecycle,
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../services/live-events.js", () => ({
  publishGlobalLiveEvent: vi.fn(),
}));

async function createApp(
  actor: Record<string, unknown>,
  loaderOverrides: Record<string, unknown> = {},
  routeOverrides: {
    db?: unknown;
    jobDeps?: unknown;
    toolDeps?: unknown;
    bridgeDeps?: unknown;
    captureJsonContext?: (context: unknown, body: unknown) => void;
  } = {},
) {
  const [{ pluginRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/plugins.js"),
    import("../middleware/index.js"),
  ]);

  const loader = {
    installPlugin: vi.fn(),
    ...loaderOverrides,
  };

  const app = express();
  app.use(express.json());
  if (routeOverrides.captureJsonContext) {
    app.use((_req, res, next) => {
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        routeOverrides.captureJsonContext?.((res as any).__errorContext, body);
        return originalJson(body);
      }) as typeof res.json;
      next();
    });
  }
  app.use((req, _res, next) => {
    req.actor = actor as typeof req.actor;
    next();
  });
  app.use("/api", pluginRoutes(
    (routeOverrides.db ?? {}) as never,
    loader as never,
    routeOverrides.jobDeps as never,
    undefined,
    routeOverrides.toolDeps as never,
    routeOverrides.bridgeDeps as never,
  ));
  app.use(errorHandler);

  return { app, loader };
}

function createSelectQueueDb(rows: Array<Array<Record<string, unknown>>>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(rows.shift() ?? [])),
        })),
      })),
    })),
  };
}

const squadA = "22222222-2222-4222-8222-222222222222";
const squadB = "33333333-3333-4333-8333-333333333333";
const agentA = "44444444-4444-4444-8444-444444444444";
const runA = "55555555-5555-4555-8555-555555555555";
const projectA = "66666666-6666-4666-8666-666666666666";
const pluginId = "11111111-1111-4111-8111-111111111111";

function operatorActor(overrides: Record<string, unknown> = {}) {
  return {
    type: "operator",
    userId: "user-1",
    source: "session",
    isInstanceAdmin: false,
    squadIds: [squadA],
    ...overrides,
  };
}

function agentActor(overrides: Record<string, unknown> = {}) {
  return {
    type: "agent",
    agentId: agentA,
    squadId: squadA,
    runId: runA,
    source: "agent_jwt",
    ...overrides,
  };
}

function readyPlugin() {
  mockRegistry.getById.mockResolvedValue({
    id: pluginId,
    pluginKey: "slaw.example",
    version: "1.0.0",
    status: "ready",
  });
}

describe.sequential("plugin install and upgrade authz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists bundled monorepo plugin packages", async () => {
    const { app } = await createApp(operatorActor());

    const res = await request(app).get("/api/plugins/examples");

    expect(res.status).toBe(200);
    const packageNames = res.body.map((plugin: { packageName: string }) => plugin.packageName);
    const byPackageName = new Map(
      res.body.map((plugin: { packageName: string; experimental: boolean }) => [plugin.packageName, plugin]),
    );
    expect(packageNames).toContain("@slaw/plugin-workspace-diff");
    expect(packageNames).toContain("@slaw/plugin-llm-wiki");
    expect(packageNames).toContain("@slaw/plugin-modal");
    expect(packageNames).toContain("@slaw/plugin-authoring-smoke-example");
    expect(packageNames).not.toContain("@slaw/plugin-sdk");
    expect(byPackageName.get("@slaw/plugin-workspace-diff")?.experimental).toBe(true);
    expect(byPackageName.get("@slaw/plugin-llm-wiki")?.experimental).toBe(true);
    expect(byPackageName.get("@slaw/plugin-modal")?.experimental).toBe(true);
    expect(byPackageName.get("@slaw/plugin-authoring-smoke-example")?.experimental).toBe(false);
  }, 20_000);

  it("rejects plugin installation for non-admin operator users", async () => {
    const { app, loader } = await createApp({
      type: "operator",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      squadIds: ["squad-1"],
    });

    const res = await request(app)
      .post("/api/plugins/install")
      .send({ packageName: "slaw-plugin-example" });

    expect(res.status).toBe(403);
    expect(loader.installPlugin).not.toHaveBeenCalled();
  }, 20_000);

  it("allows instance admins to install plugins", async () => {
    const pluginId = "11111111-1111-4111-8111-111111111111";
    const pluginKey = "slaw.example";
    const discovered = {
      manifest: {
        id: pluginKey,
      },
    };

    mockRegistry.getByKey.mockResolvedValue({
      id: pluginId,
      pluginKey,
      packageName: "slaw-plugin-example",
      version: "1.0.0",
    });
    mockRegistry.getById.mockResolvedValue({
      id: pluginId,
      pluginKey,
      packageName: "slaw-plugin-example",
      version: "1.0.0",
    });
    mockLifecycle.load.mockResolvedValue(undefined);

    const { app, loader } = await createApp(
      {
        type: "operator",
        userId: "admin-1",
        source: "session",
        isInstanceAdmin: true,
        squadIds: [],
      },
      { installPlugin: vi.fn().mockResolvedValue(discovered) },
    );

    const res = await request(app)
      .post("/api/plugins/install")
      .send({ packageName: "slaw-plugin-example" });

    expect(res.status).toBe(200);
    expect(loader.installPlugin).toHaveBeenCalledWith({
      packageName: "slaw-plugin-example",
      version: undefined,
    });
    expect(mockLifecycle.load).toHaveBeenCalledWith(pluginId);
  }, 20_000);

  it("rejects plugin upgrades for non-admin operator users", async () => {
    const pluginId = "11111111-1111-4111-8111-111111111111";
    const { app } = await createApp({
      type: "operator",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      squadIds: ["squad-1"],
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/upgrade`)
      .send({});

    expect(res.status).toBe(403);
    expect(mockRegistry.getById).not.toHaveBeenCalled();
    expect(mockLifecycle.upgrade).not.toHaveBeenCalled();
  }, 20_000);

  it.each([
    ["delete", "delete", "/api/plugins/11111111-1111-4111-8111-111111111111", undefined],
    ["enable", "post", "/api/plugins/11111111-1111-4111-8111-111111111111/enable", {}],
    ["disable", "post", "/api/plugins/11111111-1111-4111-8111-111111111111/disable", {}],
    ["config", "post", "/api/plugins/11111111-1111-4111-8111-111111111111/config", { configJson: {} }],
  ] as const)("rejects plugin %s for non-admin operator users", async (_name, method, path, body) => {
    const { app } = await createApp({
      type: "operator",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      squadIds: ["squad-1"],
    });

    const req = method === "delete" ? request(app).delete(path) : request(app).post(path).send(body);
    const res = await req;

    expect(res.status).toBe(403);
    expect(mockRegistry.getById).not.toHaveBeenCalled();
    expect(mockRegistry.upsertConfig).not.toHaveBeenCalled();
    expect(mockLifecycle.unload).not.toHaveBeenCalled();
    expect(mockLifecycle.enable).not.toHaveBeenCalled();
    expect(mockLifecycle.disable).not.toHaveBeenCalled();
  }, 20_000);

  it("resolves plugin keys without probing the UUID id column for core plugin actions", async () => {
    const pluginKey = "slawqa.hello-plugin";
    const plugin = {
      id: pluginId,
      pluginKey,
      version: "1.0.0",
      status: "ready",
    };
    mockRegistry.getById.mockImplementation(() => {
      throw new Error("getById should not be called for plugin keys");
    });
    mockRegistry.getByKey.mockResolvedValue(plugin);
    mockLifecycle.unload.mockResolvedValue(plugin);
    mockLifecycle.enable.mockResolvedValue(plugin);
    mockLifecycle.disable.mockResolvedValue(plugin);

    const { app } = await createApp({
      type: "operator",
      userId: "admin-1",
      source: "session",
      isInstanceAdmin: true,
      squadIds: [squadA],
    });

    const inspectRes = await request(app).get(`/api/plugins/${pluginKey}`);
    const disableRes = await request(app).post(`/api/plugins/${pluginKey}/disable`).send({});
    const enableRes = await request(app).post(`/api/plugins/${pluginKey}/enable`).send({});
    const uninstallRes = await request(app).delete(`/api/plugins/${pluginKey}?purge=true`);

    expect(inspectRes.status).toBe(200);
    expect(disableRes.status).toBe(200);
    expect(enableRes.status).toBe(200);
    expect(uninstallRes.status).toBe(200);
    expect(mockRegistry.getById).not.toHaveBeenCalled();
    expect(mockRegistry.getByKey).toHaveBeenCalledWith(pluginKey);
    expect(mockLifecycle.disable).toHaveBeenCalledWith(pluginId, undefined);
    expect(mockLifecycle.enable).toHaveBeenCalledWith(pluginId);
    expect(mockLifecycle.unload).toHaveBeenCalledWith(pluginId, true);
  }, 20_000);

  it("rejects plugin config saves that contain secret refs even for instance admins", async () => {
    readyPlugin();

    const { app } = await createApp({
      type: "operator",
      userId: "admin-1",
      source: "session",
      isInstanceAdmin: true,
      squadIds: [squadA],
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/config`)
      .send({
        configJson: {
          apiKeyRef: "77777777-7777-4777-8777-777777777777",
        },
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/secret references are disabled/i);
    expect(mockRegistry.upsertConfig).not.toHaveBeenCalled();
  }, 20_000);

  it("allows instance admins to upgrade plugins", async () => {
    const pluginId = "11111111-1111-4111-8111-111111111111";
    mockRegistry.getById.mockResolvedValue({
      id: pluginId,
      pluginKey: "slaw.example",
      version: "1.0.0",
    });
    mockLifecycle.upgrade.mockResolvedValue({
      id: pluginId,
      version: "1.1.0",
    });

    const { app } = await createApp({
      type: "operator",
      userId: "admin-1",
      source: "session",
      isInstanceAdmin: true,
      squadIds: [],
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/upgrade`)
      .send({ version: "1.1.0" });

    expect(res.status).toBe(200);
    expect(mockLifecycle.upgrade).toHaveBeenCalledWith(pluginId, "1.1.0");
  }, 20_000);
});

describe.sequential("scoped plugin API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches manifest-declared scoped routes after squad access checks", async () => {
    const pluginId = "11111111-1111-4111-8111-111111111111";
    const workerManager = {
      call: vi.fn().mockResolvedValue({
        status: 202,
        body: { ok: true },
      }),
    };
    mockRegistry.getById.mockResolvedValue(null);
    mockRegistry.getByKey.mockResolvedValue({
      id: pluginId,
      pluginKey: "slaw.example",
      version: "1.0.0",
      status: "ready",
      manifestJson: {
        id: "slaw.example",
        capabilities: ["api.routes.register"],
        apiRoutes: [
          {
            routeKey: "smoke",
            method: "GET",
            path: "/smoke",
            auth: "operator-or-agent",
            capability: "api.routes.register",
            squadResolution: { from: "query", key: "squadId" },
          },
        ],
      },
    });

    const { app } = await createApp(
      {
        type: "operator",
        userId: "admin-1",
        source: "session",
        isInstanceAdmin: false,
        squadIds: ["squad-1"],
      },
      {},
      { bridgeDeps: { workerManager } },
    );

    const res = await request(app)
      .get("/api/plugins/slaw.example/api/smoke")
      .query({ squadId: "squad-1" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(workerManager.call).toHaveBeenCalledWith(
      pluginId,
      "handleApiRequest",
      expect.objectContaining({
        routeKey: "smoke",
        method: "GET",
        squadId: "squad-1",
        query: { squadId: "squad-1" },
      }),
    );
  }, 20_000);
});

describe.sequential("plugin local folder routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry.getSquadSettings.mockResolvedValue(null);
  });

  function readyLocalFolderPlugin() {
    mockRegistry.getById.mockResolvedValue({
      id: pluginId,
      pluginKey: "slaw.example",
      version: "1.0.0",
      status: "ready",
      manifestJson: {
        id: "slaw.example",
        capabilities: ["local.folders"],
        localFolders: [
          {
            folderKey: "content-root",
            displayName: "Content root",
            access: "readWrite",
            requiredDirectories: ["docs"],
            requiredFiles: ["README.md"],
          },
        ],
      },
    });
  }

  it("rejects validation for undeclared local folder keys", async () => {
    readyLocalFolderPlugin();
    const { app } = await createApp(operatorActor());

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/squads/${squadA}/local-folders/ssh/validate`)
      .send({ path: "/tmp" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Local folder key is not declared");
    expect(mockRegistry.upsertSquadSettings).not.toHaveBeenCalled();
  });

  it("rejects saving undeclared local folder keys", async () => {
    readyLocalFolderPlugin();
    const { app } = await createApp(operatorActor());

    const res = await request(app)
      .put(`/api/plugins/${pluginId}/squads/${squadA}/local-folders/ssh`)
      .send({ path: "/tmp" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Local folder key is not declared");
    expect(mockRegistry.upsertSquadSettings).not.toHaveBeenCalled();
  });
});

describe.sequential("plugin tool and bridge authz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects tool execution when the operator user cannot access runContext.squadId", async () => {
    const executeTool = vi.fn();
    const getTool = vi.fn();
    const { app } = await createApp(operatorActor(), {}, {
      toolDeps: {
        toolDispatcher: {
          listToolsForAgent: vi.fn(),
          getTool,
          executeTool,
        },
      },
    });

    const res = await request(app)
      .post("/api/plugins/tools/execute")
      .send({
        tool: "slaw.example:search",
        parameters: {},
        runContext: {
          agentId: agentA,
          runId: runA,
          squadId: squadB,
          projectId: projectA,
        },
      });

    expect(res.status).toBe(403);
    expect(getTool).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("rejects tool execution when any runContext reference is outside the squad scope", async () => {
    const cases: Array<[string, Array<Array<Record<string, unknown>>>]> = [
      [
        "agentId",
        [
          [{ squadId: squadB }],
        ],
      ],
      [
        "runId squad",
        [
          [{ squadId: squadA }],
          [{ squadId: squadB, agentId: agentA }],
        ],
      ],
      [
        "runId agent",
        [
          [{ squadId: squadA }],
          [{ squadId: squadA, agentId: "77777777-7777-4777-8777-777777777777" }],
        ],
      ],
      [
        "projectId",
        [
          [{ squadId: squadA }],
          [{ squadId: squadA, agentId: agentA }],
          [{ squadId: squadB }],
        ],
      ],
    ];

    for (const [label, rows] of cases) {
      const executeTool = vi.fn();
      const { app } = await createApp(operatorActor(), {}, {
        db: createSelectQueueDb(rows),
        toolDeps: {
          toolDispatcher: {
            listToolsForAgent: vi.fn(),
            getTool: vi.fn(() => ({ name: "slaw.example:search" })),
            executeTool,
          },
        },
      });

      const res = await request(app)
        .post("/api/plugins/tools/execute")
        .send({
          tool: "slaw.example:search",
          parameters: {},
          runContext: {
            agentId: agentA,
            runId: runA,
            squadId: squadA,
            projectId: projectA,
          },
        });

      expect(res.status, label).toBe(403);
      expect(executeTool).not.toHaveBeenCalled();
    }
  });

  it("allows tool execution when agent, run, and project all belong to runContext.squadId", async () => {
    const executeTool = vi.fn().mockResolvedValue({ content: "ok" });
    const { app } = await createApp(operatorActor(), {}, {
      db: createSelectQueueDb([
        [{ squadId: squadA }],
        [{ squadId: squadA, agentId: agentA }],
        [{ squadId: squadA }],
      ]),
      toolDeps: {
        toolDispatcher: {
          listToolsForAgent: vi.fn(),
          getTool: vi.fn(() => ({ name: "slaw.example:search" })),
          executeTool,
        },
      },
    });

    const res = await request(app)
      .post("/api/plugins/tools/execute")
      .send({
        tool: "slaw.example:search",
        parameters: { q: "test" },
        runContext: {
          agentId: agentA,
          runId: runA,
          squadId: squadA,
          projectId: projectA,
        },
      });

    expect(res.status).toBe(200);
    expect(executeTool).toHaveBeenCalledWith(
      "slaw.example:search",
      { q: "test" },
      {
        agentId: agentA,
        runId: runA,
        squadId: squadA,
        projectId: projectA,
      },
    );
  });

  it.each([
    ["legacy data", "post", `/api/plugins/${pluginId}/bridge/data`, { key: "health" }],
    ["legacy action", "post", `/api/plugins/${pluginId}/bridge/action`, { key: "sync" }],
    ["url data", "post", `/api/plugins/${pluginId}/data/health`, {}],
    ["url action", "post", `/api/plugins/${pluginId}/actions/sync`, {}],
  ] as const)("rejects %s bridge calls without squadId for non-admin users", async (_name, _method, path, body) => {
    readyPlugin();
    const call = vi.fn();
    const { app } = await createApp(operatorActor(), {}, {
      bridgeDeps: {
        workerManager: { call },
      },
    });

    const res = await request(app)
      .post(path)
      .send(body);

    expect(res.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it("forwards authorized bridge squad scope to the plugin worker", async () => {
    readyPlugin();
    const call = vi.fn().mockResolvedValue({ ok: true });
    const { app } = await createApp(operatorActor(), {}, {
      bridgeDeps: {
        workerManager: { call },
      },
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/data/health`)
      .send({ squadId: squadA, params: { view: "compact" } });

    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledWith(pluginId, "getData", {
      key: "health",
      squadId: squadA,
      params: { view: "compact" },
      renderEnvironment: null,
    });
  });

  it("allows omitted-squad bridge calls for instance admins as global plugin actions", async () => {
    readyPlugin();
    const call = vi.fn().mockResolvedValue({ ok: true });
    const { app } = await createApp(operatorActor({
      userId: "admin-1",
      isInstanceAdmin: true,
      squadIds: [],
    }), {}, {
      bridgeDeps: {
        workerManager: { call },
      },
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/actions/sync`)
      .send({});

    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledWith(pluginId, "performAction", {
      key: "sync",
      params: {},
      actorContext: {
        type: "user",
        userId: "admin-1",
        agentId: null,
        runId: null,
        squadId: null,
      },
      renderEnvironment: null,
    });
  });

  it("passes authenticated actor context and overrides spoofed squad scope for plugin actions", async () => {
    readyPlugin();
    const call = vi.fn().mockResolvedValue({ ok: true });
    const { app } = await createApp(operatorActor({ runId: runA }), {}, {
      bridgeDeps: {
        workerManager: { call },
      },
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/actions/sync`)
      .send({
        squadId: squadA,
        params: {
          squadId: squadB,
          reviewerUserId: "spoofed-user",
        },
      });

    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledWith(pluginId, "performAction", {
      key: "sync",
      params: {
        squadId: squadA,
        reviewerUserId: "spoofed-user",
      },
      actorContext: {
        type: "user",
        userId: "user-1",
        agentId: null,
        runId: runA,
        squadId: squadA,
      },
      renderEnvironment: null,
    });
  });

  it("uses null for operator actor userId when no authenticated user id is present", async () => {
    readyPlugin();
    const call = vi.fn().mockResolvedValue({ ok: true });
    const { app } = await createApp(operatorActor({ userId: undefined }), {}, {
      bridgeDeps: {
        workerManager: { call },
      },
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/actions/sync`)
      .send({ squadId: squadA });

    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledWith(pluginId, "performAction", expect.objectContaining({
      actorContext: expect.objectContaining({
        type: "user",
        userId: null,
        squadId: squadA,
      }),
    }));
  });

  it("allows agent-scoped plugin actions with authenticated actor context", async () => {
    readyPlugin();
    const call = vi.fn().mockResolvedValue({ ok: true });
    const { app } = await createApp(agentActor(), {}, {
      bridgeDeps: {
        workerManager: { call },
      },
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/actions/sync`)
      .send({
        squadId: squadA,
        params: {
          squadId: squadB,
          reviewerAgentId: "spoofed-agent",
        },
      });

    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledWith(pluginId, "performAction", {
      key: "sync",
      params: {
        squadId: squadA,
        reviewerAgentId: "spoofed-agent",
      },
      actorContext: {
        type: "agent",
        userId: null,
        agentId: agentA,
        runId: runA,
        squadId: squadA,
      },
      renderEnvironment: null,
    });

    call.mockClear();
    const legacyRes = await request(app)
      .post(`/api/plugins/${pluginId}/bridge/action`)
      .send({
        key: "sync",
        squadId: squadA,
        params: {
          squadId: squadB,
          reviewerAgentId: "spoofed-agent",
        },
      });

    expect(legacyRes.status).toBe(200);
    expect(call).toHaveBeenCalledWith(pluginId, "performAction", {
      key: "sync",
      params: {
        squadId: squadA,
        reviewerAgentId: "spoofed-agent",
      },
      actorContext: {
        type: "agent",
        userId: null,
        agentId: agentA,
        runId: runA,
        squadId: squadA,
      },
      renderEnvironment: null,
    });
  });

  it("rejects agent plugin actions outside the authenticated squad scope", async () => {
    readyPlugin();
    const call = vi.fn().mockResolvedValue({ ok: true });
    const { app } = await createApp(agentActor(), {}, {
      bridgeDeps: {
        workerManager: { call },
      },
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/actions/sync`)
      .send({ squadId: squadB });

    expect(res.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it("attaches worker bridge errors to the HTTP logger context", async () => {
    readyPlugin();
    const call = vi.fn().mockRejectedValue(new Error("missing source_objects column"));
    const captured: Array<{ context: any; body: unknown }> = [];
    const { app } = await createApp(operatorActor(), {}, {
      bridgeDeps: {
        workerManager: { call },
      },
      captureJsonContext: (context, body) => {
        captured.push({ context, body });
      },
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/data/source-objects`)
      .send({ squadId: squadA });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      code: "UNKNOWN",
      message: "missing source_objects column",
    });
    expect(captured.at(-1)?.context?.error).toMatchObject({
      message: "missing source_objects column",
      details: {
        pluginId,
        pluginKey: "slaw.example",
        bridgeMethod: "getData",
        dataKey: "source-objects",
        bridgeCode: "UNKNOWN",
      },
    });
  });

  it("rejects manual job triggers for non-admin operator users", async () => {
    const scheduler = { triggerJob: vi.fn() };
    const jobStore = { getJobByIdForPlugin: vi.fn() };
    const { app } = await createApp(operatorActor(), {}, {
      jobDeps: { scheduler, jobStore },
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/jobs/job-1/trigger`)
      .send({});

    expect(res.status).toBe(403);
    expect(scheduler.triggerJob).not.toHaveBeenCalled();
    expect(jobStore.getJobByIdForPlugin).not.toHaveBeenCalled();
  }, 15_000);

  it("allows manual job triggers for instance admins", async () => {
    readyPlugin();
    const scheduler = { triggerJob: vi.fn().mockResolvedValue({ runId: "run-1", jobId: "job-1" }) };
    const jobStore = { getJobByIdForPlugin: vi.fn().mockResolvedValue({ id: "job-1" }) };
    const { app } = await createApp(operatorActor({
      userId: "admin-1",
      isInstanceAdmin: true,
      squadIds: [],
    }), {}, {
      jobDeps: { scheduler, jobStore },
    });

    const res = await request(app)
      .post(`/api/plugins/${pluginId}/jobs/job-1/trigger`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runId: "run-1", jobId: "job-1" });
    expect(scheduler.triggerJob).toHaveBeenCalledWith("job-1", "manual");
  });
});
