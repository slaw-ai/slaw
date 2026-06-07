import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  squads,
  squadMemberships,
  createDb,
  instanceUserRoles,
  principalPermissionGrants,
  projects,
} from "@slaw/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { authorizationService } from "../services/authorization.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createSquad(db: ReturnType<typeof createDb>, label: string) {
  return db
    .insert(squads)
    .values({
      name: `Authorization ${label} ${randomUUID()}`,
      issuePrefix: `AZ${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function createAgent(
  db: ReturnType<typeof createDb>,
  squadId: string,
  input: { role?: string; reportsTo?: string | null; permissions?: Record<string, unknown> } = {},
) {
  return db
    .insert(agents)
    .values({
      squadId,
      name: `Agent ${randomUUID()}`,
      role: input.role ?? "engineer",
      reportsTo: input.reportsTo ?? null,
      permissions: input.permissions ?? {},
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function createProject(db: ReturnType<typeof createDb>, squadId: string, label: string) {
  return db
    .insert(projects)
    .values({
      squadId,
      name: `Project ${label} ${randomUUID()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function grantAgentPermission(
  db: ReturnType<typeof createDb>,
  squadId: string,
  agentId: string,
  permissionKey: "tasks:assign" | "tasks:assign_scope",
  scope: Record<string, unknown> | null = null,
) {
  await db.insert(squadMemberships).values({
    squadId,
    principalType: "agent",
    principalId: agentId,
    status: "active",
    membershipRole: "member",
  });
  await db.insert(principalPermissionGrants).values({
    squadId,
    principalType: "agent",
    principalId: agentId,
    permissionKey,
    scope,
    grantedByUserId: null,
  });
}

describeEmbeddedPostgres("authorization service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-authorization-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(principalPermissionGrants);
    await db.delete(squadMemberships);
    await db.delete(instanceUserRoles);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("allows active user role grants and explains the grant source", async () => {
    const squad = await createSquad(db, "UserGrant");
    const userId = `user-${randomUUID()}`;
    await db.insert(squadMemberships).values({
      squadId: squad.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });
    await db.insert(principalPermissionGrants).values({
      squadId: squad.id,
      principalType: "user",
      principalId: userId,
      permissionKey: "tasks:assign",
      grantedByUserId: "owner",
    });

    const decision = await authorizationService(db).decidePrincipalGrant({
      squadId: squad.id,
      principalType: "user",
      principalId: userId,
      action: "tasks:assign",
      permissionKey: "tasks:assign",
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_explicit_grant",
      grant: {
        principalType: "user",
        principalId: userId,
        permissionKey: "tasks:assign",
      },
    });
    expect(decision.explanation).toContain("Allowed by explicit grant tasks:assign");
  });

  it("allows agent grants for agent configuration decisions", async () => {
    const squad = await createSquad(db, "AgentGrant");
    const actorAgent = await createAgent(db, squad.id);
    const targetAgent = await createAgent(db, squad.id);
    await db.insert(squadMemberships).values({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(principalPermissionGrants).values({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      permissionKey: "agents:create",
      grantedByUserId: null,
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, squadId: squad.id, source: "agent_key" },
      action: "agent_config:read",
      resource: { type: "agent", squadId: squad.id, agentId: targetAgent.id },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.grant?.permissionKey).toBe("agents:create");
  });

  it("denies cross-squad agent decisions before grant evaluation", async () => {
    const sourceSquad = await createSquad(db, "Source");
    const targetSquad = await createSquad(db, "Target");
    const actorAgent = await createAgent(db, sourceSquad.id);

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, squadId: sourceSquad.id, source: "agent_jwt" },
      action: "tasks:assign",
      resource: { type: "squad", squadId: targetSquad.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_squad_boundary",
    });
    expect(decision.explanation).toContain("Agent key cannot access another squad");
  });

  it("allows simple-mode task assignment between same-squad agents without explicit grants", async () => {
    const squad = await createSquad(db, "AssignmentDefault");
    const actorAgent = await createAgent(db, squad.id, { role: "engineer" });
    const targetAgent = await createAgent(db, squad.id, { role: "engineer" });
    await db.insert(squadMemberships).values({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      status: "active",
      membershipRole: "member",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, squadId: squad.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", squadId: squad.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_simple_squad_member",
    });
    expect(decision.explanation).toContain("simple mode");
  });

  it("denies simple-mode assignment when the target agent requires protected-assignment approval", async () => {
    const squad = await createSquad(db, "ProtectedAssignment");
    const actorAgent = await createAgent(db, squad.id, { role: "engineer" });
    const targetAgent = await createAgent(db, squad.id, {
      role: "engineer",
      permissions: {
        authorizationPolicy: {
          assignmentPolicy: {
            mode: "protected",
            protectedAgentRequiresApproval: true,
          },
          protectedAgent: {
            requiresApproval: true,
            approvalReason: "Production deployment authority",
          },
          managedBy: "permissions-extension",
        },
      },
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, squadId: squad.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", squadId: squad.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    expect(decision.explanation).toContain("requires approval");
  });

  it("requires an explicit grant before assigning to a private target agent", async () => {
    const squad = await createSquad(db, "PrivateAssignment");
    const actorAgent = await createAgent(db, squad.id, { role: "engineer" });
    const targetAgent = await createAgent(db, squad.id, {
      role: "engineer",
      permissions: {
        authorizationPolicy: {
          agentVisibility: {
            mode: "private",
            hiddenFromDefaultDirectory: true,
          },
          assignmentPolicy: {
            mode: "squad_default",
            protectedAgentRequiresApproval: false,
          },
          protectedAgent: {
            requiresApproval: false,
          },
          managedBy: "permissions-extension",
        },
      },
    });

    const denied = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, squadId: squad.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", squadId: squad.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    await grantAgentPermission(db, squad.id, actorAgent.id, "tasks:assign_scope", {
      assigneeAgentId: targetAgent.id,
    });

    const allowed = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, squadId: squad.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", squadId: squad.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(denied).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    expect(denied.explanation).toContain("private");
    expect(allowed).toMatchObject({
      allowed: true,
      reason: "allow_explicit_grant",
      grant: { permissionKey: "tasks:assign_scope" },
    });
  });

  it("allows simple-mode task assignment for active same-squad operator operators without explicit grants", async () => {
    const squad = await createSquad(db, "BoardAssignmentDefault");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, squad.id, { role: "engineer" });
    await db.insert(squadMemberships).values({
      squadId: squad.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "operator", userId, source: "session" },
      action: "tasks:assign",
      resource: { type: "issue", squadId: squad.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_simple_squad_member",
    });
  });

  it("denies legacy operator assignment context for viewers", async () => {
    const squad = await createSquad(db, "BoardViewerAssignment");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, squad.id, { role: "engineer" });
    await db.insert(squadMemberships).values({
      squadId: squad.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "viewer",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "operator", userId, squadIds: [squad.id], source: "session" },
      action: "tasks:assign",
      resource: { type: "issue", squadId: squad.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_missing_grant",
    });
  });

  it("denies simple-mode assignment to a target agent from another squad", async () => {
    const sourceSquad = await createSquad(db, "AssignmentSource");
    const targetSquad = await createSquad(db, "AssignmentTarget");
    const actorAgent = await createAgent(db, sourceSquad.id, { role: "engineer" });
    const targetAgent = await createAgent(db, targetSquad.id, { role: "engineer" });
    await db.insert(squadMemberships).values({
      squadId: sourceSquad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      status: "active",
      membershipRole: "member",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, squadId: sourceSquad.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", squadId: sourceSquad.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_squad_boundary",
    });
  });

  it("preserves legacy Squad Lead agent creator authority", async () => {
    const squad = await createSquad(db, "Legacy");
    const actorAgent = await createAgent(db, squad.id, { role: "squad_lead" });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, squadId: squad.id, source: "agent_jwt" },
      action: "agents:create",
      resource: { type: "squad", squadId: squad.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_legacy_agent_creator",
    });
  });

  it("allows scoped assignment inside a granted project and denies other projects", async () => {
    const squad = await createSquad(db, "ProjectScope");
    const project = await createProject(db, squad.id, "Allowed");
    const otherProject = await createProject(db, squad.id, "Denied");
    const actorAgent = await createAgent(db, squad.id);
    const targetAgent = await createAgent(db, squad.id);
    await grantAgentPermission(db, squad.id, actorAgent.id, "tasks:assign_scope", {
      projectIds: [project.id],
    });

    const allowed = await authorizationService(db).decidePrincipalGrant({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { projectId: project.id, assigneeAgentId: targetAgent.id },
    });
    const denied = await authorizationService(db).decidePrincipalGrant({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { projectId: otherProject.id, assigneeAgentId: targetAgent.id },
    });

    expect(allowed).toMatchObject({
      allowed: true,
      grant: { permissionKey: "tasks:assign_scope" },
    });
    expect(denied).toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });
    expect(denied.explanation).toContain("does not cover the requested scope");
  });

  it("treats unknown grant scope metadata as unconstrained", async () => {
    const squad = await createSquad(db, "UnknownScopeMetadata");
    const actorAgent = await createAgent(db, squad.id);
    const targetAgent = await createAgent(db, squad.id);
    await grantAgentPermission(db, squad.id, actorAgent.id, "tasks:assign_scope", {
      note: "Squad Lead-approved",
    });

    const decision = await authorizationService(db).decidePrincipalGrant({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      grant: { permissionKey: "tasks:assign_scope" },
    });
  });

  it("allows scoped assignment to agents inside a managed subtree only", async () => {
    const squad = await createSquad(db, "SubtreeScope");
    const actorAgent = await createAgent(db, squad.id);
    const managerAgent = await createAgent(db, squad.id);
    const childAgent = await createAgent(db, squad.id, { reportsTo: managerAgent.id });
    const grandchildAgent = await createAgent(db, squad.id, { reportsTo: childAgent.id });
    const outsideAgent = await createAgent(db, squad.id);
    await grantAgentPermission(db, squad.id, actorAgent.id, "tasks:assign_scope", {
      managedSubtreeAgentIds: [managerAgent.id],
    });

    const allowed = await authorizationService(db).decidePrincipalGrant({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: grandchildAgent.id },
    });
    const denied = await authorizationService(db).decidePrincipalGrant({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: outsideAgent.id },
    });

    expect(allowed.allowed).toBe(true);
    expect(allowed.grant?.permissionKey).toBe("tasks:assign_scope");
    expect(denied).toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });
  });

  it("allows scoped assignment to an explicit target-agent allowlist only", async () => {
    const squad = await createSquad(db, "AllowlistScope");
    const actorAgent = await createAgent(db, squad.id);
    const allowedTarget = await createAgent(db, squad.id);
    const deniedTarget = await createAgent(db, squad.id);
    await grantAgentPermission(db, squad.id, actorAgent.id, "tasks:assign_scope", {
      assigneeAgentIds: [allowedTarget.id],
    });

    const allowed = await authorizationService(db).decidePrincipalGrant({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: allowedTarget.id },
    });
    const denied = await authorizationService(db).decidePrincipalGrant({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: deniedTarget.id },
    });

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
  });

  it("preserves unscoped tasks:assign compatibility for assignment decisions", async () => {
    const squad = await createSquad(db, "BroadAssign");
    const actorAgent = await createAgent(db, squad.id);
    const targetAgent = await createAgent(db, squad.id);
    await grantAgentPermission(db, squad.id, actorAgent.id, "tasks:assign");

    const decision = await authorizationService(db).decidePrincipalGrant({
      squadId: squad.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign",
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      grant: { permissionKey: "tasks:assign" },
    });
  });
});
