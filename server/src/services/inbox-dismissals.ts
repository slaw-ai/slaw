import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@slaw/db";
import { inboxDismissals } from "@slaw/db";

export function inboxDismissalService(db: Db) {
  return {
    list: async (squadId: string, userId: string) =>
      db
        .select()
        .from(inboxDismissals)
        .where(and(eq(inboxDismissals.squadId, squadId), eq(inboxDismissals.userId, userId)))
        .orderBy(desc(inboxDismissals.updatedAt)),

    dismiss: async (
      squadId: string,
      userId: string,
      itemKey: string,
      dismissedAt: Date = new Date(),
    ) => {
      const now = new Date();
      const [row] = await db
        .insert(inboxDismissals)
        .values({
          squadId,
          userId,
          itemKey,
          dismissedAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [inboxDismissals.squadId, inboxDismissals.userId, inboxDismissals.itemKey],
          set: {
            dismissedAt,
            updatedAt: now,
          },
        })
        .returning();
      return row;
    },
  };
}
