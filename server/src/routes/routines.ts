import { Router, type Request } from "express";
import type { Db } from "@slaw-ai/db";
import {
  createRoutineSchema,
  createRoutineTriggerSchema,
  rotateRoutineTriggerSecretSchema,
  runRoutineSchema,
  updateRoutineSchema,
  updateRoutineTriggerSchema,
} from "@slaw-ai/shared";
import { validate } from "../middleware/validate.js";
import { accessService, logActivity, routineService } from "../services/index.js";
import { assertSquadAccess, getActorInfo } from "./authz.js";
import { forbidden, unauthorized } from "../errors.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";

export function routineRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const svc = routineService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const access = accessService(db);

  async function assertOperatorCanAssignTasks(req: Request, squadId: string) {
    assertSquadAccess(req, squadId);
    if (req.actor.type !== "operator") return;
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    const allowed = await access.canUser(squadId, req.actor.userId, "tasks:assign");
    if (!allowed) {
      throw forbidden("Missing permission: tasks:assign");
    }
  }

  function assertCanManageSquadRoutine(req: Request, squadId: string, assigneeAgentId?: string | null) {
    assertSquadAccess(req, squadId);
    if (req.actor.type === "operator") return;
    if (req.actor.type !== "agent" || !req.actor.agentId) throw unauthorized();
    if (assigneeAgentId !== req.actor.agentId) {
      throw forbidden("Agents can only manage routines assigned to themselves");
    }
  }

  async function assertCanManageExistingRoutine(req: Request, routineId: string) {
    const routine = await svc.get(routineId);
    if (!routine) return null;
    assertSquadAccess(req, routine.squadId);
    if (req.actor.type === "operator") return routine;
    if (req.actor.type !== "agent" || !req.actor.agentId) throw unauthorized();
    if (routine.assigneeAgentId !== req.actor.agentId) {
      throw forbidden("Agents can only manage routines assigned to themselves");
    }
    return routine;
  }

  async function logRoutineRevisionCreated(req: Request, input: {
    squadId: string;
    routineId: string;
    revisionId: string | null;
    revisionNumber: number;
    changeSummary?: string | null;
    triggerCount?: number | null;
  }) {
    if (!input.revisionId) return;
    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId: input.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "routine.revision_created",
      entityType: "routine",
      entityId: input.routineId,
      details: {
        revisionId: input.revisionId,
        revisionNumber: input.revisionNumber,
        changeSummary: input.changeSummary ?? null,
        triggerCount: input.triggerCount ?? null,
      },
    });
  }

  router.get("/squads/:squadId/routines", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const result = await svc.list(squadId, { projectId });
    res.json(result);
  });

  router.post("/squads/:squadId/routines", validate(createRoutineSchema), async (req, res) => {
    const squadId = req.params.squadId as string;
    await assertOperatorCanAssignTasks(req, squadId);
    assertCanManageSquadRoutine(req, squadId, req.body.assigneeAgentId);
    const created = await svc.create(squadId, req.body, {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "operator" ? req.actor.userId ?? "operator" : null,
      runId: req.actor.runId ?? null,
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "routine.created",
      entityType: "routine",
      entityId: created.id,
      details: { title: created.title, assigneeAgentId: created.assigneeAgentId },
    });
    await logRoutineRevisionCreated(req, {
      squadId,
      routineId: created.id,
      revisionId: created.latestRevisionId,
      revisionNumber: created.latestRevisionNumber,
      changeSummary: "Created routine",
      triggerCount: 0,
    });
    res.status(201).json(created);
  });

  router.get("/routines/:id", async (req, res) => {
    const detail = await svc.getDetail(req.params.id as string);
    if (!detail) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    assertSquadAccess(req, detail.squadId);
    res.json(detail);
  });

  router.get("/routines/:id/revisions", async (req, res) => {
    const routine = await assertCanManageExistingRoutine(req, req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    const revisions = await svc.listRevisions(routine.id);
    res.json(revisions);
  });

  router.patch("/routines/:id", validate(updateRoutineSchema), async (req, res) => {
    const routine = await assertCanManageExistingRoutine(req, req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    const assigneeWillChange =
      req.body.assigneeAgentId !== undefined &&
      req.body.assigneeAgentId !== routine.assigneeAgentId;
    if (assigneeWillChange) {
      await assertOperatorCanAssignTasks(req, routine.squadId);
    }
    const statusWillActivate =
      req.body.status !== undefined &&
      req.body.status === "active" &&
      routine.status !== "active";
    if (statusWillActivate) {
      await assertOperatorCanAssignTasks(req, routine.squadId);
    }
    if (
      req.actor.type === "agent" &&
      req.body.assigneeAgentId !== undefined &&
      req.body.assigneeAgentId !== req.actor.agentId
    ) {
      throw forbidden("Agents can only assign routines to themselves");
    }
    const updated = await svc.update(routine.id, req.body, {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "operator" ? req.actor.userId ?? "operator" : null,
      runId: req.actor.runId ?? null,
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId: routine.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "routine.updated",
      entityType: "routine",
      entityId: routine.id,
      details: { title: updated?.title ?? routine.title },
    });
    if (updated && updated.latestRevisionId !== routine.latestRevisionId) {
      await logRoutineRevisionCreated(req, {
        squadId: routine.squadId,
        routineId: routine.id,
        revisionId: updated.latestRevisionId,
        revisionNumber: updated.latestRevisionNumber,
        changeSummary: "Updated routine",
        triggerCount: null,
      });
    }
    res.json(updated);
  });

  router.post("/routines/:id/revisions/:revisionId/restore", async (req, res) => {
    const routine = await assertCanManageExistingRoutine(req, req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    await assertOperatorCanAssignTasks(req, routine.squadId);
    const result = await svc.restoreRevision(routine.id, req.params.revisionId as string, {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "operator" ? req.actor.userId ?? "operator" : null,
      runId: req.actor.runId ?? null,
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId: routine.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "routine.revision_restored",
      entityType: "routine",
      entityId: routine.id,
      details: {
        revisionId: result.revision.id,
        revisionNumber: result.revision.revisionNumber,
        restoredFromRevisionId: result.restoredFromRevisionId,
        restoredFromRevisionNumber: result.restoredFromRevisionNumber,
        triggerCount: result.revision.snapshot.triggers.length,
      },
    });
    res.json(result);
  });

  router.get("/routines/:id/runs", async (req, res) => {
    const routine = await svc.get(req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    assertSquadAccess(req, routine.squadId);
    const limit = Number(req.query.limit ?? 50);
    const result = await svc.listRuns(routine.id, Number.isFinite(limit) ? limit : 50);
    res.json(result);
  });

  router.post("/routines/:id/triggers", validate(createRoutineTriggerSchema), async (req, res) => {
    const routine = await assertCanManageExistingRoutine(req, req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    await assertOperatorCanAssignTasks(req, routine.squadId);
    const created = await svc.createTrigger(routine.id, req.body, {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "operator" ? req.actor.userId ?? "operator" : null,
      runId: req.actor.runId ?? null,
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId: routine.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "routine.trigger_created",
      entityType: "routine_trigger",
      entityId: created.trigger.id,
      details: { routineId: routine.id, kind: created.trigger.kind },
    });
    await logRoutineRevisionCreated(req, {
      squadId: routine.squadId,
      routineId: routine.id,
      revisionId: created.revision.id,
      revisionNumber: created.revision.revisionNumber,
      changeSummary: created.revision.changeSummary,
      triggerCount: created.revision.snapshot.triggers.length,
    });
    res.status(201).json(created);
  });

  router.patch("/routine-triggers/:id", validate(updateRoutineTriggerSchema), async (req, res) => {
    const trigger = await svc.getTrigger(req.params.id as string);
    if (!trigger) {
      res.status(404).json({ error: "Routine trigger not found" });
      return;
    }
    const routine = await assertCanManageExistingRoutine(req, trigger.routineId);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    await assertOperatorCanAssignTasks(req, routine.squadId);
    const updated = await svc.updateTrigger(trigger.id, req.body, {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "operator" ? req.actor.userId ?? "operator" : null,
      runId: req.actor.runId ?? null,
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId: routine.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "routine.trigger_updated",
      entityType: "routine_trigger",
      entityId: trigger.id,
      details: { routineId: routine.id, kind: updated?.trigger.kind ?? trigger.kind },
    });
    if (updated) {
      await logRoutineRevisionCreated(req, {
        squadId: routine.squadId,
        routineId: routine.id,
        revisionId: updated.revision.id,
        revisionNumber: updated.revision.revisionNumber,
        changeSummary: updated.revision.changeSummary,
        triggerCount: updated.revision.snapshot.triggers.length,
      });
    }
    res.json(updated?.trigger ?? null);
  });

  router.delete("/routine-triggers/:id", async (req, res) => {
    const trigger = await svc.getTrigger(req.params.id as string);
    if (!trigger) {
      res.status(404).json({ error: "Routine trigger not found" });
      return;
    }
    const routine = await assertCanManageExistingRoutine(req, trigger.routineId);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    const deleted = await svc.deleteTrigger(trigger.id, {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "operator" ? req.actor.userId ?? "operator" : null,
      runId: req.actor.runId ?? null,
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId: routine.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "routine.trigger_deleted",
      entityType: "routine_trigger",
      entityId: trigger.id,
      details: { routineId: routine.id, kind: trigger.kind },
    });
    if (deleted.revision) {
      await logRoutineRevisionCreated(req, {
        squadId: routine.squadId,
        routineId: routine.id,
        revisionId: deleted.revision.id,
        revisionNumber: deleted.revision.revisionNumber,
        changeSummary: deleted.revision.changeSummary,
        triggerCount: deleted.revision.snapshot.triggers.length,
      });
    }
    res.status(204).end();
  });

  router.post(
    "/routine-triggers/:id/rotate-secret",
    validate(rotateRoutineTriggerSecretSchema),
    async (req, res) => {
      const trigger = await svc.getTrigger(req.params.id as string);
      if (!trigger) {
        res.status(404).json({ error: "Routine trigger not found" });
        return;
      }
      const routine = await assertCanManageExistingRoutine(req, trigger.routineId);
      if (!routine) {
        res.status(404).json({ error: "Routine not found" });
        return;
      }
      const rotated = await svc.rotateTriggerSecret(trigger.id, {
        agentId: req.actor.type === "agent" ? req.actor.agentId : null,
        userId: req.actor.type === "operator" ? req.actor.userId ?? "operator" : null,
        runId: req.actor.runId ?? null,
      });
      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId: routine.squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "routine.trigger_secret_rotated",
        entityType: "routine_trigger",
        entityId: trigger.id,
        details: { routineId: routine.id },
      });
      await logRoutineRevisionCreated(req, {
        squadId: routine.squadId,
        routineId: routine.id,
        revisionId: rotated.revision.id,
        revisionNumber: rotated.revision.revisionNumber,
        changeSummary: rotated.revision.changeSummary,
        triggerCount: rotated.revision.snapshot.triggers.length,
      });
      res.json(rotated);
    },
  );

  router.post("/routines/:id/run", validate(runRoutineSchema), async (req, res) => {
    const routine = await assertCanManageExistingRoutine(req, req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    await assertOperatorCanAssignTasks(req, routine.squadId);
    const run = await svc.runRoutine(routine.id, req.body, {
      agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      userId: req.actor.type === "operator" ? req.actor.userId ?? null : null,
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId: routine.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "routine.run_triggered",
      entityType: "routine_run",
      entityId: run.id,
      details: { routineId: routine.id, source: run.source, status: run.status },
    });
    res.status(202).json(run);
  });

  router.post("/routine-triggers/public/:publicId/fire", async (req, res) => {
    const result = await svc.firePublicTrigger(req.params.publicId as string, {
      authorizationHeader: req.header("authorization"),
      signatureHeader: req.header("x-slaw-signature"),
      hubSignatureHeader: req.header("x-hub-signature-256"),
      timestampHeader: req.header("x-slaw-timestamp"),
      idempotencyKey: req.header("idempotency-key"),
      rawBody: (req as { rawBody?: Buffer }).rawBody ?? null,
      payload: typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : null,
    });
    res.status(202).json(result);
  });

  return router;
}
