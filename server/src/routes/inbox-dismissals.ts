import { Router } from "express";
import { z } from "zod";
import type { Db } from "@slaw-ai/db";
import { validate } from "../middleware/validate.js";
import { assertSquadAccess, getActorInfo } from "./authz.js";
import { inboxDismissalService, logActivity } from "../services/index.js";

const inboxDismissalSchema = z.object({
  itemKey: z.string().trim().min(1).regex(/^(approval|join|run):.+$/, "Unsupported inbox item key"),
});

export function inboxDismissalRoutes(db: Db) {
  const router = Router();
  const svc = inboxDismissalService(db);

  router.get("/squads/:squadId/inbox-dismissals", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    if (req.actor.type !== "operator") {
      res.status(403).json({ error: "Operator authentication required" });
      return;
    }
    if (!req.actor.userId) {
      res.status(403).json({ error: "Operator user context required" });
      return;
    }
    const dismissals = await svc.list(squadId, req.actor.userId);
    res.json(dismissals);
  });

  router.post(
    "/squads/:squadId/inbox-dismissals",
    validate(inboxDismissalSchema),
    async (req, res) => {
      const squadId = req.params.squadId as string;
      assertSquadAccess(req, squadId);
      if (req.actor.type !== "operator") {
        res.status(403).json({ error: "Operator authentication required" });
        return;
      }
      if (!req.actor.userId) {
        res.status(403).json({ error: "Operator user context required" });
        return;
      }

      const dismissal = await svc.dismiss(squadId, req.actor.userId, req.body.itemKey, new Date());
      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "inbox.dismissed",
        entityType: "squad",
        entityId: squadId,
        details: {
          userId: req.actor.userId,
          itemKey: dismissal.itemKey,
          dismissedAt: dismissal.dismissedAt,
        },
      });

      res.status(201).json(dismissal);
    },
  );

  return router;
}
