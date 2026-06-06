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
