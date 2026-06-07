import { Router } from "express";
import type { Db } from "@slaw/db";
import {
  createCostEventSchema,
  createFinanceEventSchema,
  normalizeIssueIdentifier,
  resolveBudgetIncidentSchema,
  updateBudgetSchema,
  upsertBudgetPolicySchema,
} from "@slaw/shared";
import { validate } from "../middleware/validate.js";
import {
  budgetService,
  costService,
  financeService,
  squadService,
  agentService,
  issueService,
  heartbeatService,
  logActivity,
} from "../services/index.js";
import { assertOperator, assertSquadAccess, getActorInfo } from "./authz.js";
import { fetchAllQuotaWindows } from "../services/quota-windows.js";
import { badRequest } from "../errors.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";

export function parseCostDateRange(query: Record<string, unknown>) {
  const fromRaw = query.from as string | undefined;
  const toRaw = query.to as string | undefined;
  const from = fromRaw ? new Date(fromRaw) : undefined;
  const to = toRaw ? new Date(toRaw) : undefined;
  if (from && isNaN(from.getTime())) throw badRequest("invalid 'from' date");
  if (to && isNaN(to.getTime())) throw badRequest("invalid 'to' date");
  return (from || to) ? { from, to } : undefined;
}

export function parseCostLimit(query: Record<string, unknown>) {
  const raw = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  if (raw == null || raw === "") return 100;
  const limit = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
    throw badRequest("invalid 'limit' value");
  }
  return limit;
}

