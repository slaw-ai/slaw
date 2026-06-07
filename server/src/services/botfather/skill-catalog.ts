import { sql } from "drizzle-orm";
import type { Db } from "@slaw/db";
import type { Directive } from "@slaw/shared/botfather/protocol";
import type { BotfatherClient } from "./client.js";
import { squadSkillService } from "../squad-skills.js";

/**
 * Skill catalog sync — the instance side of the tower-mastered skill registry.
 *
 * The tower pushes only a lightweight `skills_updated` HINT (a catalogVersion)
 * on a heartbeat/sync response. When the instance sees a hint whose version is
 * ahead of what it last applied, it PULLS the catalog and refreshes every
 * locally-installed tower-managed skill whose installed version is behind the
 * tower's. No new skills are auto-installed — only already-chosen ones refresh.
 *
 * The applied catalog version is stored in the existing botfather_sync_state
 * table under a synthetic entity type, so no new table is needed.
 */

const CATALOG_ENTITY = "skill_catalog";

/** Read the catalog version the instance has last applied (0 if never). */
export async function appliedSkillCatalogVersion(db: Db): Promise<number> {
  if (typeof (db as { execute?: unknown }).execute !== "function") return 0;
  let res: unknown;
  try {
    res = await db.execute(sql`
      SELECT last_synced_id FROM botfather_sync_state
      WHERE entity_type = ${CATALOG_ENTITY} LIMIT 1
    `);
  } catch {
    return 0;
  }
  const rows = (res as { rows?: Record<string, unknown>[] }).rows ?? (res as Record<string, unknown>[]);
  const r = Array.isArray(rows) ? rows[0] : undefined;
  const v = r?.last_synced_id;
  const n = v == null ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Persist the applied catalog version (monotonic — never moves backwards). */
async function recordAppliedCatalogVersion(db: Db, version: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO botfather_sync_state (entity_type, last_synced_at, last_synced_id, sent_count, updated_at)
    VALUES (${CATALOG_ENTITY}, now(), ${String(version)}, 0, now())
    ON CONFLICT (entity_type) DO UPDATE SET
      last_synced_id = GREATEST(
        COALESCE(NULLIF(botfather_sync_state.last_synced_id, '')::int, 0),
        ${version}
      )::text,
      last_synced_at = now(),
      updated_at = now()
  `);
}

export interface CatalogSyncResult {
  catalogVersion: number;
  refreshed: number;
  checked: number;
}

/**
 * Pull the catalog and refresh installed tower-managed skills that are behind.
 * Idempotent and safe to call any time (on connect, on a hint, on demand).
 */
export async function syncSkillCatalog(db: Db, client: BotfatherClient, apiKey: string): Promise<CatalogSyncResult> {
  const catalog = await client.skillCatalog(apiKey);
  const byKey = new Map(catalog.skills.map((s) => [s.key, s]));
  const skills = squadSkillService(db);

  const installed = await skills.listTowerManagedSkills();
  let refreshed = 0;
  for (const row of installed) {
    const key = row.towerSkillKey ?? row.key;
    const entry = byKey.get(key);
    if (!entry) continue; // deprecated/removed in the tower — leave installed copy, flag in UI
    const installedVersion = row.towerSkillVersion ?? 0;
    if (entry.version <= installedVersion) continue; // already current
    // pull full content and refresh the local copy in place
    const content = await client.skillContent(apiKey, key);
    await skills.upsertTowerSkill(row.squadId, content);
    refreshed += 1;
  }

  await recordAppliedCatalogVersion(db, catalog.catalogVersion);
  return { catalogVersion: catalog.catalogVersion, refreshed, checked: installed.length };
}

/**
 * Install one catalog skill onto a chosen squad (user-initiated). Pulls full
 * content and persists it as a botfather-sourced, tower-managed skill.
 */
export async function installCatalogSkill(
  db: Db,
  client: BotfatherClient,
  apiKey: string,
  squadId: string,
  key: string,
) {
  const content = await client.skillContent(apiKey, key);
  return squadSkillService(db).upsertTowerSkill(squadId, content);
}

/**
 * Handle a `skills_updated` hint from a heartbeat/sync response. Pulls + refreshes
 * only when the hinted catalog version is ahead of what we've applied. Returns
 * the sync result, or null when nothing was due. Never throws into the caller's
 * heartbeat path beyond what the network call would.
 */
export async function handleSkillDirectives(
  db: Db,
  client: BotfatherClient,
  apiKey: string,
  directives: Directive[] | undefined,
): Promise<CatalogSyncResult | null> {
  if (!directives?.length) return null;
  const hint = directives.find((d) => d.kind === "skills_updated");
  if (!hint || hint.kind !== "skills_updated") return null;
  const applied = await appliedSkillCatalogVersion(db);
  if (hint.catalogVersion <= applied) return null;
  return syncSkillCatalog(db, client, apiKey);
}
