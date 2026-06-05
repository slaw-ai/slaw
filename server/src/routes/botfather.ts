import { Router } from "express";
import type { BotfatherService } from "../services/botfather/service.js";

/**
 * Instance-side botfather routes that back the startup gate + Settings panel.
 * Read-only status plus two control actions. Local-trusted by default; under
 * authenticated deployments these would gate to board access (future).
 */
export function botfatherRoutes(service: BotfatherService | undefined): Router {
  const router = Router();

  router.get("/botfather/status", (_req, res) => {
    if (!service || !service.enabled) {
      res.json({ state: "standalone", url: null, enrolled: false, gated: false });
      return;
    }
    const status = service.status();
    res.json({ ...status, gated: service.isGated() });
  });

  router.post("/botfather/reenroll", async (_req, res) => {
    if (!service || !service.enabled) {
      res.status(409).json({ error: "no_control_tower_configured" });
      return;
    }
    const state = await service.enrollment.reenroll();
    res.json({ ...service.status(), state, gated: service.isGated() });
  });

  router.post("/botfather/disconnect", (_req, res) => {
    // Disconnect is only permitted when policy allows (advisory). Under
    // enforce, IT-managed config keeps the tower attached.
    if (!service || !service.enabled) {
      res.status(409).json({ error: "no_control_tower_configured" });
      return;
    }
    if (service.status().enforcement === "enforce") {
      res.status(403).json({ error: "disconnect_blocked_by_policy" });
      return;
    }
    service.enrollment.onRevoked();
    res.json({ ...service.status(), gated: service.isGated() });
  });

  return router;
}
