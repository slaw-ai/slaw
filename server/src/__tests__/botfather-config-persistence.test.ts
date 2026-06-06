import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readConfigFile,
  readBotfatherConfigSection,
  writeBotfatherConfigSection,
} from "../config-file.js";

/**
 * Regression: a SLAW instance lost its Control Tower connection on every server
 * restart. Cause — "Connect" wrote a config file with only a {botfather,$meta}
 * section; on a zero-config (`pnpm dev`) setup that file was missing the
 * required database/logging/server sections, so the strict full-file read threw
 * and silently returned null, dropping the tower url on the next boot.
 */
describe("botfather config persistence across restart", () => {
  let dir: string;
  let configPath: string;
  const prevEnv = process.env.SLAW_CONFIG;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "slaw-cfg-"));
    configPath = path.join(dir, "config.json");
    process.env.SLAW_CONFIG = configPath;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.SLAW_CONFIG;
    else process.env.SLAW_CONFIG = prevEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a partial file with only {botfather} still yields the tower url (salvage path)", () => {
    // Simulate the OLD writer behaviour: a file with just botfather + $meta and
    // none of the required sections.
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        $meta: { version: 1, updatedAt: new Date().toISOString(), source: "configure" },
        botfather: { url: "https://botfather.corp", enforcement: "enforce" },
      }),
    );

    // Full strict read fails (missing required sections) → null, as before.
    expect(readConfigFile()).toBeNull();
    // But the resilient salvage path still recovers the connection.
    const section = readBotfatherConfigSection();
    expect(section?.url).toBe("https://botfather.corp");
    expect(section?.enforcement).toBe("enforce");
  });

  it("connect on a zero-config setup persists the url recoverably (salvage path)", () => {
    // Start from nothing (zero-config dev) and connect. The written file only
    // has a botfather section + $meta — it is intentionally NOT a full config,
    // so the strict reader still rejects it…
    writeBotfatherConfigSection({
      url: "https://botfather.corp",
      enforcement: "enforce",
      locked: false,
      syncIntervalSec: 60,
      heartbeatIntervalSec: 60,
      reportIssueTitles: true,
      spool: { maxMb: 50, maxDays: 14 },
    });

    // …but the loader recovers the connection via the salvage path, which is
    // what survives the restart (this is the actual fix).
    expect(readBotfatherConfigSection()?.url).toBe("https://botfather.corp");
    expect(readBotfatherConfigSection()?.enforcement).toBe("enforce");
  });

  it("does not clobber a full valid config when connecting", () => {
    // A complete config file (as written by onboarding) plus a botfather connect
    // must remain fully readable afterwards.
    const fullConfig = {
      $meta: { version: 1, updatedAt: new Date().toISOString(), source: "onboard" },
      database: { mode: "embedded-postgres" },
      logging: { mode: "file" },
      server: { deploymentMode: "local_trusted", exposure: "private", host: "127.0.0.1" },
      telemetry: { enabled: true },
    };
    fs.writeFileSync(configPath, JSON.stringify(fullConfig));
    expect(readConfigFile()).not.toBeNull(); // sanity: valid to begin with

    writeBotfatherConfigSection({
      url: "https://botfather.corp",
      enforcement: "enforce",
      locked: false,
      syncIntervalSec: 60,
      heartbeatIntervalSec: 60,
      reportIssueTitles: true,
      spool: { maxMb: 50, maxDays: 14 },
    });

    const after = readConfigFile();
    expect(after).not.toBeNull();
    expect(after?.botfather?.url).toBe("https://botfather.corp");
    // other sections preserved
    expect(after?.database.mode).toBe("embedded-postgres");
    expect(after?.logging.mode).toBe("file");
  });

  it("round-trips the url across a simulated restart", () => {
    writeBotfatherConfigSection({
      url: "https://tower.internal",
      enforcement: "advisory",
      locked: false,
      syncIntervalSec: 60,
      heartbeatIntervalSec: 60,
      reportIssueTitles: true,
      spool: { maxMb: 50, maxDays: 14 },
    });

    // "Restart": a fresh read of the same file.
    const afterRestart = readConfigFile()?.botfather ?? readBotfatherConfigSection();
    expect(afterRestart?.url).toBe("https://tower.internal");
    expect(afterRestart?.enforcement).toBe("advisory");
  });
});
