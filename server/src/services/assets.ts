import { eq } from "drizzle-orm";
import type { Db } from "@slaw/db";
import { assets } from "@slaw/db";

export function assetService(db: Db) {
  return {
    create: (squadId: string, data: Omit<typeof assets.$inferInsert, "squadId">) =>
      db
        .insert(assets)
        .values({ ...data, squadId })
        .returning()
        .then((rows) => rows[0]),

    getById: (id: string) =>
      db
        .select()
        .from(assets)
        .where(eq(assets.id, id))
        .then((rows) => rows[0] ?? null),
  };
}

