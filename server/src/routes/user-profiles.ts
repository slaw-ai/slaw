import { Router } from "express";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "@slaw/db";
import {
  activityLog,
  agents,
  authUsers,
  squadMemberships,
  costEvents,
  issueComments,
  issues,
} from "@slaw/db";
import type {
  UserProfileDailyPoint,
  UserProfileIdentity,
  UserProfileResponse,
  UserProfileWindowStats,
} from "@slaw/shared";
import { notFound } from "../errors.js";
import { assertSquadAccess } from "./authz.js";

type SquadUserRow = {
  id: string;
  principalId: string;
  status: string;
  membershipRole: string | null;
  createdAt: Date;
  userId: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
};

const PROFILE_WINDOWS = [
  { key: "last7", label: "Last 7 days", days: 7 },
  { key: "last30", label: "Last 30 days", days: 30 },
  { key: "all", label: "All time", days: null },
] as const;

function slugifyUserPart(value: string | null | undefined) {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

function userSlugCandidates(row: SquadUserRow) {
  const candidates = new Set<string>();
  const add = (value: string | null | undefined) => {
    const slug = slugifyUserPart(value);
    if (slug) candidates.add(slug);
  };
  add(row.name);
  add(row.email?.split("@")[0]);
  add(row.email);
  add(row.principalId);
  return [...candidates];
}

async function resolveSquadUser(db: Db, squadId: string, rawSlug: string): Promise<SquadUserRow | null> {
  const slug = slugifyUserPart(rawSlug);
  if (!slug) return null;

  const rows = await db
    .select({
      id: squadMemberships.id,
      principalId: squadMemberships.principalId,
      status: squadMemberships.status,
      membershipRole: squadMemberships.membershipRole,
      createdAt: squadMemberships.createdAt,
      userId: authUsers.id,
      name: authUsers.name,
      email: authUsers.email,
      image: authUsers.image,
    })
    .from(squadMemberships)
    .leftJoin(authUsers, eq(authUsers.id, squadMemberships.principalId))
    .where(
      and(
        eq(squadMemberships.squadId, squadId),
        eq(squadMemberships.principalType, "user"),
      ),
    )
    .orderBy(desc(squadMemberships.updatedAt))
    .limit(200);

  return rows.find((row) => userSlugCandidates(row).includes(slug)) ?? null;
}

function userIssueInvolvementSql(squadId: string, userId: string) {
  return sql<boolean>`
    (
      ${issues.createdByUserId} = ${userId}
      OR ${issues.assigneeUserId} = ${userId}
      OR EXISTS (
        SELECT 1
        FROM ${issueComments}
        WHERE ${issueComments.squadId} = ${squadId}
          AND ${issueComments.issueId} = ${issues.id}
          AND ${issueComments.authorUserId} = ${userId}
      )
    )
  `;
}

function windowStart(days: number | null) {
  if (!days) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function dayKeyExpr(dateSql: ReturnType<typeof sql>) {
  return sql<string>`to_char(date_trunc('day', ${dateSql}), 'YYYY-MM-DD')`;
}

function sumNumber(column: typeof costEvents.costCents | typeof costEvents.inputTokens | typeof costEvents.cachedInputTokens | typeof costEvents.outputTokens) {
  return sql<number>`coalesce(sum(${column}), 0)::double precision`;
}

async function loadWindowStats(
  db: Db,
  squadId: string,
  userId: string,
  key: UserProfileWindowStats["key"],
  label: string,
  from: Date | null,
): Promise<UserProfileWindowStats> {
  const involvement = userIssueInvolvementSql(squadId, userId);
  const openStatuses = ["backlog", "todo", "in_progress", "in_review", "blocked"];
  const fromIso = from?.toISOString();

  const [issueStats] = await db
    .select({
      touchedIssues: sql<number>`count(distinct case when ${involvement} ${fromIso ? sql`and ${issues.updatedAt} >= ${fromIso}` : sql``} then ${issues.id} end)::int`,
      createdIssues: sql<number>`count(distinct case when ${issues.createdByUserId} = ${userId} ${fromIso ? sql`and ${issues.createdAt} >= ${fromIso}` : sql``} then ${issues.id} end)::int`,
      completedIssues: sql<number>`count(distinct case when ${involvement} and ${issues.status} = 'done' ${fromIso ? sql`and ${issues.completedAt} >= ${fromIso}` : sql``} then ${issues.id} end)::int`,
      assignedOpenIssues: sql<number>`count(distinct case when ${issues.assigneeUserId} = ${userId} and ${issues.status} in (${sql.join(openStatuses.map((status) => sql`${status}`), sql`, `)}) then ${issues.id} end)::int`,
    })
    .from(issues)
    .where(and(eq(issues.squadId, squadId), isNull(issues.hiddenAt)));

  const commentConditions = [
    eq(issueComments.squadId, squadId),
    eq(issueComments.authorUserId, userId),
  ];
  if (from) commentConditions.push(gte(issueComments.createdAt, from));
  const [commentStats] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issueComments)
    .where(and(...commentConditions));

  const activityConditions = [
    eq(activityLog.squadId, squadId),
    eq(activityLog.actorType, "user"),
    eq(activityLog.actorId, userId),
  ];
  if (from) activityConditions.push(gte(activityLog.createdAt, from));
  const [activityStats] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(and(...activityConditions));

  const costConditions = [
    eq(costEvents.squadId, squadId),
    userIssueInvolvementSql(squadId, userId),
  ];
  if (from) costConditions.push(gte(costEvents.occurredAt, from));
  const [costStats] = await db
    .select({
      costCents: sumNumber(costEvents.costCents),
      inputTokens: sumNumber(costEvents.inputTokens),
      cachedInputTokens: sumNumber(costEvents.cachedInputTokens),
      outputTokens: sumNumber(costEvents.outputTokens),
      costEventCount: sql<number>`count(${costEvents.id})::int`,
    })
    .from(costEvents)
    .innerJoin(issues, and(eq(issues.id, costEvents.issueId), eq(issues.squadId, costEvents.squadId)))
    .where(and(...costConditions));

  return {
    key,
    label,
    touchedIssues: Number(issueStats?.touchedIssues ?? 0),
    createdIssues: Number(issueStats?.createdIssues ?? 0),
    completedIssues: Number(issueStats?.completedIssues ?? 0),
    assignedOpenIssues: Number(issueStats?.assignedOpenIssues ?? 0),
    commentCount: Number(commentStats?.count ?? 0),
    activityCount: Number(activityStats?.count ?? 0),
    costCents: Number(costStats?.costCents ?? 0),
    inputTokens: Number(costStats?.inputTokens ?? 0),
    cachedInputTokens: Number(costStats?.cachedInputTokens ?? 0),
    outputTokens: Number(costStats?.outputTokens ?? 0),
    costEventCount: Number(costStats?.costEventCount ?? 0),
  };
}

async function loadDailyStats(db: Db, squadId: string, userId: string): Promise<UserProfileDailyPoint[]> {
  const firstDay = startOfUtcDay(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));
  const points = new Map<string, UserProfileDailyPoint>();
  for (let index = 0; index < 14; index += 1) {
    const date = new Date(firstDay.getTime() + index * 24 * 60 * 60 * 1000);
    points.set(isoDay(date), {
      date: isoDay(date),
      activityCount: 0,
      completedIssues: 0,
      costCents: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
  }

  const activityDay = dayKeyExpr(sql`${activityLog.createdAt}`);
  const activityRows = await db
    .select({
      date: activityDay,
      count: sql<number>`count(*)::int`,
    })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.squadId, squadId),
        eq(activityLog.actorType, "user"),
        eq(activityLog.actorId, userId),
        gte(activityLog.createdAt, firstDay),
      ),
    )
    .groupBy(activityDay);

  for (const row of activityRows) {
    const point = points.get(row.date);
    if (point) point.activityCount = Number(row.count);
  }

  const completedDay = dayKeyExpr(sql`${issues.completedAt}`);
  const completedRows = await db
    .select({
      date: completedDay,
      count: sql<number>`count(distinct ${issues.id})::int`,
    })
    .from(issues)
    .where(
      and(
        eq(issues.squadId, squadId),
        isNull(issues.hiddenAt),
        eq(issues.status, "done"),
        gte(issues.completedAt, firstDay),
        userIssueInvolvementSql(squadId, userId),
      ),
    )
    .groupBy(completedDay);

  for (const row of completedRows) {
    const point = points.get(row.date);
    if (point) point.completedIssues = Number(row.count);
  }

  const costDay = dayKeyExpr(sql`${costEvents.occurredAt}`);
  const costRows = await db
    .select({
      date: costDay,
      costCents: sumNumber(costEvents.costCents),
      inputTokens: sumNumber(costEvents.inputTokens),
      cachedInputTokens: sumNumber(costEvents.cachedInputTokens),
      outputTokens: sumNumber(costEvents.outputTokens),
    })
    .from(costEvents)
    .innerJoin(issues, and(eq(issues.id, costEvents.issueId), eq(issues.squadId, costEvents.squadId)))
    .where(
      and(
        eq(costEvents.squadId, squadId),
        gte(costEvents.occurredAt, firstDay),
        userIssueInvolvementSql(squadId, userId),
      ),
    )
    .groupBy(costDay);

  for (const row of costRows) {
    const point = points.get(row.date);
    if (!point) continue;
    point.costCents = Number(row.costCents);
    point.inputTokens = Number(row.inputTokens);
    point.cachedInputTokens = Number(row.cachedInputTokens);
    point.outputTokens = Number(row.outputTokens);
  }

  return [...points.values()];
}

