import { Router } from "express";
import type { Db } from "@slaw-ai/db";
import { dashboardService } from "../services/dashboard.js";
import { assertSquadAccess } from "./authz.js";

export function dashoperatorRoutes(db: Db) {
  const router = Router();
  const svc = dashboardService(db);

  router.get("/squads/:squadId/dashboard", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const summary = await svc.summary(squadId);
    res.json(summary);
  });

  return router;
}
