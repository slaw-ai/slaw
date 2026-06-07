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

  // Connect a running instance to a control tower (Settings → Control Tower).
  router.post("/botfather/connect", (req, res) => {
    if (!service) {
      res.status(409).json({ error: "botfather_unavailable" });
      return;
    }
    const body = (req.body ?? {}) as { url?: unknown; enforcement?: unknown };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const enforcement = body.enforcement === "advisory" ? "advisory" : "enforce";
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("scheme");
    } catch {
      res.status(400).json({ error: "invalid_url" });
      return;
    }
    const status = service.connect(parsed.toString().replace(/\/$/, ""), enforcement);
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

  // Manually sync everything to the tower now (Settings → Control Tower).
  router.post("/botfather/force-sync", async (_req, res) => {
    if (!service || !service.enabled) {
      res.status(409).json({ error: "no_control_tower_configured" });
      return;
    }
    try {
      const result = await service.forceSync();
      res.json({ ok: true, ...result });
    } catch (err) {
      const code = err instanceof Error ? err.message : "force_sync_failed";
      // not_enrolled is a client-state issue (409); anything else is a transient
      // sync/transport failure (502 — the tower or network is the problem).
      res.status(code === "not_enrolled" ? 409 : 502).json({ error: code });
    }
  });

  /* ── skill registry (tower-mastered) ── */
  router.get("/botfather/skills/catalog", async (_req, res) => {
    if (!service || !service.enabled) {
      res.status(409).json({ error: "no_control_tower_configured" });
      return;
    }
    try {
      res.json(await service.listSkillCatalog());
    } catch (err) {
      const code = err instanceof Error ? err.message : "catalog_failed";
      res.status(code === "not_enrolled" || code === "no_control_tower_configured" ? 409 : 502).json({ error: code });
    }
  });

  router.post("/botfather/skills/install", async (req, res) => {
    if (!service || !service.enabled) {
      res.status(409).json({ error: "no_control_tower_configured" });
      return;
    }
    const squadId = typeof req.body?.squadId === "string" ? req.body.squadId : "";
    const key = typeof req.body?.key === "string" ? req.body.key : "";
    if (!squadId || !key) {
      res.status(400).json({ error: "squadId and key are required" });
      return;
    }
    try {
      const skill = await service.installSkill(squadId, key);
      res.status(201).json({ ok: true, skill });
    } catch (err) {
      const code = err instanceof Error ? err.message : "install_failed";
      res.status(code === "not_enrolled" || code === "no_control_tower_configured" ? 409 : 502).json({ error: code });
    }
  });

  router.post("/botfather/skills/refresh", async (_req, res) => {
    if (!service || !service.enabled) {
      res.status(409).json({ error: "no_control_tower_configured" });
      return;
    }
    try {
      res.json({ ok: true, ...(await service.refreshSkills()) });
    } catch (err) {
      const code = err instanceof Error ? err.message : "refresh_failed";
      res.status(code === "not_enrolled" || code === "no_control_tower_configured" ? 409 : 502).json({ error: code });
    }
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
    const status = service.disconnect();
    res.json({ ...status, gated: service.isGated() });
  });

  return router;
}
