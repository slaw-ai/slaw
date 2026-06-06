import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BotfatherService } from "./service.js";
import * as creds from "./credentials.js";

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };
const baseConfig = {
  url: undefined,
  enforcement: "enforce" as const,
  locked: false,
  syncIntervalSec: 60,
  heartbeatIntervalSec: 60,
  reportIssueTitles: true,
  spool: { maxMb: 50, maxDays: 14 },
};

// keep credentials side-effect-free in the test environment
beforeEach(() => {
  vi.spyOn(creds, "readBotfatherCredentials").mockReturnValue(null);
  vi.spyOn(creds, "writeBotfatherCredentials").mockImplementation(() => {});
  vi.spyOn(creds, "clearBotfatherCredentials").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("BotfatherService connect/disconnect (running instance)", () => {
  it("starts standalone when no url is configured", () => {
    const svc = new BotfatherService({} as never, baseConfig, noopLogger);
    expect(svc.enabled).toBe(false);
    expect(svc.status().state).toBe("standalone");
    expect(svc.isGated()).toBe(false);
  });

  it("connect() attaches a running instance, persists config, and enables reporting", () => {
    const persisted: Array<{ url?: string; enforcement: string }> = [];
    const svc = new BotfatherService({} as never, baseConfig, noopLogger, (patch) =>
      persisted.push({ url: patch.url, enforcement: patch.enforcement }),
    );

    const status = svc.connect("https://botfather.corp", "enforce");
    expect(svc.enabled).toBe(true);
    expect(status.url).toBe("https://botfather.corp");
    expect(status.enforcement).toBe("enforce");
    // config persisted so the connection survives restart
    expect(persisted.at(-1)).toEqual({ url: "https://botfather.corp", enforcement: "enforce" });
    svc.stop();
  });

  it("disconnect() detaches and returns to standalone", () => {
    const persisted: Array<{ url?: string }> = [];
    const svc = new BotfatherService({} as never, baseConfig, noopLogger, (patch) =>
      persisted.push({ url: patch.url }),
    );
    svc.connect("https://botfather.corp", "advisory");
    const status = svc.disconnect();
    expect(svc.enabled).toBe(false);
    expect(status.state).toBe("standalone");
    expect(status.url).toBeNull();
    // last persisted patch cleared the url
    expect(persisted.at(-1)?.url).toBeUndefined();
  });

  it("advisory enforcement never gates the UI", () => {
    const svc = new BotfatherService({} as never, baseConfig, noopLogger);
    svc.connect("https://botfather.corp", "advisory");
    expect(svc.isGated()).toBe(false);
    svc.stop();
  });
});

describe("BotfatherService.forceSync", () => {
  it("rejects when standalone (no tower configured)", async () => {
    const svc = new BotfatherService({} as never, baseConfig, noopLogger);
    await expect(svc.forceSync()).rejects.toThrow("no_control_tower_configured");
  });

  it("rejects when connected but not yet enrolled (no api key)", async () => {
    const svc = new BotfatherService({} as never, baseConfig, noopLogger);
    svc.connect("https://botfather.corp", "advisory");
    // enrollment has no apiKey until an admin approves
    await expect(svc.forceSync()).rejects.toThrow("not_enrolled");
    svc.stop();
  });

  it("drains the delta cursor then reconciles, aggregating counts", async () => {
    const svc = new BotfatherService({} as never, baseConfig, noopLogger);
    svc.connect("https://botfather.corp", "advisory");
    svc.stop(); // we drive the reporter manually, no background loops

    // pretend an admin approved us: apiKey is a getter backed by credentials
    vi.spyOn(creds, "readBotfatherCredentials").mockReturnValue({
      apiKey: "key-123",
      enrollmentId: "enr-1",
    } as never);

    // sync() returns deltas twice, then drains (0/0)
    const sync = vi
      .fn()
      .mockResolvedValueOnce({ upserts: 5, facts: 3 })
      .mockResolvedValueOnce({ upserts: 2, facts: 0 })
      .mockResolvedValue({ upserts: 0, facts: 0 });
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const reconcileRecentCosts = vi.fn().mockResolvedValue(4);
    const reconcileEntities = vi.fn().mockResolvedValue(9);
    (svc as unknown as { reporter: unknown }).reporter = {
      sync,
      heartbeat,
      reconcileRecentCosts,
      reconcileEntities,
    };

    const r = await svc.forceSync();
    expect(r).toEqual({ upserts: 7, facts: 3, healed: 4, entities: 9, iterations: 2 });
    expect(sync).toHaveBeenCalledTimes(3); // two with deltas + one empty pass to confirm drained
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(reconcileRecentCosts).toHaveBeenCalledTimes(1);
    expect(reconcileEntities).toHaveBeenCalledTimes(1);
  });

  it("surfaces a skipped sync (e.g. revoked) as an error", async () => {
    const svc = new BotfatherService({} as never, baseConfig, noopLogger);
    svc.connect("https://botfather.corp", "advisory");
    svc.stop();
    vi.spyOn(creds, "readBotfatherCredentials").mockReturnValue({
      apiKey: "key-123",
      enrollmentId: "enr-1",
    } as never);
    (svc as unknown as { reporter: unknown }).reporter = {
      sync: vi.fn().mockResolvedValue({ upserts: 0, facts: 0, skipped: "revoked" }),
      heartbeat: vi.fn(),
      reconcileRecentCosts: vi.fn(),
      reconcileEntities: vi.fn(),
    };
    await expect(svc.forceSync()).rejects.toThrow("revoked");
    svc.stop();
  });
});
