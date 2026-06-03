import { describe, expect, it } from "vitest";
import { slawConfigSchema } from "./config-schema.js";

describe("slaw config schema", () => {
  it("defaults omitted runtime paths to legacy instance-root locations", () => {
    const parsed = slawConfigSchema.parse({
      $meta: {
        version: 1,
        updatedAt: "2026-05-10T00:00:00.000Z",
        source: "configure",
      },
      database: {
        mode: "embedded-postgres",
      },
      logging: {
        mode: "file",
      },
      server: {},
    });

    expect(parsed.database.embeddedPostgresDataDir).toBe("~/.slaw/instances/default/db");
    expect(parsed.database.backup.dir).toBe("~/.slaw/instances/default/data/backups");
    expect(parsed.logging.logDir).toBe("~/.slaw/instances/default/logs");
    expect(parsed.storage.localDisk.baseDir).toBe("~/.slaw/instances/default/data/storage");
    expect(parsed.secrets.localEncrypted.keyFilePath).toBe("~/.slaw/instances/default/secrets/master.key");
  });
});
