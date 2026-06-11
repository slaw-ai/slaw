import { and, eq } from "drizzle-orm";
import type { Db } from "@slaw-ai/db";
import {
  squadUserSidebarPreferences,
  userSidebarPreferences,
} from "@slaw-ai/db";
import type { SidebarOrderPreference } from "@slaw-ai/shared";

function normalizeOrderedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    orderedIds.push(trimmed);
  }
  return orderedIds;
}

function toPreference(orderedIds: unknown, updatedAt: Date | null): SidebarOrderPreference {
  return {
    orderedIds: normalizeOrderedIds(orderedIds),
    updatedAt,
  };
}

export function sidebarPreferenceService(db: Db) {
  return {
    async getSquadOrder(userId: string): Promise<SidebarOrderPreference> {
      const row = await db.query.userSidebarPreferences.findFirst({
        where: eq(userSidebarPreferences.userId, userId),
      });
      return toPreference(row?.squadOrder ?? [], row?.updatedAt ?? null);
    },

    async upsertSquadOrder(userId: string, orderedIds: string[]): Promise<SidebarOrderPreference> {
      const now = new Date();
      const normalized = normalizeOrderedIds(orderedIds);
      const [row] = await db
        .insert(userSidebarPreferences)
        .values({
          userId,
          squadOrder: normalized,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userSidebarPreferences.userId],
          set: {
            squadOrder: normalized,
            updatedAt: now,
          },
        })
        .returning();
      return toPreference(row?.squadOrder ?? normalized, row?.updatedAt ?? now);
    },

    async getProjectOrder(squadId: string, userId: string): Promise<SidebarOrderPreference> {
      const row = await db.query.squadUserSidebarPreferences.findFirst({
        where: and(
          eq(squadUserSidebarPreferences.squadId, squadId),
          eq(squadUserSidebarPreferences.userId, userId),
        ),
      });
      return toPreference(row?.projectOrder ?? [], row?.updatedAt ?? null);
    },

    async upsertProjectOrder(
      squadId: string,
      userId: string,
      orderedIds: string[],
    ): Promise<SidebarOrderPreference> {
      const now = new Date();
      const normalized = normalizeOrderedIds(orderedIds);
      const [row] = await db
        .insert(squadUserSidebarPreferences)
        .values({
          squadId,
          userId,
          projectOrder: normalized,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [squadUserSidebarPreferences.squadId, squadUserSidebarPreferences.userId],
          set: {
            projectOrder: normalized,
            updatedAt: now,
          },
        })
        .returning();
      return toPreference(row?.projectOrder ?? normalized, row?.updatedAt ?? now);
    },
  };
}
