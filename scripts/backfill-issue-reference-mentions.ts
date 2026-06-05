import { squads, createDb } from "../packages/db/src/index.js";
import { loadConfig } from "../server/src/config.js";
import { issueReferenceService } from "../server/src/services/issue-references.js";

function parseFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

async function main() {
  const config = loadConfig();
  const dbUrl =
    process.env.DATABASE_URL?.trim()
    || config.databaseUrl
    || `postgres://slaw:slaw@127.0.0.1:${config.embeddedPostgresPort}/slaw`;

  const db = createDb(dbUrl);
  const refs = issueReferenceService(db);
  const squadId = parseFlag("--squad");
  const squadRows = squadId
    ? [{ id: squadId }]
    : await db.select({ id: squads.id }).from(squads);

  if (squadRows.length === 0) {
    console.log("No squads found; nothing to backfill.");
    return;
  }

  console.log(`Backfilling issue reference mentions for ${squadRows.length} compan${squadRows.length === 1 ? "y" : "ies"}...`);
  for (const squad of squadRows) {
    console.log(`- ${squad.id}`);
    await refs.syncAllForSquad(squad.id);
  }
  console.log("Issue reference backfill complete.");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Issue reference backfill failed: ${message}`);
  process.exitCode = 1;
});
