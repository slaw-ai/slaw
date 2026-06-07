import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { operatorMutationGuard } from "../middleware/operator-mutation-guard.js";

function createApp(
  actorType: "operator" | "agent",
  operatorSource: "session" | "local_implicit" | "operator_key" | "cloud_tenant" = "session",
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actorType === "operator"
      ? { type: "operator", userId: "operator", source: operatorSource }
      : { type: "agent", agentId: "agent-1" };
    next();
  });
  app.use(operatorMutationGuard());
  app.post("/mutate", (_req, res) => {
    res.status(204).end();
  });
  app.get("/read", (_req, res) => {
    res.status(204).end();
  });
  return app;
}

describe("operatorMutationGuard", () => {
  it("allows safe methods for operator actor", async () => {
    const app = createApp("operator");
    const res = await request(app).get("/read");
    expect([200, 204]).toContain(res.status);
  });

  it("blocks operator mutations without trusted origin", () => {
    const middleware = operatorMutationGuard();
    const req = {
      method: "POST",
      actor: { type: "operator", userId: "operator", source: "session" },
      header: () => undefined,
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Operator mutation requires trusted browser origin",
    });
  });

  it("allows local implicit operator mutations without origin", async () => {
    const app = createApp("operator", "local_implicit");
    const res = await request(app).post("/mutate").send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  it("allows operator bearer-key mutations without origin", async () => {
    const app = createApp("operator", "operator_key");
    const res = await request(app).post("/mutate").send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  it("allows trusted Cloud tenant mutations without origin", async () => {
    const app = createApp("operator", "cloud_tenant");
    const res = await request(app).post("/mutate").send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  it("allows operator mutations from trusted origin", async () => {
    const app = createApp("operator");
    const res = await request(app)
      .post("/mutate")
      .set("Origin", "http://localhost:3100")
      .send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  it("allows operator mutations from trusted referer origin", async () => {
    const app = createApp("operator");
    const res = await request(app)
      .post("/mutate")
      .set("Referer", "http://localhost:3100/issues/abc")
      .send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  it("allows operator mutations when x-forwarded-host matches origin", async () => {
    const app = createApp("operator");
    const res = await request(app)
      .post("/mutate")
      .set("Host", "127.0.0.1")
      .set("X-Forwarded-Host", "10.90.10.20:3443")
      .set("Origin", "https://10.90.10.20:3443")
      .send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  it("blocks operator mutations when x-forwarded-host does not match origin", async () => {
    const middleware = operatorMutationGuard();
    const req = {
      method: "POST",
      actor: { type: "operator", userId: "operator", source: "session" },
      header: (name: string) => {
        if (name === "host") return "127.0.0.1";
        if (name === "x-forwarded-host") return "10.90.10.20:3443";
        if (name === "origin") return "https://evil.example.com";
        return undefined;
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Operator mutation requires trusted browser origin",
    });
  });

  it("does not block authenticated agent mutations", async () => {
    const middleware = operatorMutationGuard();
    const req = {
      method: "POST",
      actor: { type: "agent", agentId: "agent-1" },
      header: () => undefined,
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
