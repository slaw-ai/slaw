import { Router, type Request } from "express";
import type { Db } from "@slaw-ai/db";
import {
  AGENT_ADAPTER_TYPES,
  createEnvironmentSchema,
  getEnvironmentCapabilities,
  probeEnvironmentConfigSchema,
  updateEnvironmentSchema,
} from "@slaw-ai/shared";
import { conflict, forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  agentService,
  issueService,
  logActivity,
  projectService,
} from "../services/index.js";
import {
  collectEnvironmentSecretRefs,
  normalizeEnvironmentConfigForPersistence,
  normalizeEnvironmentConfigForProbe,
  parseEnvironmentDriverConfig,
  readSshEnvironmentPrivateKeySecretId,
  type ParsedEnvironmentConfig,
} from "../services/environment-config.js";
import { probeEnvironment } from "../services/environment-probe.js";
import { secretService } from "../services/secrets.js";
import { listReadyPluginEnvironmentDrivers } from "../services/plugin-environment-driver.js";
import { getConfiguredSecretProvider } from "../secrets/configured-provider.js";
import { assertSquadAccess, getActorInfo } from "./authz.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";
import { environmentService } from "../services/environments.js";
import { executionWorkspaceService } from "../services/execution-workspaces.js";

export function environmentRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const agents = agentService(db);
  const access = accessService(db);
  const svc = environmentService(db);
  const executionWorkspaces = executionWorkspaceService(db);
  const issues = issueService(db);
  const projects = projectService(db);
  const secrets = secretService(db);

  function parseObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  function canCreateAgents(agent: { permissions: Record<string, unknown> | null | undefined }) {
    if (!agent.permissions || typeof agent.permissions !== "object") return false;
    return Boolean((agent.permissions as Record<string, unknown>).canCreateAgents);
  }

  async function assertCanMutateEnvironments(req: Request, squadId: string) {
    assertSquadAccess(req, squadId);

    if (req.actor.type === "operator") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      const allowed = await access.canUser(squadId, req.actor.userId, "environments:manage");
      if (!allowed) {
        throw forbidden("Missing permission: environments:manage");
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

    const allowedByGrant = await access.hasPermission(squadId, "agent", actorAgent.id, "environments:manage");
    if (allowedByGrant || canCreateAgents(actorAgent)) {
      return;
    }

    throw forbidden("Missing permission: environments:manage");
  }

  async function actorCanReadEnvironmentConfigurations(req: Request, squadId: string) {
    assertSquadAccess(req, squadId);

    if (req.actor.type === "operator") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return true;
      return access.canUser(squadId, req.actor.userId, "environments:manage");
    }

    if (!req.actor.agentId) return false;
    const actorAgent = await agents.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.squadId !== squadId) return false;
    const allowedByGrant = await access.hasPermission(squadId, "agent", actorAgent.id, "environments:manage");
    return allowedByGrant || canCreateAgents(actorAgent);
  }

  function redactEnvironmentForRestrictedView<T extends {
    config: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  }>(environment: T): T & { configRedacted: true; metadataRedacted: true } {
    return {
      ...environment,
      config: {},
      metadata: null,
      configRedacted: true,
      metadataRedacted: true,
    };
  }

  function summarizeEnvironmentUpdate(
    patch: Record<string, unknown>,
    environment: {
      name: string;
      driver: string;
      status: string;
    },
  ): Record<string, unknown> {
    const details: Record<string, unknown> = {
      changedFields: Object.keys(patch).sort(),
    };

    if (patch.name !== undefined) details.name = environment.name;
    if (patch.driver !== undefined) details.driver = environment.driver;
    if (patch.status !== undefined) details.status = environment.status;
    if (patch.description !== undefined) details.descriptionChanged = true;
    if (patch.config !== undefined) {
      details.configChanged = true;
      details.configTopLevelKeyCount =
        patch.config && typeof patch.config === "object" && !Array.isArray(patch.config)
          ? Object.keys(patch.config as Record<string, unknown>).length
          : 0;
    }
    if (patch.metadata !== undefined) {
      details.metadataChanged = true;
      details.metadataTopLevelKeyCount =
        patch.metadata && typeof patch.metadata === "object" && !Array.isArray(patch.metadata)
          ? Object.keys(patch.metadata as Record<string, unknown>).length
          : 0;
    }

    return details;
  }

  router.get("/squads/:squadId/environments", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const rows = await svc.list(squadId, {
      status: req.query.status as string | undefined,
      driver: req.query.driver as string | undefined,
    });
    const canReadConfigs = await actorCanReadEnvironmentConfigurations(req, squadId);
    if (canReadConfigs) {
      res.json(rows);
      return;
    }
    res.json(rows.map((environment) => redactEnvironmentForRestrictedView(environment)));
  });

  router.get("/squads/:squadId/environments/capabilities", async (req, res) => {
    const squadId = req.params.squadId as string;
    assertSquadAccess(req, squadId);
    const pluginDrivers = await listReadyPluginEnvironmentDrivers({
      db,
      workerManager: options.pluginWorkerManager,
    });
    res.json(getEnvironmentCapabilities(
      AGENT_ADAPTER_TYPES,
      {
        sandboxProviders: Object.fromEntries(pluginDrivers.map((driver) => [
          driver.driverKey,
          {
            status: "supported" as const,
            supportsSavedProbe: true,
            supportsUnsavedProbe: true,
            supportsRunExecution: true,
            supportsReusableLeases: true,
            displayName: driver.displayName,
            description: driver.description,
            source: "plugin" as const,
            pluginKey: driver.pluginKey,
            pluginId: driver.pluginId,
            configSchema: driver.configSchema,
          },
        ])),
      },
    ));
  });

  router.post("/squads/:squadId/environments", validate(createEnvironmentSchema), async (req, res) => {
    const squadId = req.params.squadId as string;
    await assertCanMutateEnvironments(req, squadId);
    if (req.body.driver === "local") {
      const existingLocal = await svc.list(squadId, { driver: "local" });
      if (existingLocal.length > 0) {
        throw conflict("A local environment already exists for this squad.");
      }
    }
    const actor = getActorInfo(req);
    const input = {
      ...req.body,
      config: await normalizeEnvironmentConfigForPersistence({
        db,
        squadId,
        environmentName: req.body.name,
        driver: req.body.driver,
        secretProvider: getConfiguredSecretProvider(),
        config: req.body.config,
        actor: {
          agentId: actor.agentId,
          userId: actor.actorType === "user" ? actor.actorId : null,
        },
        pluginWorkerManager: options.pluginWorkerManager,
      }),
    };
    const environment = await svc.create(squadId, input);
    await secrets.syncSecretRefsForTarget(
      squadId,
      { targetType: "environment", targetId: environment.id },
      await collectEnvironmentSecretRefs({ db, environment }),
    );
    await logActivity(db, {
      squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "environment.created",
      entityType: "environment",
      entityId: environment.id,
      details: {
        name: environment.name,
        driver: environment.driver,
        status: environment.status,
      },
    });
    res.status(201).json(environment);
  });

  router.get("/environments/:id", async (req, res) => {
    const environment = await svc.getById(req.params.id as string);
    if (!environment) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    assertSquadAccess(req, environment.squadId);
    const canReadConfigs = await actorCanReadEnvironmentConfigurations(req, environment.squadId);
    if (canReadConfigs) {
      res.json(environment);
      return;
    }
    res.json(redactEnvironmentForRestrictedView(environment));
  });

  router.get("/environments/:id/leases", async (req, res) => {
    const environment = await svc.getById(req.params.id as string);
    if (!environment) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    assertSquadAccess(req, environment.squadId);
    const canReadConfigs = await actorCanReadEnvironmentConfigurations(req, environment.squadId);
    if (!canReadConfigs) {
      throw forbidden("Missing permission: environments:manage");
    }
    const leases = await svc.listLeases(environment.id, {
      status: req.query.status as string | undefined,
    });
    res.json(leases);
  });

  router.get("/environment-leases/:leaseId", async (req, res) => {
    const lease = await svc.getLeaseById(req.params.leaseId as string);
    if (!lease) {
      res.status(404).json({ error: "Environment lease not found" });
      return;
    }
    assertSquadAccess(req, lease.squadId);
    const canReadConfigs = await actorCanReadEnvironmentConfigurations(req, lease.squadId);
    if (!canReadConfigs) {
      throw forbidden("Missing permission: environments:manage");
    }
    res.json(lease);
  });

  router.patch("/environments/:id", validate(updateEnvironmentSchema), async (req, res) => {
    const existing = await svc.getById(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    await assertCanMutateEnvironments(req, existing.squadId);
    const actor = getActorInfo(req);
    const nextDriver = req.body.driver ?? existing.driver;
    const nextName = req.body.name ?? existing.name;
    const configSource =
      req.body.config !== undefined
        ? req.body.driver !== undefined && req.body.driver !== existing.driver
          ? req.body.config
          : {
              ...parseObject(existing.config),
              ...parseObject(req.body.config),
            }
        : req.body.driver !== undefined && req.body.driver !== existing.driver
          ? {}
          : existing.config;
    const patch = {
      ...req.body,
      ...(req.body.config !== undefined || req.body.driver !== undefined
        ? {
            config: await normalizeEnvironmentConfigForPersistence({
              db,
              squadId: existing.squadId,
              environmentName: nextName,
              driver: nextDriver,
              secretProvider: getConfiguredSecretProvider(),
              config: configSource,
              actor: {
                agentId: actor.agentId,
                userId: actor.actorType === "user" ? actor.actorId : null,
              },
              pluginWorkerManager: options.pluginWorkerManager,
            }),
          }
        : {}),
    };
    const environment = await svc.update(existing.id, patch);
    if (!environment) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    if (patch.config !== undefined || patch.driver !== undefined) {
      await secrets.syncSecretRefsForTarget(
        environment.squadId,
        { targetType: "environment", targetId: environment.id },
        await collectEnvironmentSecretRefs({ db, environment }),
      );
    }
    await logActivity(db, {
      squadId: environment.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "environment.updated",
      entityType: "environment",
      entityId: environment.id,
      details: summarizeEnvironmentUpdate(patch as Record<string, unknown>, environment),
    });
    res.json(environment);
  });

  router.delete("/environments/:id", async (req, res) => {
    const existing = await svc.getById(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    await assertCanMutateEnvironments(req, existing.squadId);
    await Promise.all([
      executionWorkspaces.clearEnvironmentSelection(existing.squadId, existing.id),
      issues.clearExecutionWorkspaceEnvironmentSelection(existing.squadId, existing.id),
      projects.clearExecutionWorkspaceEnvironmentSelection(existing.squadId, existing.id),
    ]);
    const removed = await svc.remove(existing.id);
    if (!removed) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    const secretId = readSshEnvironmentPrivateKeySecretId(existing);
    if (secretId) {
      await secrets.remove(secretId);
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      squadId: existing.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "environment.deleted",
      entityType: "environment",
      entityId: removed.id,
      details: {
        name: removed.name,
        driver: removed.driver,
        status: removed.status,
      },
    });
    res.json(removed);
  });

  router.post("/environments/:id/probe", async (req, res) => {
    const environment = await svc.getById(req.params.id as string);
    if (!environment) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    await assertCanMutateEnvironments(req, environment.squadId);
    const actor = getActorInfo(req);
    const probe = await probeEnvironment(db, environment, {
      pluginWorkerManager: options.pluginWorkerManager,
    });
    await logActivity(db, {
      squadId: environment.squadId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "environment.probed",
      entityType: "environment",
      entityId: environment.id,
      details: {
        driver: environment.driver,
        ok: probe.ok,
        summary: probe.summary,
      },
    });
    res.json(probe);
  });

  router.post(
    "/squads/:squadId/environments/probe-config",
    validate(probeEnvironmentConfigSchema),
    async (req, res) => {
      const squadId = req.params.squadId as string;
      await assertCanMutateEnvironments(req, squadId);
      const actor = getActorInfo(req);
      const normalizedConfig = await normalizeEnvironmentConfigForProbe({
        db,
        driver: req.body.driver,
        config: req.body.config,
        pluginWorkerManager: options.pluginWorkerManager,
      });
      const environment = {
        id: "unsaved",
        squadId,
        name: req.body.name?.trim() || "Unsaved environment",
        description: req.body.description ?? null,
        driver: req.body.driver,
        status: "active" as const,
        config: normalizedConfig,
        metadata: req.body.metadata ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const probe = await probeEnvironment(db, environment, {
        pluginWorkerManager: options.pluginWorkerManager,
        resolvedConfig: {
          driver: req.body.driver,
          config: normalizedConfig,
        } as ParsedEnvironmentConfig,
      });
      await logActivity(db, {
        squadId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "environment.probed_unsaved",
        entityType: "environment",
        entityId: "unsaved",
        details: {
          driver: environment.driver,
          ok: probe.ok,
          summary: probe.summary,
          configTopLevelKeyCount: Object.keys(environment.config).length,
        },
      });
      res.json(probe);
    },
  );

  return router;
}