export function costRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const heartbeat = heartbeatService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const budgetHooks = {
    cancelWorkForScope: heartbeat.cancelBudgetScopeWork,
  };
  const costs = costService(db, budgetHooks);
  const finance = financeService(db);
  const budgets = budgetService(db, budgetHooks);
  const squads = squadService(db);
  const agents = agentService(db);
  const issues = issueService(db);

  async function resolveIssueByRef(rawId: string) {
    const identifier = normalizeIssueIdentifier(rawId);
    if (identifier) {
      return issues.getByIdentifier(identifier);
    }
    return issues.getById(rawId);
  }

  router.post("/squads/:squadId/cost-events", validate(createCostEventSchema), async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);

    if (req.actor.type === "agent" && req.actor.agentId !== req.body.agentId) {
      res.status(403).json({ error: "Agent can only report its own costs" });
      return;
    }

    const event = await costs.createEvent(squadId, {
      ...req.body,
      occurredAt: new Date(req.body.occurredAt),
    });

    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "cost.reported",
      entityType: "cost_event",
      entityId: event.id,
      details: { costCents: event.costCents, model: event.model },
    });

    res.status(201).json(event);
  });

  router.post("/squads/:squadId/finance-events", validate(createFinanceEventSchema), async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    assertOperator(req);

    const event = await finance.createEvent(squadId, {
      ...req.body,
      occurredAt: new Date(req.body.occurredAt),
    });

    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "finance_event.reported",
      entityType: "finance_event",
      entityId: event.id,
      details: {
        amountCents: event.amountCents,
        biller: event.biller,
        eventKind: event.eventKind,
        direction: event.direction,
      },
    });

    res.status(201).json(event);
  });

  router.get("/squads/:squadId/costs/summary", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const range = parseCostDateRange(req.query);
    const summary = await costs.summary(squadId, range);
    res.json(summary);
  });

  router.get("/issues/:id/cost-summary", async (req, res) => {
    const rawId = req.params.id as string;
    const issue = await resolveIssueByRef(rawId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertSquadAccess(req, issue.squadId);
    const excludeRoot = req.query.excludeRoot === "true" || req.query.excludeRoot === "1";
    const summary = await costs.issueTreeSummary(issue.squadId, issue.id, { excludeRoot });
    res.json(summary);
  });

  router.get("/squads/:squadId/costs/by-agent", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const range = parseCostDateRange(req.query);
    const rows = await costs.byAgent(squadId, range);
    res.json(rows);
  });

  router.get("/squads/:squadId/costs/by-agent-model", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const range = parseCostDateRange(req.query);
    const rows = await costs.byAgentModel(squadId, range);
    res.json(rows);
  });

  router.get("/squads/:squadId/costs/by-provider", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const range = parseCostDateRange(req.query);
    const rows = await costs.byProvider(squadId, range);
    res.json(rows);
  });

  router.get("/squads/:squadId/costs/by-biller", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const range = parseCostDateRange(req.query);
    const rows = await costs.byBiller(squadId, range);
    res.json(rows);
  });

  router.get("/squads/:squadId/costs/finance-summary", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const range = parseCostDateRange(req.query);
    const summary = await finance.summary(squadId, range);
    res.json(summary);
  });

  router.get("/squads/:squadId/costs/finance-by-biller", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const range = parseCostDateRange(req.query);
    const rows = await finance.byBiller(squadId, range);
    res.json(rows);
  });

  router.get("/squads/:squadId/costs/finance-by-kind", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const range = parseCostDateRange(req.query);
    const rows = await finance.byKind(squadId, range);
    res.json(rows);
  });

  router.get("/squads/:squadId/costs/finance-events", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const range = parseCostDateRange(req.query);
    const limit = parseCostLimit(req.query);
    const rows = await finance.list(squadId, range, limit);
    res.json(rows);
  });

  router.get("/squads/:squadId/costs/window-spend", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const rows = await costs.windowSpend(squadId);
    res.json(rows);
  });

  router.get("/squads/:squadId/costs/quota-windows", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    assertOperator(req);
    // validate squadId resolves to a real squad so the "__none__" sentinel
    // and any forged ids are rejected before we touch provider credentials
    const squad = await squads.getById(squadId);
    if (!squad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }
    const results = await fetchAllQuotaWindows();
    res.json(results);
  });

  router.get("/squads/:squadId/budgets/overview", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const overview = await budgets.overview(squadId);
    res.json(overview);
  });

  router.post(
    "/squads/:squadId/budgets/policies",
    validate(upsertBudgetPolicySchema),
    async (req, res) => {
      assertOperator(req);
      const squadId = req.params.squadId as string;
      assertSquadAccess(req, squadId);
      const summary = await budgets.upsertPolicy(squadId, req.body, req.actor.userId ?? "operator");
      res.json(summary);
    },
  );

  router.post(
    "/squads/:squadId/budget-incidents/:incidentId/resolve",
    validate(resolveBudgetIncidentSchema),
    async (req, res) => {
      assertOperator(req);
      const squadId = req.params.squadId as string;
      const incidentId = req.params.incidentId as string;
      assertSquadAccess(req, squadId);
      const incident = await budgets.resolveIncident(squadId, incidentId, req.body, req.actor.userId ?? "operator");
      res.json(incident);
    },
  );

  router.get("/squads/:squadId/costs/by-project", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const range = parseCostDateRange(req.query);
    const rows = await costs.byProject(squadId, range);
    res.json(rows);
  });

  router.patch("/squads/:squadId/budgets", validate(updateBudgetSchema), async (req, res) => {
    assertOperator(req);
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const squad = await squads.update(squadId, { budgetMonthlyCents: req.body.budgetMonthlyCents });
    if (!squad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }

    await logActivity(db, {
      squadId,
      actorType: "user",
      actorId: req.actor.userId ?? "operator",
      action: "squad.budget_updated",
      entityType: "squad",
      entityId: squadId,
      details: { budgetMonthlyCents: req.body.budgetMonthlyCents },
    });

    await budgets.upsertPolicy(
      squadId,
      {
        scopeType: "squad",
        scopeId: squadId,
        amount: req.body.budgetMonthlyCents,
        windowKind: "calendar_month_utc",
      },
      req.actor.userId ?? "operator",
    );

    res.json(squad);
  });

  router.patch("/agents/:agentId/budgets", validate(updateBudgetSchema), async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await agents.getById(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    assertSquadAccess(req, agent.squadId);
    assertOperator(req);

    const updated = await agents.update(agentId, { budgetMonthlyCents: req.body.budgetMonthlyCents });
    if (!updated) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId: updated.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "agent.budget_updated",
      entityType: "agent",
      entityId: updated.id,
      details: { budgetMonthlyCents: updated.budgetMonthlyCents },
    });

    await budgets.upsertPolicy(
      updated.squadId,
      {
        scopeType: "agent",
        scopeId: updated.id,
        amount: updated.budgetMonthlyCents,
        windowKind: "calendar_month_utc",
      },
      req.actor.type === "operator" ? req.actor.userId ?? "operator" : null,
    );

    res.json(updated);
  });

  return router;
}
