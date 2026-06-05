import { Router } from "express";
import type { Db } from "@slaw/db";
import { and, eq } from "drizzle-orm";
import { inboxDismissals, joinRequests } from "@slaw/db";
import { sidebarBadgeService } from "../services/sidebar-badges.js";
import { accessService } from "../services/access.js";
import { dashboardService } from "../services/dashboard.js";
import { collapseDuplicatePendingHumanJoinRequests } from "../lib/join-request-dedupe.js";
import { assertSquadAccess } from "./authz.js";

function buildDismissedAtByKey(
  dismissals: Array<{ itemKey: string; dismissedAt: Date | string }>,
): Map<string, number> {
  return new Map(
    dismissals.map((dismissal) => [dismissal.itemKey, new Date(dismissal.dismissedAt).getTime()]),
  );
}

export function sidebarBadgeRoutes(db: Db) {
  const router = Router();
  const svc = sidebarBadgeService(db);
  const access = accessService(db);
  const dashboard = dashboardService(db);

  router.get("/squads/:squadId/sidebar-badges", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    let canApproveJoins = false;
    if (req.actor.type === "board") {
      canApproveJoins =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(squadId, req.actor.userId, "joins:approve"));
    } else if (req.actor.type === "agent" && req.actor.agentId) {
      canApproveJoins = await access.hasPermission(squadId, "agent", req.actor.agentId, "joins:approve");
    }

    const visibleJoinRequests = canApproveJoins
      ? collapseDuplicatePendingHumanJoinRequests(
        await db
          .select({
            id: joinRequests.id,
            requestType: joinRequests.requestType,
            status: joinRequests.status,
            requestingUserId: joinRequests.requestingUserId,
            requestEmailSnapshot: joinRequests.requestEmailSnapshot,
            updatedAt: joinRequests.updatedAt,
            createdAt: joinRequests.createdAt,
          })
          .from(joinRequests)
          .where(and(eq(joinRequests.squadId, squadId), eq(joinRequests.status, "pending_approval")))
      ).map(({ id, updatedAt, createdAt }) => ({
        id,
        updatedAt,
        createdAt,
      }))
      : [];

    const dismissedAtByKey =
      req.actor.type === "board" && req.actor.userId
        ? await db
          .select({ itemKey: inboxDismissals.itemKey, dismissedAt: inboxDismissals.dismissedAt })
          .from(inboxDismissals)
          .where(and(eq(inboxDismissals.squadId, squadId), eq(inboxDismissals.userId, req.actor.userId)))
          .then(buildDismissedAtByKey)
        : new Map<string, number>();

    const badges = await svc.get(squadId, {
      dismissals: dismissedAtByKey,
      joinRequests: visibleJoinRequests,
    });
    const summary = await dashboard.summary(squadId);
    const hasFailedRuns = badges.failedRuns > 0;
    const alertsCount =
      (summary.agents.error > 0 && !hasFailedRuns ? 1 : 0) +
      (summary.costs.monthBudgetCents > 0 && summary.costs.monthUtilizationPercent >= 80 ? 1 : 0);
    badges.inbox = badges.failedRuns + alertsCount + badges.joinRequests + badges.approvals;

    res.json(badges);
  });

  return router;
}
