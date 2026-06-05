import { Router, type Request, type Response } from "express";
import type { Db } from "@slaw/db";
import { upsertSidebarOrderPreferenceSchema } from "@slaw/shared";
import { validate } from "../middleware/validate.js";
import { logActivity, sidebarPreferenceService } from "../services/index.js";
import { assertBoard, assertSquadAccess, getActorInfo } from "./authz.js";

function requireBoardUserId(req: Request, res: Response): string | null {
  assertBoard(req);
  if (!req.actor.userId) {
    res.status(403).json({ error: "Board user context required" });
    return null;
  }
  return req.actor.userId;
}

export function sidebarPreferenceRoutes(db: Db) {
  const router = Router();
  const svc = sidebarPreferenceService(db);

  router.get("/sidebar-preferences/me", async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    res.json(await svc.getSquadOrder(userId));
  });

  router.put("/sidebar-preferences/me", validate(upsertSidebarOrderPreferenceSchema), async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    res.json(await svc.upsertSquadOrder(userId, req.body.orderedIds));
  });

  router.get("/squads/:squadId/sidebar-preferences/me", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    res.json(await svc.getProjectOrder(squadId, userId));
  });

  router.put(
    "/squads/:squadId/sidebar-preferences/me",
    validate(upsertSidebarOrderPreferenceSchema),
    async (req, res) => {
      const squadId = req.params.squadId as string;
      assertSquadAccess(req, squadId);
      const userId = requireBoardUserId(req, res);
      if (!userId) return;

      const result = await svc.upsertProjectOrder(squadId, userId, req.body.orderedIds);
      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "sidebar_preferences.project_order_updated",
        entityType: "squad",
        entityId: squadId,
        details: {
          userId,
          orderedIds: result.orderedIds,
        },
      });
      res.json(result);
    },
  );

  return router;
}
