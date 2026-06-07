import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@slaw/db";
import {
  squads,
  squadLogos,
  assets,
  agents,
  agentApiKeys,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  issues,
  issueComments,
  projects,
  goals,
  heartbeatRuns,
  heartbeatRunEvents,
  costEvents,
  financeEvents,
  issueReadStates,
  approvalComments,
  approvals,
  activityLog,
  squadSecrets,
  joinRequests,
  invites,
  principalPermissionGrants,
  squadMemberships,
  squadSkills,
  documents,
} from "@slaw/db";
import { notFound, unprocessable } from "../errors.js";
import { environmentService } from "./environments.js";

export function squadService(db: Db) {
  const ISSUE_PREFIX_FALLBACK = "CMP";
  const environmentsSvc = environmentService(db);

  const squadSelection = {
    id: squads.id,
    name: squads.name,
    description: squads.description,
    status: squads.status,
    issuePrefix: squads.issuePrefix,
    issueCounter: squads.issueCounter,
    budgetMonthlyCents: squads.budgetMonthlyCents,
    spentMonthlyCents: squads.spentMonthlyCents,
    attachmentMaxBytes: squads.attachmentMaxBytes,
    requireOperatorApprovalForNewAgents: squads.requireOperatorApprovalForNewAgents,
    feedbackDataSharingEnabled: squads.feedbackDataSharingEnabled,
    feedbackDataSharingConsentAt: squads.feedbackDataSharingConsentAt,
    feedbackDataSharingConsentByUserId: squads.feedbackDataSharingConsentByUserId,
    feedbackDataSharingTermsVersion: squads.feedbackDataSharingTermsVersion,
    brandColor: squads.brandColor,
    logoAssetId: squadLogos.assetId,
    createdAt: squads.createdAt,
    updatedAt: squads.updatedAt,
  };

  function enrichSquad<T extends { logoAssetId: string | null }>(squad: T) {
    return {
      ...squad,
      logoUrl: squad.logoAssetId ? `/api/assets/${squad.logoAssetId}/content` : null,
    };
  }

  function currentUtcMonthWindow(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    return {
      start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
      end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
    };
  }

  async function getMonthlySpendBySquadIds(
    squadIds: string[],
    database: Pick<Db, "select"> = db,
  ) {
    if (squadIds.length === 0) return new Map<string, number>();
    const { start, end } = currentUtcMonthWindow();
    const rows = await database
        .select({
          squadId: costEvents.squadId,
          spentMonthlyCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
        })
      .from(costEvents)
      .where(
        and(
          inArray(costEvents.squadId, squadIds),
          gte(costEvents.occurredAt, start),
          lt(costEvents.occurredAt, end),
        ),
      )
      .groupBy(costEvents.squadId);
    return new Map(rows.map((row) => [row.squadId, Number(row.spentMonthlyCents ?? 0)]));
  }

  async function hydrateSquadSpend<T extends { id: string; spentMonthlyCents: number }>(
    rows: T[],
    database: Pick<Db, "select"> = db,
  ) {
    const spendBySquadId = await getMonthlySpendBySquadIds(rows.map((row) => row.id), database);
    return rows.map((row) => ({
      ...row,
      spentMonthlyCents: spendBySquadId.get(row.id) ?? 0,
    }));
  }

  function getSquadQuery(database: Pick<Db, "select">) {
    return database
      .select(squadSelection)
      .from(squads)
      .leftJoin(squadLogos, eq(squadLogos.squadId, squads.id));
  }

  function deriveIssuePrefixBase(name: string) {
    const normalized = name.toUpperCase().replace(/[^A-Z]/g, "");
    return normalized.slice(0, 3) || ISSUE_PREFIX_FALLBACK;
  }

  function suffixForAttempt(attempt: number) {
    if (attempt <= 1) return "";
    return "A".repeat(attempt - 1);
  }

  function isIssuePrefixConflict(error: unknown) {
    const seen = new Set<unknown>();
    let current = error;
    while (typeof current === "object" && current !== null && !seen.has(current)) {
      seen.add(current);
      const maybe = current as { code?: string; constraint?: string; constraint_name?: string; cause?: unknown };
      const constraint = maybe.constraint ?? maybe.constraint_name;
      if (maybe.code === "23505" && constraint === "squads_issue_prefix_idx") {
        return true;
      }
      current = maybe.cause;
    }
    return false;
  }

  async function createSquadWithUniquePrefix(data: typeof squads.$inferInsert) {
    const base = deriveIssuePrefixBase(data.name);
    let suffix = 1;
    while (suffix < 10000) {
      const candidate = `${base}${suffixForAttempt(suffix)}`;
      try {
        const rows = await db
          .insert(squads)
          .values({ ...data, issuePrefix: candidate })
          .returning();
        return rows[0];
      } catch (error) {
        if (!isIssuePrefixConflict(error)) throw error;
      }
      suffix += 1;
    }
    throw new Error("Unable to allocate unique issue prefix");
  }

  return {
    list: async () => {
      const rows = await getSquadQuery(db);
      const hydrated = await hydrateSquadSpend(rows);
      return hydrated.map((row) => enrichSquad(row));
    },

    getById: async (id: string) => {
      const row = await getSquadQuery(db)
        .where(eq(squads.id, id))
        .then((rows) => rows[0] ?? null);
      if (!row) return null;
      const [hydrated] = await hydrateSquadSpend([row], db);
      return enrichSquad(hydrated);
    },

    create: async (data: typeof squads.$inferInsert) => {
      const created = await createSquadWithUniquePrefix(data);
      await environmentsSvc.ensureLocalEnvironment(created.id);
      const row = await getSquadQuery(db)
        .where(eq(squads.id, created.id))
        .then((rows) => rows[0] ?? null);
      if (!row) throw notFound("Squad not found after creation");
      const [hydrated] = await hydrateSquadSpend([row], db);
      return enrichSquad(hydrated);
    },

    update: (
      id: string,
      data: Partial<typeof squads.$inferInsert> & { logoAssetId?: string | null },
    ) =>
      db.transaction(async (tx) => {
        const existing = await getSquadQuery(tx)
          .where(eq(squads.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        const { logoAssetId, ...squadPatch } = data;

        if (logoAssetId !== undefined && logoAssetId !== null) {
          const nextLogoAsset = await tx
            .select({ id: assets.id, squadId: assets.squadId })
            .from(assets)
            .where(eq(assets.id, logoAssetId))
            .then((rows) => rows[0] ?? null);
          if (!nextLogoAsset) throw notFound("Logo asset not found");
          if (nextLogoAsset.squadId !== existing.id) {
            throw unprocessable("Logo asset must belong to the same squad");
          }
        }

        const updated = await tx
          .update(squads)
          .set({ ...squadPatch, updatedAt: new Date() })
          .where(eq(squads.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!updated) return null;

        if (logoAssetId === null) {
          await tx.delete(squadLogos).where(eq(squadLogos.squadId, id));
        } else if (logoAssetId !== undefined) {
          await tx
            .insert(squadLogos)
            .values({
              squadId: id,
              assetId: logoAssetId,
            })
            .onConflictDoUpdate({
              target: squadLogos.squadId,
              set: {
                assetId: logoAssetId,
                updatedAt: new Date(),
              },
            });
        }

        if (logoAssetId !== undefined && existing.logoAssetId && existing.logoAssetId !== logoAssetId) {
          await tx.delete(assets).where(eq(assets.id, existing.logoAssetId));
        }

        const [hydrated] = await hydrateSquadSpend([{
          ...updated,
          logoAssetId: logoAssetId === undefined ? existing.logoAssetId : logoAssetId,
        }], tx);

        return enrichSquad(hydrated);
      }),

    archive: (id: string) =>
      db.transaction(async (tx) => {
        const updated = await tx
          .update(squads)
          .set({ status: "archived", updatedAt: new Date() })
          .where(eq(squads.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!updated) return null;
        const row = await getSquadQuery(tx)
          .where(eq(squads.id, id))
          .then((rows) => rows[0] ?? null);
        if (!row) return null;
        const [hydrated] = await hydrateSquadSpend([row], tx);
        return enrichSquad(hydrated);
      }),

    remove: (id: string) =>
      db.transaction(async (tx) => {
        // Delete from child tables in dependency order
        const squadRunIds = await tx
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.squadId, id));

        await tx.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.squadId, id));
        if (squadRunIds.length > 0) {
          await tx
            .delete(heartbeatRunEvents)
            .where(inArray(heartbeatRunEvents.runId, squadRunIds.map((run) => run.id)));
        }
        await tx.delete(agentTaskSessions).where(eq(agentTaskSessions.squadId, id));
        await tx.delete(activityLog).where(eq(activityLog.squadId, id));
        await tx.delete(heartbeatRuns).where(eq(heartbeatRuns.squadId, id));
        await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.squadId, id));
        await tx.delete(agentApiKeys).where(eq(agentApiKeys.squadId, id));
        await tx.delete(agentRuntimeState).where(eq(agentRuntimeState.squadId, id));
        await tx.delete(issueComments).where(eq(issueComments.squadId, id));
        await tx.delete(costEvents).where(eq(costEvents.squadId, id));
        await tx.delete(financeEvents).where(eq(financeEvents.squadId, id));
        await tx.delete(approvalComments).where(eq(approvalComments.squadId, id));
        await tx.delete(approvals).where(eq(approvals.squadId, id));
        await tx.delete(squadSecrets).where(eq(squadSecrets.squadId, id));
        await tx.delete(joinRequests).where(eq(joinRequests.squadId, id));
        await tx.delete(invites).where(eq(invites.squadId, id));
        await tx.delete(principalPermissionGrants).where(eq(principalPermissionGrants.squadId, id));
        await tx.delete(squadMemberships).where(eq(squadMemberships.squadId, id));
        await tx.delete(squadSkills).where(eq(squadSkills.squadId, id));
        await tx.delete(issueReadStates).where(eq(issueReadStates.squadId, id));
        await tx.delete(documents).where(eq(documents.squadId, id));
        await tx.delete(issues).where(eq(issues.squadId, id));
        await tx.delete(squadLogos).where(eq(squadLogos.squadId, id));
        await tx.delete(assets).where(eq(assets.squadId, id));
        await tx.delete(goals).where(eq(goals.squadId, id));
        await tx.delete(projects).where(eq(projects.squadId, id));
        await tx.delete(agents).where(eq(agents.squadId, id));
        const rows = await tx
          .delete(squads)
          .where(eq(squads.id, id))
          .returning();
        return rows[0] ?? null;
      }),

    stats: () =>
      Promise.all([
        db
          .select({ squadId: agents.squadId, count: count() })
          .from(agents)
          .groupBy(agents.squadId),
        db
          .select({ squadId: issues.squadId, count: count() })
          .from(issues)
          .groupBy(issues.squadId),
      ]).then(([agentRows, issueRows]) => {
        const result: Record<string, { agentCount: number; issueCount: number }> = {};
        for (const row of agentRows) {
          result[row.squadId] = { agentCount: row.count, issueCount: 0 };
        }
        for (const row of issueRows) {
          if (result[row.squadId]) {
            result[row.squadId].issueCount = row.count;
          } else {
            result[row.squadId] = { agentCount: 0, issueCount: row.count };
          }
        }
        return result;
      }),
  };
}
