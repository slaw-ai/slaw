import { Router, type Request } from "express";
import type { Db } from "@slaw/db";
import {
  catalogSkillListQuerySchema,
  squadSkillCreateSchema,
  squadSkillFileUpdateSchema,
  squadSkillImportSchema,
  squadSkillInstallCatalogSchema,
  squadSkillInstallUpdateSchema,
  squadSkillProjectScanRequestSchema,
  squadSkillResetSchema,
} from "@slaw/shared";
import { trackSkillImported } from "@slaw/shared/telemetry";
import { validate } from "../middleware/validate.js";
import { accessService, agentService, squadSkillService, logActivity } from "../services/index.js";
import { getCatalogSkillOrThrow, listCatalogSkills, readCatalogSkillFile } from "../services/skills-catalog.js";
import { isTowerGoverned } from "../services/botfather/authoring-lock.js";
import { conflict, forbidden } from "../errors.js";
import { assertAuthenticated, assertSquadAccess, getActorInfo } from "./authz.js";
import { getTelemetryClient } from "../telemetry.js";

type SkillTelemetryInput = {
  key: string;
  slug: string;
  sourceType: string;
  sourceLocator: string | null;
  metadata: Record<string, unknown> | null;
};

export function squadSkillRoutes(db: Db) {
  const router = Router();
  const agents = agentService(db);
  const access = accessService(db);
  const svc = squadSkillService(db);

  function canCreateAgents(agent: { permissions: Record<string, unknown> | null | undefined }) {
    if (!agent.permissions || typeof agent.permissions !== "object") return false;
    return Boolean((agent.permissions as Record<string, unknown>).canCreateAgents);
  }

  function asString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function deriveTrackedSkillRef(skill: SkillTelemetryInput): string | null {
    if (skill.sourceType === "skills_sh") {
      return skill.key;
    }
    if (skill.sourceType !== "github") {
      return null;
    }
    const hostname = asString(skill.metadata?.hostname);
    if (hostname !== "github.com") {
      return null;
    }
    return skill.key;
  }

  function firstQueryString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return undefined;
  }

  /**
   * Tower-only authoring lock. When this instance is connected to a control
   * tower AND enrolled (active credentials present), skills are mastered
   * centrally — local skill creation/import is disabled. Catalog install + the
   * automatic refresh of already-installed tower skills stay allowed. Standalone
   * (un-enrolled) instances are unaffected. See DESIGN-skill-registry.md §8.1.
   */
  function assertLocalAuthoringAllowed() {
    if (isTowerGoverned()) {
      throw conflict(
        "Skills are managed by your control tower. Add skills from the catalog instead of authoring them locally.",
        { code: "skills_managed_by_tower" },
      );
    }
  }

  async function assertCanMutateSquadSkills(req: Request, squadId: string) {
    assertSquadAccess(req, squadId);

    if (req.actor.type === "operator") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      const allowed = await access.canUser(squadId, req.actor.userId, "agents:create");
      if (!allowed) {
        throw forbidden("Missing permission: agents:create");
      }
      return;
    }

    if (!req.actor.agentId) {
      throw forbidden("Agent authentication required");
    }

    const actorAgent = await agents.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.squadId !== squadId) {
      throw forbidden("Agent key cannot access another squad");
    }

    const allowedByGrant = await access.hasPermission(squadId, "agent", actorAgent.id, "agents:create");
    if (allowedByGrant || canCreateAgents(actorAgent)) {
      return;
    }

    throw forbidden("Missing permission: can create agents");
  }

  router.get("/skills/catalog", async (req, res) => {
    assertAuthenticated(req);
    const query = catalogSkillListQuerySchema.parse({
      kind: firstQueryString(req.query.kind),
      category: firstQueryString(req.query.category),
      q: firstQueryString(req.query.q),
    });
    res.json(listCatalogSkills(query));
  });

  router.get("/skills/catalog/:catalogId/files", async (req, res) => {
    assertAuthenticated(req);
    const catalogRef = firstQueryString(req.query.ref) ?? (req.params.catalogId as string);
    const relativePath = firstQueryString(req.query.path) ?? "SKILL.md";
    res.json(await readCatalogSkillFile(catalogRef, relativePath));
  });

  router.get("/skills/catalog/:catalogId", async (req, res) => {
    assertAuthenticated(req);
    const catalogRef = firstQueryString(req.query.ref) ?? (req.params.catalogId as string);
    res.json(getCatalogSkillOrThrow(catalogRef));
  });

  router.get("/squads/:squadId/skills", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const result = await svc.list(squadId);
    res.json(result);
  });

  router.get("/squads/:squadId/skills/:skillId", async (req, res) => {
    const squadId = req.params.squadId as string;
    const skillId = req.params.skillId as string;
    assertSquadAccess(req, squadId);
    const result = await svc.detail(squadId, skillId);
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(result);
  });

  router.get("/squads/:squadId/skills/:skillId/update-status", async (req, res) => {
    const squadId = req.params.squadId as string;
    const skillId = req.params.skillId as string;
    assertSquadAccess(req, squadId);
    const result = await svc.updateStatus(squadId, skillId);
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(result);
  });

  router.get("/squads/:squadId/skills/:skillId/files", async (req, res) => {
    const squadId = req.params.squadId as string;
    const skillId = req.params.skillId as string;
    const relativePath = String(req.query.path ?? "SKILL.md");
    assertSquadAccess(req, squadId);
    const result = await svc.readFile(squadId, skillId, relativePath);
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(result);
  });

  router.post(
    "/squads/:squadId/skills",
    validate(squadSkillCreateSchema),
    async (req, res) => {
      const squadId = req.params.squadId as string;
      await assertCanMutateSquadSkills(req, squadId);
      assertLocalAuthoringAllowed();
      const result = await svc.createLocalSkill(squadId, req.body);

      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "squad.skill_created",
        entityType: "squad_skill",
        entityId: result.id,
        details: {
          slug: result.slug,
          name: result.name,
        },
      });

      res.status(201).json(result);
    },
  );

  router.patch(
    "/squads/:squadId/skills/:skillId/files",
    validate(squadSkillFileUpdateSchema),
    async (req, res) => {
      const squadId = req.params.squadId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSquadSkills(req, squadId);
      assertLocalAuthoringAllowed();
      const result = await svc.updateFile(
        squadId,
        skillId,
        String(req.body.path ?? ""),
        String(req.body.content ?? ""),
      );

      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "squad.skill_file_updated",
        entityType: "squad_skill",
        entityId: skillId,
        details: {
          path: result.path,
          markdown: result.markdown,
        },
      });

      res.json(result);
    },
  );

  router.post(
    "/squads/:squadId/skills/import",
    validate(squadSkillImportSchema),
    async (req, res) => {
      const squadId = req.params.squadId as string;
      await assertCanMutateSquadSkills(req, squadId);
      assertLocalAuthoringAllowed();
      const source = String(req.body.source ?? "");
      const result = await svc.importFromSource(squadId, source);

      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "squad.skills_imported",
        entityType: "squad",
        entityId: squadId,
        details: {
          source,
          importedCount: result.imported.length,
          importedSlugs: result.imported.map((skill) => skill.slug),
          warningCount: result.warnings.length,
        },
      });
      const telemetryClient = getTelemetryClient();
      if (telemetryClient) {
        for (const skill of result.imported) {
          trackSkillImported(telemetryClient, {
            sourceType: skill.sourceType,
            skillRef: deriveTrackedSkillRef(skill),
          });
        }
      }

      res.status(201).json(result);
    },
  );

  router.post(
    "/squads/:squadId/skills/install-catalog",
    validate(squadSkillInstallCatalogSchema),
    async (req, res) => {
      const squadId = req.params.squadId as string;
      await assertCanMutateSquadSkills(req, squadId);
      const result = await svc.installFromCatalog(squadId, req.body);

      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: result.action === "created" ? "squad.skill_catalog_installed" : "squad.skill_catalog_updated",
        entityType: "squad_skill",
        entityId: result.skill.id,
        details: {
          action: result.action,
          catalogId: result.catalogSkill.id,
          catalogKey: result.catalogSkill.key,
          slug: result.skill.slug,
          originHash: result.catalogSkill.contentHash,
          warningCount: result.warnings.length,
        },
      });

      res.status(result.action === "created" ? 201 : 200).json(result);
    },
  );

  router.post(
    "/squads/:squadId/skills/scan-projects",
    validate(squadSkillProjectScanRequestSchema),
    async (req, res) => {
      const squadId = req.params.squadId as string;
      await assertCanMutateSquadSkills(req, squadId);
      const result = await svc.scanProjectWorkspaces(squadId, req.body);

      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "squad.skills_scanned",
        entityType: "squad",
        entityId: squadId,
        details: {
          scannedProjects: result.scannedProjects,
          scannedWorkspaces: result.scannedWorkspaces,
          discovered: result.discovered,
          importedCount: result.imported.length,
          updatedCount: result.updated.length,
          conflictCount: result.conflicts.length,
          warningCount: result.warnings.length,
        },
      });

      res.json(result);
    },
  );

  router.delete("/squads/:squadId/skills/:skillId", async (req, res) => {
    const squadId = req.params.squadId as string;
    const skillId = req.params.skillId as string;
    await assertCanMutateSquadSkills(req, squadId);
    const result = await svc.deleteSkill(squadId, skillId);
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "squad.skill_deleted",
      entityType: "squad_skill",
      entityId: result.id,
      details: {
        slug: result.slug,
        name: result.name,
      },
    });

    res.json(result);
  });

  router.post(
    "/squads/:squadId/skills/:skillId/audit",
    async (req, res) => {
      const squadId = req.params.squadId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSquadSkills(req, squadId);
      const result = await svc.auditSkill(squadId, skillId);
      if (!result) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "squad.skill_audited",
        entityType: "squad_skill",
        entityId: skillId,
        details: {
          verdict: result.verdict,
          codes: result.codes,
          installedHash: result.installedHash,
          originHash: result.originHash,
          scanVersion: result.scanVersion,
        },
      });

      res.json(result);
    },
  );

  router.post(
    "/squads/:squadId/skills/:skillId/install-update",
    validate(squadSkillInstallUpdateSchema),
    async (req, res) => {
      const squadId = req.params.squadId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSquadSkills(req, squadId);
      const before = await svc.getById(squadId, skillId);
      const result = await svc.installUpdate(squadId, skillId, req.body);
      if (!result) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "squad.skill_update_installed",
        entityType: "squad_skill",
        entityId: result.id,
        details: {
          slug: result.slug,
          previousOriginHash: before?.metadata?.originHash ?? before?.sourceRef ?? null,
          previousOriginVersion: before?.metadata?.originVersion ?? null,
          newOriginHash: result.metadata?.originHash ?? result.sourceRef,
          newOriginVersion: result.metadata?.originVersion ?? null,
          driftDetected: Boolean(before?.metadata?.userModifiedAt),
          force: Boolean(req.body.force),
          auditVerdict: result.metadata?.auditVerdict ?? null,
        },
      });

      res.json(result);
    },
  );

  router.post(
    "/squads/:squadId/skills/:skillId/reset",
    validate(squadSkillResetSchema),
    async (req, res) => {
      const squadId = req.params.squadId as string;
      const skillId = req.params.skillId as string;
      await assertCanMutateSquadSkills(req, squadId);
      const before = await svc.getById(squadId, skillId);
      const result = await svc.resetSkill(squadId, skillId, req.body);
      if (!result) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "squad.skill_reset",
        entityType: "squad_skill",
        entityId: result.id,
        details: {
          slug: result.slug,
          previousOriginHash: before?.metadata?.originHash ?? before?.sourceRef ?? null,
          previousOriginVersion: before?.metadata?.originVersion ?? null,
          newOriginHash: result.metadata?.originHash ?? result.sourceRef,
          newOriginVersion: result.metadata?.originVersion ?? null,
          driftDetected: Boolean(before?.metadata?.userModifiedAt),
          force: Boolean(req.body.force),
          auditVerdict: result.metadata?.auditVerdict ?? null,
        },
      });

      res.json(result);
    },
  );

  return router;
}
