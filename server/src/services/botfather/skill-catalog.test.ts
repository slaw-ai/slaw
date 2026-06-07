import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "@slaw/db";
import type { Directive, SkillCatalogResponse, SkillContentResponse } from "@slaw/shared/botfather/protocol";

/**
 * P4 — skill catalog sync (instance side). We mock the squad-skills service so
 * the test focuses on the catalog client + the version-gated refresh logic, not
 * on persistence. `botfather_sync_state` is faked in-memory.
 */

const upsertTowerSkill = vi.fn(async (squadId: string, content: SkillContentResponse) => ({
  id: "row",
  squadId,
  key: content.key,
}));
let installed: Array<{ squadId: string; key: string; towerSkillKey: string | null; towerSkillVersion: number | null }> = [];
const listTowerManagedSkills = vi.fn(async () => installed);

vi.mock("../squad-skills.js", () => ({
  squadSkillService: () => ({ upsertTowerSkill, listTowerManagedSkills }),
}));

const { appliedSkillCatalogVersion, syncSkillCatalog, handleSkillDirectives, installCatalogSkill } = await import(
  "./skill-catalog.js"
);

/** Fake db holding the skill_catalog version row in botfather_sync_state. */
function fakeDb(initialVersion = 0) {
  let version = initialVersion;
  return {
    version: () => version,
    execute: vi.fn(async (q: unknown) => {
      const text = JSON.stringify(q);
      if (text.includes("SELECT last_synced_id")) {
        return version > 0 ? { rows: [{ last_synced_id: String(version) }] } : { rows: [] };
      }
      if (text.includes("INSERT INTO botfather_sync_state")) {
        // emulate GREATEST(applied, pushed). drizzle's sql`` serializes bound
        // params as bare chunks in queryChunks (numbers as numbers, the String()
        // version as a quoted string). Pick the max numeric param.
        const chunks = (q as { queryChunks?: unknown[] }).queryChunks ?? [];
        const nums: number[] = [];
        for (const c of chunks) {
          if (typeof c === "number") nums.push(c);
          else if (typeof c === "string" && /^\d+$/.test(c)) nums.push(Number(c));
        }
        const pushed = nums.length ? Math.max(...nums) : version;
        version = Math.max(version, pushed);
        return { rows: [] };
      }
      return { rows: [] };
    }),
  } as unknown as Db & { version: () => number };
}

function catalog(version: number, entries: Array<{ key: string; version: number }>): SkillCatalogResponse {
  return {
    catalogVersion: version,
    skills: entries.map((e) => ({
      key: e.key,
      slug: e.key,
      name: e.key,
      description: null,
      category: null,
      trustLevel: "markdown_only",
      version: e.version,
      contentHash: `h${e.version}`,
      hasFiles: false,
      updatedAt: new Date().toISOString(),
    })),
  };
}
function content(key: string, version: number): SkillContentResponse {
  return {
    key,
    slug: key,
    name: key,
    description: null,
    category: null,
    trustLevel: "markdown_only",
    version,
    contentHash: `h${version}`,
    markdown: `# ${key} v${version}`,
    files: [],
  };
}

beforeEach(() => {
  upsertTowerSkill.mockClear();
  listTowerManagedSkills.mockClear();
  installed = [];
});

describe("appliedSkillCatalogVersion", () => {
  it("reads 0 when never applied and the stored value otherwise", async () => {
    expect(await appliedSkillCatalogVersion(fakeDb(0))).toBe(0);
    expect(await appliedSkillCatalogVersion(fakeDb(7))).toBe(7);
  });
});

describe("syncSkillCatalog — version-gated refresh of installed skills", () => {
  it("refreshes only installed skills whose version is behind the tower", async () => {
    installed = [
      { squadId: "s1", key: "lint", towerSkillKey: "lint", towerSkillVersion: 1 },
      { squadId: "s1", key: "e2e", towerSkillKey: "e2e", towerSkillVersion: 3 },
    ];
    const client = {
      skillCatalog: vi.fn(async () => catalog(9, [{ key: "lint", version: 2 }, { key: "e2e", version: 3 }])),
      skillContent: vi.fn(async (_k: string, key: string) => content(key, 2)),
    } as any;
    const db = fakeDb(0);
    const r = await syncSkillCatalog(db, client, "key");
    expect(r).toEqual({ catalogVersion: 9, refreshed: 1, checked: 2 });
    // lint (v1 → v2) refreshed; e2e (v3 == v3) not
    expect(upsertTowerSkill).toHaveBeenCalledTimes(1);
    expect(upsertTowerSkill).toHaveBeenCalledWith("s1", expect.objectContaining({ key: "lint", version: 2 }));
    expect(db.version()).toBe(9);
  });

  it("leaves a skill that vanished from the catalog (deprecated) installed, not refreshed", async () => {
    installed = [{ squadId: "s1", key: "old", towerSkillKey: "old", towerSkillVersion: 1 }];
    const client = {
      skillCatalog: vi.fn(async () => catalog(5, [])), // 'old' no longer published
      skillContent: vi.fn(),
    } as any;
    const r = await syncSkillCatalog(fakeDb(0), client, "key");
    expect(r.refreshed).toBe(0);
    expect(upsertTowerSkill).not.toHaveBeenCalled();
    expect(client.skillContent).not.toHaveBeenCalled();
  });
});

describe("handleSkillDirectives — hint version gate", () => {
  const hint = (catalogVersion: number): Directive[] => [{ kind: "skills_updated", catalogVersion }];

  it("pulls when the hint is ahead of the applied version", async () => {
    const client = {
      skillCatalog: vi.fn(async () => catalog(3, [])),
      skillContent: vi.fn(),
    } as any;
    const r = await handleSkillDirectives(fakeDb(1), client, "key", hint(3));
    expect(r).not.toBeNull();
    expect(client.skillCatalog).toHaveBeenCalledOnce();
  });

  it("does nothing when the hint is not ahead (de-dupe)", async () => {
    const client = { skillCatalog: vi.fn(), skillContent: vi.fn() } as any;
    expect(await handleSkillDirectives(fakeDb(5), client, "key", hint(5))).toBeNull();
    expect(client.skillCatalog).not.toHaveBeenCalled();
  });

  it("ignores directive sets without a skills_updated hint", async () => {
    const client = { skillCatalog: vi.fn(), skillContent: vi.fn() } as any;
    const other: Directive[] = [{ kind: "request_reconciliation" }];
    expect(await handleSkillDirectives(fakeDb(0), client, "key", other)).toBeNull();
    expect(client.skillCatalog).not.toHaveBeenCalled();
  });
});

describe("installCatalogSkill", () => {
  it("pulls content and upserts it as a tower-managed skill on the chosen squad", async () => {
    const client = { skillContent: vi.fn(async () => content("lint", 4)) } as any;
    await installCatalogSkill(fakeDb(0), client, "key", "squad-7", "lint");
    expect(client.skillContent).toHaveBeenCalledWith("key", "lint");
    expect(upsertTowerSkill).toHaveBeenCalledWith("squad-7", expect.objectContaining({ key: "lint", version: 4 }));
  });
});
