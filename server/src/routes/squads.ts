import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { Db } from "@slaw/db";
import {
  DEFAULT_FEEDBACK_DATA_SHARING_TERMS_VERSION,
  squadPortabilityExportSchema,
  squadPortabilityImportSchema,
  squadPortabilityPreviewSchema,
  createSquadSchema,
  feedbackTargetTypeSchema,
  feedbackTraceStatusSchema,
  feedbackVoteValueSchema,
  updateSquadBrandingSchema,
  updateSquadSchema,
} from "@slaw/shared";
import { badRequest, forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  agentService,
  budgetService,
  squadPortabilityService,
  squadService,
  feedbackService,
  logActivity,
} from "../services/index.js";
import type { StorageService } from "../storage/types.js";
import { assertBoard, assertSquadAccess, assertInstanceAdmin, getActorInfo } from "./authz.js";
import { SQUAD_IMPORT_ROUTE_PATH } from "./squad-import-paths.js";

export function squadRoutes(db: Db, storage?: StorageService) {
  const router = Router();
  const svc = squadService(db);
  const agents = agentService(db);
  const portability = squadPortabilityService(db, storage);
  const access = accessService(db);
  const budgets = budgetService(db);
  const feedback = feedbackService(db);
  const importJobs = new Map<string, ImportJobRecord>();
  const importJobTerminalRetentionMs = 5 * 60 * 1000;

  function parseBooleanQuery(value: unknown) {
    return value === true || value === "true" || value === "1";
  }

  function parseDateQuery(value: unknown, field: string) {
    if (typeof value !== "string" || value.trim().length === 0) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw badRequest(`Invalid ${field} query value`);
    }
    return parsed;
  }

  function assertImportTargetAccess(
    req: Request,
    target: { mode: "new_squad" } | { mode: "existing_squad"; squadId: string },
  ) {
    if (target.mode === "new_squad") {
      assertInstanceAdmin(req);
      return;
    }
    assertSquadAccess(req, target.squadId);
  }

  async function assertCanUpdateBranding(req: Request, squadId: string) {
    assertSquadAccess(req, squadId);
    if (req.actor.type === "board") return;
    if (!req.actor.agentId) throw forbidden("Agent authentication required");

    const actorAgent = await agents.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.squadId !== squadId) {
      throw forbidden("Agent key cannot access another squad");
    }
    if (actorAgent.role !== "squad_lead") {
      throw forbidden("Only Squad Lead agents can update squad branding");
    }
  }

  async function assertCanManagePortability(req: Request, squadId: string, capability: "imports" | "exports") {
    assertSquadAccess(req, squadId);
    if (req.actor.type === "board") return;
    if (!req.actor.agentId) throw forbidden("Agent authentication required");

    const actorAgent = await agents.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.squadId !== squadId) {
      throw forbidden("Agent key cannot access another squad");
    }
    if (actorAgent.role !== "squad_lead") {
      throw forbidden(`Only Squad Lead agents can manage squad ${capability}`);
    }
  }

  router.get("/", async (req, res) => {
    assertBoard(req);
    const result = await svc.list();
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      res.json(result);
      return;
    }
    const allowed = new Set(req.actor.squadIds ?? []);
    res.json(result.filter((squad) => allowed.has(squad.id)));
  });

  router.get("/stats", async (req, res) => {
    assertBoard(req);
    const allowed = req.actor.source === "local_implicit" || req.actor.isInstanceAdmin
      ? null
      : new Set(req.actor.squadIds ?? []);
    const stats = await svc.stats();
    if (!allowed) {
      res.json(stats);
      return;
    }
    const filtered = Object.fromEntries(Object.entries(stats).filter(([squadId]) => allowed.has(squadId)));
    res.json(filtered);
  });

  // Common malformed path when squadId is empty in "/api/squads/{squadId}/issues".
  router.get("/issues", (_req, res) => {
    res.status(400).json({
      error: "Missing squadId in path. Use /api/squads/{squadId}/issues.",
    });
  });

  router.get("/:squadId", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    // Allow agents (Squad Lead) to read their own squad; board always allowed
    if (req.actor.type !== "agent") {
      assertBoard(req);
    }
    const squad = await svc.getById(squadId);
    if (!squad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }
    res.json(squad);
  });

  router.get("/:squadId/feedback-traces", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    assertBoard(req);

    const targetTypeRaw = typeof req.query.targetType === "string" ? req.query.targetType : undefined;
    const voteRaw = typeof req.query.vote === "string" ? req.query.vote : undefined;
    const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
    const issueId = typeof req.query.issueId === "string" && req.query.issueId.trim().length > 0 ? req.query.issueId : undefined;
    const projectId = typeof req.query.projectId === "string" && req.query.projectId.trim().length > 0
      ? req.query.projectId
      : undefined;

    const traces = await feedback.listFeedbackTraces({
      squadId,
      issueId,
      projectId,
      targetType: targetTypeRaw ? feedbackTargetTypeSchema.parse(targetTypeRaw) : undefined,
      vote: voteRaw ? feedbackVoteValueSchema.parse(voteRaw) : undefined,
      status: statusRaw ? feedbackTraceStatusSchema.parse(statusRaw) : undefined,
      from: parseDateQuery(req.query.from, "from"),
      to: parseDateQuery(req.query.to, "to"),
      sharedOnly: parseBooleanQuery(req.query.sharedOnly),
      includePayload: parseBooleanQuery(req.query.includePayload),
    });
    res.json(traces);
  });

  router.post("/:squadId/export", validate(squadPortabilityExportSchema), async (req, res) => {
    const squadId = req.params.squadId as string;
    await assertCanManagePortability(req, squadId, "exports");
    const result = await portability.exportBundle(squadId, req.body);
    res.json(result);
  });

  router.post("/import/preview", validate(squadPortabilityPreviewSchema), async (req, res) => {
    assertBoard(req);
    assertImportTargetAccess(req, req.body.target);
    const preview = await portability.previewImport(req.body);
    res.json(preview);
  });

  router.get("/import/jobs/:jobId", async (req, res) => {
    assertCloudTenantCaller(req);
    cleanupTerminalImportJobs(importJobs, importJobTerminalRetentionMs);
    const job = importJobs.get(req.params.jobId as string);
    if (!job || job.cloudTenantKey !== cloudTenantRequestKey(req)) {
      res.status(404).json({ error: "Import job not found" });
      return;
    }
    res.json(importJobResponse(job));
  });

  router.post(SQUAD_IMPORT_ROUTE_PATH, async (req, res) => {
    assertBoard(req);
    const rawImportBody: unknown = req.body;
    const actor = getActorInfo(req);
    const boardUserId = req.actor.type === "board" ? req.actor.userId : null;
    if (req.header("x-slaw-cloud-async-import") === "1") {
      assertCloudTenantCaller(req);
      cleanupTerminalImportJobs(importJobs, importJobTerminalRetentionMs);
      const job = createImportJob(cloudTenantRequestKey(req));
      importJobs.set(job.id, job);
      const operation = async () => {
        const importBody = squadPortabilityImportSchema.parse(rawImportBody);
        assertImportTargetAccess(req, importBody.target);
        const activity = importedSquadActivityContext(actor, importBody.include ?? null);
        const result = await portability.importBundle(importBody, boardUserId);
        await logImportedSquadActivity(db, activity, result);
        return result;
      };
      res.status(202).json(importJobAcceptedResponse(job));
      setImmediate(() => {
        void runImportJob(job, operation);
      });
      return;
    }

    const importBody = squadPortabilityImportSchema.parse(rawImportBody);
    assertImportTargetAccess(req, importBody.target);
    const activity = importedSquadActivityContext(actor, importBody.include ?? null);
    const result = await portability.importBundle(importBody, boardUserId);
    await logImportedSquadActivity(db, activity, result);
    res.json(result);
  });

  router.post("/:squadId/exports/preview", validate(squadPortabilityExportSchema), async (req, res) => {
    const squadId = req.params.squadId as string;
    await assertCanManagePortability(req, squadId, "exports");
    const preview = await portability.previewExport(squadId, req.body);
    res.json(preview);
  });

  router.post("/:squadId/exports", validate(squadPortabilityExportSchema), async (req, res) => {
    const squadId = req.params.squadId as string;
    await assertCanManagePortability(req, squadId, "exports");
    const result = await portability.exportBundle(squadId, req.body);
    res.json(result);
  });

  router.post("/:squadId/imports/preview", validate(squadPortabilityPreviewSchema), async (req, res) => {
    const squadId = req.params.squadId as string;
    await assertCanManagePortability(req, squadId, "imports");
    if (req.body.target.mode === "existing_squad" && req.body.target.squadId !== squadId) {
      throw forbidden("Safe import route can only target the route squad");
    }
    if (req.body.collisionStrategy === "replace") {
      throw forbidden("Safe import route does not allow replace collision strategy");
    }
    const preview = await portability.previewImport(req.body, {
      mode: "agent_safe",
      sourceSquadId: squadId,
    });
    res.json(preview);
  });

  router.post("/:squadId/imports/apply", validate(squadPortabilityImportSchema), async (req, res) => {
    const squadId = req.params.squadId as string;
    await assertCanManagePortability(req, squadId, "imports");
    if (req.body.target.mode === "existing_squad" && req.body.target.squadId !== squadId) {
      throw forbidden("Safe import route can only target the route squad");
    }
    if (req.body.collisionStrategy === "replace") {
      throw forbidden("Safe import route does not allow replace collision strategy");
    }
    const actor = getActorInfo(req);
    const result = await portability.importBundle(req.body, req.actor.type === "board" ? req.actor.userId : null, {
      mode: "agent_safe",
      sourceSquadId: squadId,
    });
    await logActivity(db, {
      squadId: result.squad.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      entityType: "squad",
      entityId: result.squad.id,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "squad.imported",
      details: {
        include: req.body.include ?? null,
        agentCount: result.agents.length,
        warningCount: result.warnings.length,
        squadAction: result.squad.action,
        importMode: "agent_safe",
      },
    });
    res.json(result);
  });

  router.post("/", validate(createSquadSchema), async (req, res) => {
    assertBoard(req);
    if (!(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)) {
      throw forbidden("Instance admin required");
    }
    const squad = await svc.create(req.body);
    const ownerPrincipalId = req.actor.userId ?? "local-board";
    await access.ensureMembership(squad.id, "user", ownerPrincipalId, "owner", "active");
    await access.ensureRoleDefaultGrants(
      squad.id,
      ownerPrincipalId,
      "owner",
      req.actor.userId ?? null,
    );
    await logActivity(db, {
      squadId: squad.id,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "squad.created",
      entityType: "squad",
      entityId: squad.id,
      details: { name: squad.name },
    });
    if (squad.budgetMonthlyCents > 0) {
      await budgets.upsertPolicy(
        squad.id,
        {
          scopeType: "squad",
          scopeId: squad.id,
          amount: squad.budgetMonthlyCents,
          windowKind: "calendar_month_utc",
        },
        req.actor.userId ?? "board",
      );
    }
    res.status(201).json(squad);
  });

  router.patch("/:squadId", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);

    const actor = getActorInfo(req);
    const existingSquad = await svc.getById(squadId);
    if (!existingSquad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }
    let body: Record<string, unknown>;

    if (req.actor.type === "agent") {
      // Only Squad Lead agents may update squad branding fields
      const agentSvc = agentService(db);
      const actorAgent = req.actor.agentId ? await agentSvc.getById(req.actor.agentId) : null;
      if (!actorAgent || actorAgent.role !== "squad_lead") {
        throw forbidden("Only Squad Lead agents or board users may update squad settings");
      }
      if (actorAgent.squadId !== squadId) {
        throw forbidden("Agent key cannot access another squad");
      }
      body = updateSquadBrandingSchema.parse(req.body);
    } else {
      assertBoard(req);
      body = updateSquadSchema.parse(req.body);

      if (body.feedbackDataSharingEnabled === true && !existingSquad.feedbackDataSharingEnabled) {
        body = {
          ...body,
          feedbackDataSharingConsentAt: new Date(),
          feedbackDataSharingConsentByUserId: req.actor.userId ?? "local-board",
          feedbackDataSharingTermsVersion:
            typeof body.feedbackDataSharingTermsVersion === "string" && body.feedbackDataSharingTermsVersion.length > 0
              ? body.feedbackDataSharingTermsVersion
              : DEFAULT_FEEDBACK_DATA_SHARING_TERMS_VERSION,
        };
      }
    }

    const squad = await svc.update(squadId, body);
    if (!squad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }
    await logActivity(db, {
      squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "squad.updated",
      entityType: "squad",
      entityId: squadId,
      details: body,
    });
    res.json(squad);
  });

  router.patch("/:squadId/branding", validate(updateSquadBrandingSchema), async (req, res) => {
    const squadId = req.params.squadId as string;
    await assertCanUpdateBranding(req, squadId);
    const squad = await svc.update(squadId, req.body);
    if (!squad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "squad.branding_updated",
      entityType: "squad",
      entityId: squadId,
      details: req.body,
    });
    res.json(squad);
  });

  router.post("/:squadId/archive", async (req, res) => {
    assertBoard(req);
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const squad = await svc.archive(squadId);
    if (!squad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }
    await logActivity(db, {
      squadId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "squad.archived",
      entityType: "squad",
      entityId: squadId,
    });
    res.json(squad);
  });

  router.delete("/:squadId", async (req, res) => {
    assertBoard(req);
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const squad = await svc.remove(squadId);
    if (!squad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}

type SquadImportResult = {
  squad: { id: string; action: unknown };
  agents: unknown[];
  warnings: unknown[];
};

interface ImportJobRecord {
  id: string;
  cloudTenantKey: string;
  status: "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: { message: string };
  result?: {
    squadId: string;
    agentCount: number;
    warningCount: number;
    squadAction: unknown;
  };
}

interface ImportedSquadActivityContext {
  actorType: "user" | "agent";
  actorId: string;
  agentId: string | null;
  runId: string | null;
  include: unknown;
}

function assertCloudTenantCaller(req: Request) {
  if (req.actor.source !== "cloud_tenant") {
    throw forbidden("Trusted Cloud tenant access required");
  }
}

function cloudTenantRequestKey(req: Request) {
  return [
    req.actor.userId ?? "",
    req.header("x-slaw-cloud-stack-id")?.trim() ?? "",
    req.header("x-slaw-cloud-slaw-squad-id")?.trim() ?? "",
  ].join(":");
}

function createImportJob(cloudTenantKey: string): ImportJobRecord {
  const now = new Date().toISOString();
  return {
    id: `tenant-import-${randomUUID()}`,
    cloudTenantKey,
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
}

async function runImportJob(
  job: ImportJobRecord,
  operation: () => Promise<SquadImportResult>,
) {
  try {
    const result = await operation();
    const now = new Date().toISOString();
    job.status = "succeeded";
    job.updatedAt = now;
    job.completedAt = now;
    job.result = {
      squadId: result.squad.id,
      agentCount: result.agents.length,
      warningCount: result.warnings.length,
      squadAction: result.squad.action,
    };
  } catch (error) {
    const now = new Date().toISOString();
    job.status = "failed";
    job.updatedAt = now;
    job.completedAt = now;
    job.error = { message: errorMessage(error) };
  }
}

function importedSquadActivityContext(
  actor: ReturnType<typeof getActorInfo>,
  include: unknown,
): ImportedSquadActivityContext {
  return {
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId,
    runId: actor.runId,
    include,
  };
}

async function logImportedSquadActivity(
  db: Db,
  activity: ImportedSquadActivityContext,
  result: SquadImportResult,
) {
  await logActivity(db, {
    squadId: result.squad.id,
    actorType: activity.actorType,
    actorId: activity.actorId,
    action: "squad.imported",
    entityType: "squad",
    entityId: result.squad.id,
    agentId: activity.agentId,
    runId: activity.runId,
    details: {
      include: activity.include,
      agentCount: result.agents.length,
      warningCount: result.warnings.length,
      squadAction: result.squad.action,
    },
  });
}

function importJobAcceptedResponse(job: ImportJobRecord) {
  return {
    job: {
      id: job.id,
      status: job.status,
    },
    statusUrl: `/api/squads/import/jobs/${encodeURIComponent(job.id)}`,
    retryAfterMs: 1000,
  };
}

function importJobResponse(job: ImportJobRecord) {
  const isTerminal = job.status === "succeeded" || job.status === "failed";
  const response: Record<string, unknown> = {
    job: {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.completedAt ? { completedAt: job.completedAt } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.result ? { result: job.result } : {}),
    },
    ...(isTerminal ? {} : { retryAfterMs: 1000 }),
  };
  if (job.error?.message) {
    response.error = job.error.message;
    response.message = job.error.message;
    response.reason = job.error.message;
  }
  return response;
}

function cleanupTerminalImportJobs(importJobs: Map<string, ImportJobRecord>, terminalRetentionMs: number) {
  const now = Date.now();
  for (const [jobId, job] of importJobs) {
    if (job.status === "running" || !job.completedAt) continue;
    if (now - Date.parse(job.completedAt) > terminalRetentionMs) {
      importJobs.delete(jobId);
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message : String(error);
}
