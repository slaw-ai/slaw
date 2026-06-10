import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { squadRoutes } from "../routes/squads.js";

vi.mock("../services/index.js", () => ({
  squadService: () => ({
    list: vi.fn(),
    stats: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
  }),
  squadPortabilityService: () => ({
    exportBundle: vi.fn(),
    previewExport: vi.fn(),
    previewImport: vi.fn(),
    importBundle: vi.fn(),
  }),
  accessService: () => ({
    canUser: vi.fn(),
    ensureMembership: vi.fn(),
  }),
  budgetService: () => ({
    upsertPolicy: vi.fn(),
  }),
  agentService: () => ({
    getById: vi.fn(),
  }),
  logActivity: vi.fn(),
}));

describe("squad routes malformed issue path guard", () => {
  it("returns a clear error when squadId is missing for issues list path", async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "agent",
        agentId: "agent-1",
        squadId: "squad-1",
        source: "agent_key",
      };
      next();
    });
    app.use("/api/squads", squadRoutes({} as any));

    const res = await request(app).get("/api/squads/issues");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Missing squadId in path. Use /api/squads/{squadId}/issues.",
    });
  });
});