export function userProfileRoutes(db: Db) {
  const router = Router();

  router.get("/squads/:squadId/users/:userSlug/profile", async (req, res) => {
    const squadId = req.params.squadId as string;
    const userSlug = req.params.userSlug as string;
    assertSquadAccess(req, squadId);

    const row = await resolveSquadUser(db, squadId, userSlug);
    if (!row) throw notFound("User not found");
    const canonicalSlug = userSlugCandidates(row)[0] ?? row.principalId;
    const userId = row.userId ?? row.principalId;

    const [stats, daily, recentIssues, recentActivity, topAgents, topProviders] = await Promise.all([
      Promise.all(
        PROFILE_WINDOWS.map((entry) =>
          loadWindowStats(db, squadId, userId, entry.key, entry.label, windowStart(entry.days)),
        ),
      ),
      loadDailyStats(db, squadId, userId),
      db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
          assigneeAgentId: issues.assigneeAgentId,
          assigneeUserId: issues.assigneeUserId,
          updatedAt: issues.updatedAt,
          completedAt: issues.completedAt,
        })
        .from(issues)
        .where(
          and(
            eq(issues.squadId, squadId),
            isNull(issues.hiddenAt),
            userIssueInvolvementSql(squadId, userId),
          ),
        )
        .orderBy(desc(issues.updatedAt))
        .limit(8),
      db
        .select({
          id: activityLog.id,
          action: activityLog.action,
          entityType: activityLog.entityType,
          entityId: activityLog.entityId,
          details: activityLog.details,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.squadId, squadId),
            eq(activityLog.actorType, "user"),
            eq(activityLog.actorId, userId),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(12),
      db
        .select({
          agentId: costEvents.agentId,
          agentName: agents.name,
          costCents: sumNumber(costEvents.costCents),
          inputTokens: sumNumber(costEvents.inputTokens),
          cachedInputTokens: sumNumber(costEvents.cachedInputTokens),
          outputTokens: sumNumber(costEvents.outputTokens),
        })
        .from(costEvents)
        .innerJoin(issues, and(eq(issues.id, costEvents.issueId), eq(issues.squadId, costEvents.squadId)))
        .leftJoin(agents, eq(agents.id, costEvents.agentId))
        .where(and(eq(costEvents.squadId, squadId), userIssueInvolvementSql(squadId, userId)))
        .groupBy(costEvents.agentId, agents.name)
        .orderBy(desc(sumNumber(costEvents.costCents)))
        .limit(5),
      db
        .select({
          provider: costEvents.provider,
          biller: costEvents.biller,
          model: costEvents.model,
          costCents: sumNumber(costEvents.costCents),
          inputTokens: sumNumber(costEvents.inputTokens),
          cachedInputTokens: sumNumber(costEvents.cachedInputTokens),
          outputTokens: sumNumber(costEvents.outputTokens),
        })
        .from(costEvents)
        .innerJoin(issues, and(eq(issues.id, costEvents.issueId), eq(issues.squadId, costEvents.squadId)))
        .where(and(eq(costEvents.squadId, squadId), userIssueInvolvementSql(squadId, userId)))
        .groupBy(costEvents.provider, costEvents.biller, costEvents.model)
        .orderBy(desc(sumNumber(costEvents.costCents)))
        .limit(5),
    ]);

    const user: UserProfileIdentity = {
      id: userId,
      slug: canonicalSlug,
      name: row.name,
      email: row.email,
      image: row.image,
      membershipRole: row.membershipRole,
      membershipStatus: row.status,
      joinedAt: row.createdAt,
    };

    const payload: UserProfileResponse = {
      user,
      stats,
      daily,
      recentIssues: recentIssues.map((issue) => ({
        ...issue,
        status: issue.status as UserProfileResponse["recentIssues"][number]["status"],
        priority: issue.priority as UserProfileResponse["recentIssues"][number]["priority"],
      })),
      recentActivity,
      topAgents: topAgents.map((entry) => ({
        ...entry,
        costCents: Number(entry.costCents),
        inputTokens: Number(entry.inputTokens),
        cachedInputTokens: Number(entry.cachedInputTokens),
        outputTokens: Number(entry.outputTokens),
      })),
      topProviders: topProviders.map((entry) => ({
        ...entry,
        costCents: Number(entry.costCents),
        inputTokens: Number(entry.inputTokens),
        cachedInputTokens: Number(entry.cachedInputTokens),
        outputTokens: Number(entry.outputTokens),
      })),
    };

    res.json(payload);
  });

  return router;
}
