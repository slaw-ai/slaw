import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@slaw/db";
import { goals } from "@slaw/db";

type GoalReader = Pick<Db, "select">;

export async function getDefaultSquadGoal(db: GoalReader, squadId: string) {
  const activeRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.squadId, squadId),
        eq(goals.level, "squad"),
        eq(goals.status, "active"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (activeRootGoal) return activeRootGoal;

  const anyRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.squadId, squadId),
        eq(goals.level, "squad"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (anyRootGoal) return anyRootGoal;

  return db
    .select()
    .from(goals)
    .where(and(eq(goals.squadId, squadId), eq(goals.level, "squad")))
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
}

export function goalService(db: Db) {
  return {
    list: (squadId: string) => db.select().from(goals).where(eq(goals.squadId, squadId)),

    getById: (id: string) =>
      db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null),

    getDefaultSquadGoal: (squadId: string) => getDefaultSquadGoal(db, squadId),

    create: (squadId: string, data: Omit<typeof goals.$inferInsert, "squadId">) =>
      db
        .insert(goals)
        .values({ ...data, squadId })
        .returning()
        .then((rows) => rows[0]),

    update: (id: string, data: Partial<typeof goals.$inferInsert>) =>
      db
        .update(goals)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    remove: (id: string) =>
      db
        .delete(goals)
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
