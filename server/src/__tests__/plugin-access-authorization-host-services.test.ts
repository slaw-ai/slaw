import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  squads,
  squadMemberships,
  createDb,
  invites,
  principalPermissionGrants,
} from "@slaw/db";
import { buildHostServices } from "../services/plugin-host-services.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const pluginId = "plugin-record-id";

function createEventBusStub() {
  return {
    forPlugin() {
      return {
        emit: vi.fn(),
        subscribe: vi.fn(),
        clear: vi.fn(),
      };
    },
  } as any;
}

async function createSquad(db: ReturnType<typeof createDb>, prefix: string) {
  return db
    .insert(squads)
    .values({
      name: `${prefix} ${randomUUID()}`,
      issuePrefix: `${prefix}${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

describeEmbeddedPostgres("plugin access and authorization host services", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-plugin-access-authz-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(invites);
    await db.delete(agents);
    await db.delete(squadMemberships);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("rejects grant writes for principals outside the requested squad", async () => {
    const targetSquad = await createSquad(db, "PAX");
    const otherSquad = await createSquad(db, "PAY");
    const otherAgent = await db
      .insert(agents)
      .values({
        squadId: otherSquad.id,
        name: "Other agent",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
        permissions: {},
      })
      .returning()
      .then((rows) => rows[0]!);
    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());

    await expect(
      services.authorization.setGrants({
        squadId: targetSquad.id,
        principalType: "agent",
        principalId: otherAgent.id,
        grants: [{ permissionKey: "tasks:assign" }],
      }),
    ).rejects.toThrow("Agent not found");

    const rows = await db.select().from(principalPermissionGrants);
    expect(rows).toEqual([]);
    services.dispose();
  });

  it("redacts invite token hashes and sensitive defaults from plugin invite reads", async () => {
    const squad = await createSquad(db, "PAZ");
    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());

    const created = await services.access.createInvite({
      squadId: squad.id,
      allowedJoinTypes: "human",
      defaultsPayload: {
        human: { role: "operator", apiKey: "secret-value" },
        secret: "top-secret",
      },
    });

    expect(created.token).toMatch(/^pcp_invite_/);
    expect("tokenHash" in created).toBe(false);
    expect(created.defaultsPayload).toMatchObject({
      human: { role: "operator", apiKey: "***REDACTED***" },
      secret: "***REDACTED***",
    });

    const listed = await services.access.listInvites({ squadId: squad.id });
    expect(listed.invites).toHaveLength(1);
    expect("token" in listed.invites[0]!).toBe(false);
    expect("tokenHash" in listed.invites[0]!).toBe(false);
    services.dispose();
  });

  it("filters authorization audit entries by allow or deny decision details", async () => {
    const squad = await createSquad(db, "PAU");
    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());
    await db.insert(activityLog).values([
      {
        squadId: squad.id,
        actorType: "agent",
        actorId: "agent-1",
        action: "authorization.assignment_preview",
        entityType: "issue",
        entityId: "issue-1",
        details: { decision: "allow", secret: "do-not-leak" },
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
      {
        squadId: squad.id,
        actorType: "agent",
        actorId: "agent-1",
        action: "authorization.assignment_preview",
        entityType: "issue",
        entityId: "issue-2",
        details: { reason: "deny_scope" },
        createdAt: new Date("2026-01-03T00:00:00Z"),
      },
    ]);

    const [allowed, denied] = await Promise.all([
      services.authorization.searchAudit({
        squadId: squad.id,
        action: "authorization.assignment_preview",
        decision: "allow",
        limit: 1,
      }),
      services.authorization.searchAudit({
        squadId: squad.id,
        action: "authorization.assignment_preview",
        decision: "deny",
      }),
    ]);

    expect(allowed).toHaveLength(1);
    expect(allowed[0]!.entityId).toBe("issue-1");
    expect(allowed[0]!.details).toMatchObject({ decision: "allow", secret: "***REDACTED***" });
    expect(denied).toHaveLength(1);
    expect(denied[0]!.entityId).toBe("issue-2");
    services.dispose();
  });

  it("uses persisted agent policy for plugin assignment preview and explanation", async () => {
    const squad = await createSquad(db, "PAP");
    const [actorAgent, targetAgent] = await db
      .insert(agents)
      .values([
        {
          squadId: squad.id,
          name: "Actor agent",
          role: "engineer",
          adapterType: "process",
          adapterConfig: {},
          permissions: {},
        },
        {
          squadId: squad.id,
          name: "Protected target",
          role: "engineer",
          adapterType: "process",
          adapterConfig: {},
          permissions: {},
        },
      ])
      .returning();
    await db.insert(squadMemberships).values({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent!.id,
      status: "active",
      membershipRole: "member",
    });

    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());
    const updatedPolicy = await services.authorization.updatePolicy({
      squadId: squad.id,
      resourceType: "agent",
      resourceId: targetAgent!.id,
      policy: {
        assignmentPolicy: {
          mode: "protected",
          protectedAgentRequiresApproval: true,
        },
        protectedAgent: {
          requiresApproval: true,
          approvalReason: "Needs board approval",
        },
        managedBy: "permissions-extension",
      },
    });
    const input = {
      squadId: squad.id,
      actor: {
        type: "agent" as const,
        agentId: actorAgent!.id,
        squadId: squad.id,
        source: "agent_key" as const,
      },
      target: { assigneeAgentId: targetAgent!.id },
    };
    const [policy, preview, explanation] = await Promise.all([
      Promise.resolve(updatedPolicy),
      services.authorization.previewAssignment(input),
      services.authorization.explainAssignment(input),
    ]);

    expect(policy.policy).toMatchObject({
      protectedAgent: { requiresApproval: true },
    });
    expect(preview).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    expect(explanation).toMatchObject(preview);

    const injectedBoardPreview = await services.authorization.previewAssignment({
      squadId: squad.id,
      actor: {
        type: "board",
        userId: "operator",
        squadIds: [squad.id],
        source: "local_implicit",
        isInstanceAdmin: true,
      } as any,
      target: { assigneeAgentId: targetAgent!.id },
    });
    expect(injectedBoardPreview).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    services.dispose();
  });

  it("sanitizes plugin authorization policy updates and records audit activity", async () => {
    const squad = await createSquad(db, "PAS");
    const targetAgent = await db
      .insert(agents)
      .values({
        squadId: squad.id,
        name: "Policy target",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
        permissions: {},
      })
      .returning()
      .then((rows) => rows[0]!);
    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());

    const updatedPolicy = await services.authorization.updatePolicy({
      squadId: squad.id,
      resourceType: "agent",
      resourceId: targetAgent.id,
      policy: {
        assignmentPolicy: { mode: "protected" },
        apiKey: "sk-test-secret",
        nested: {
          authorization: "Bearer should-not-persist",
          safeLabel: "kept",
        },
      },
    });

    expect(updatedPolicy.policy).toMatchObject({
      assignmentPolicy: { mode: "protected" },
      apiKey: "***REDACTED***",
      nested: {
        authorization: "***REDACTED***",
        safeLabel: "kept",
      },
    });

    const rows = await db.select().from(activityLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      squadId: squad.id,
      actorType: "plugin",
      actorId: pluginId,
      action: "authorization.policy_updated_by_plugin",
      entityType: "agent",
      entityId: targetAgent.id,
    });
    expect(rows[0]!.details).toMatchObject({
      hasPolicy: true,
      sourcePluginId: pluginId,
      sourcePluginKey: "permissions-extension",
    });
    expect(JSON.stringify(rows[0]!.details)).not.toContain("sk-test-secret");
    expect(JSON.stringify(rows[0]!.details)).not.toContain("should-not-persist");
    services.dispose();
  });
});
