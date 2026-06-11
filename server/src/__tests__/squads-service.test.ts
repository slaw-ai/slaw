import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { squads, createDb } from "@slaw-ai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { squadService } from "../services/squads.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres squad service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("squadService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-squad-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("retries generated issue prefixes when Drizzle wraps the unique constraint error", async () => {
    await db.insert(squads).values({
      name: "Aron Existing",
      issuePrefix: "ARO",
    });

    const created = await squadService(db).create({
      name: "Aron & Sharon",
    });

    expect(created.issuePrefix).toBe("AROA");

    const rows = await db.select({ issuePrefix: squads.issuePrefix }).from(squads);
    expect(rows.map((row) => row.issuePrefix).sort()).toEqual(["ARO", "AROA"]);
  });
});
