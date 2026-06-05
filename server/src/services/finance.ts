import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@slaw/db";
import { agents, costEvents, financeEvents, goals, heartbeatRuns, issues, projects } from "@slaw/db";
import { notFound, unprocessable } from "../errors.js";

export interface FinanceDateRange {
  from?: Date;
  to?: Date;
}

async function assertBelongsToSquad(
  db: Db,
  table: any,
  id: string,
  squadId: string,
  label: string,
) {
  const row = await db
    .select()
    .from(table)
    .where(eq(table.id, id))
    .then((rows) => rows[0] ?? null);

  if (!row) throw notFound(`${label} not found`);
  if ((row as unknown as { squadId: string }).squadId !== squadId) {
    throw unprocessable(`${label} does not belong to squad`);
  }
}

function rangeConditions(squadId: string, range?: FinanceDateRange) {
  const conditions: ReturnType<typeof eq>[] = [eq(financeEvents.squadId, squadId)];
  if (range?.from) conditions.push(gte(financeEvents.occurredAt, range.from));
  if (range?.to) conditions.push(lte(financeEvents.occurredAt, range.to));
  return conditions;
}

export function financeService(db: Db) {
  const debitExpr = sql<number>`coalesce(sum(case when ${financeEvents.direction} = 'debit' then ${financeEvents.amountCents} else 0 end), 0)::double precision`;
  const creditExpr = sql<number>`coalesce(sum(case when ${financeEvents.direction} = 'credit' then ${financeEvents.amountCents} else 0 end), 0)::double precision`;
  const estimatedDebitExpr = sql<number>`coalesce(sum(case when ${financeEvents.direction} = 'debit' and ${financeEvents.estimated} = true then ${financeEvents.amountCents} else 0 end), 0)::double precision`;

  return {
    createEvent: async (squadId: string, data: Omit<typeof financeEvents.$inferInsert, "squadId">) => {
      if (data.agentId) await assertBelongsToSquad(db, agents, data.agentId, squadId, "Agent");
      if (data.issueId) await assertBelongsToSquad(db, issues, data.issueId, squadId, "Issue");
      if (data.projectId) await assertBelongsToSquad(db, projects, data.projectId, squadId, "Project");
      if (data.goalId) await assertBelongsToSquad(db, goals, data.goalId, squadId, "Goal");
      if (data.heartbeatRunId) await assertBelongsToSquad(db, heartbeatRuns, data.heartbeatRunId, squadId, "Heartbeat run");
      if (data.costEventId) await assertBelongsToSquad(db, costEvents, data.costEventId, squadId, "Cost event");

      const event = await db
        .insert(financeEvents)
        .values({
          ...data,
          squadId,
          currency: data.currency ?? "USD",
          direction: data.direction ?? "debit",
          estimated: data.estimated ?? false,
        })
        .returning()
        .then((rows) => rows[0]);

      return event;
    },

    summary: async (squadId: string, range?: FinanceDateRange) => {
      const conditions = rangeConditions(squadId, range);
      const [row] = await db
        .select({
          debitCents: debitExpr,
          creditCents: creditExpr,
          estimatedDebitCents: estimatedDebitExpr,
          eventCount: sql<number>`count(*)::int`,
        })
        .from(financeEvents)
        .where(and(...conditions));

      return {
        squadId,
        debitCents: Number(row?.debitCents ?? 0),
        creditCents: Number(row?.creditCents ?? 0),
        netCents: Number(row?.debitCents ?? 0) - Number(row?.creditCents ?? 0),
        estimatedDebitCents: Number(row?.estimatedDebitCents ?? 0),
        eventCount: Number(row?.eventCount ?? 0),
      };
    },

    byBiller: async (squadId: string, range?: FinanceDateRange) => {
      const conditions = rangeConditions(squadId, range);
      return db
        .select({
          biller: financeEvents.biller,
          debitCents: debitExpr,
          creditCents: creditExpr,
          estimatedDebitCents: estimatedDebitExpr,
          eventCount: sql<number>`count(*)::int`,
          kindCount: sql<number>`count(distinct ${financeEvents.eventKind})::int`,
          netCents: sql<number>`(${debitExpr} - ${creditExpr})::double precision`,
        })
        .from(financeEvents)
        .where(and(...conditions))
        .groupBy(financeEvents.biller)
        .orderBy(desc(sql`(${debitExpr} - ${creditExpr})::double precision`), financeEvents.biller);
    },

    byKind: async (squadId: string, range?: FinanceDateRange) => {
      const conditions = rangeConditions(squadId, range);
      return db
        .select({
          eventKind: financeEvents.eventKind,
          debitCents: debitExpr,
          creditCents: creditExpr,
          estimatedDebitCents: estimatedDebitExpr,
          eventCount: sql<number>`count(*)::int`,
          billerCount: sql<number>`count(distinct ${financeEvents.biller})::int`,
          netCents: sql<number>`(${debitExpr} - ${creditExpr})::double precision`,
        })
        .from(financeEvents)
        .where(and(...conditions))
        .groupBy(financeEvents.eventKind)
        .orderBy(desc(sql`(${debitExpr} - ${creditExpr})::double precision`), financeEvents.eventKind);
    },

    list: async (squadId: string, range?: FinanceDateRange, limit: number = 100) => {
      const conditions = rangeConditions(squadId, range);
      return db
        .select()
        .from(financeEvents)
        .where(and(...conditions))
        .orderBy(desc(financeEvents.occurredAt), desc(financeEvents.createdAt))
        .limit(limit);
    },
  };
}
