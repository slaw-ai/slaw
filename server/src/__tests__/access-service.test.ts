import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  squads,
  squadMemberships,
  createDb,
  instanceUserRoles,
  issues,
  principalPermissionGrants,
} from "@slaw-ai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { accessService } from "../services/access.js";
import { grantsForHumanRole } from "../services/squad-member-roles.js";
import { backfillPrincipalAccessCompatibility } from "../services/principal-access-compatibility.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createSquadWithOwner(db: ReturnType<typeof createDb>) {
  const squad = await db
    .insert(squads)
    .values({
      name: `Access Service ${randomUUID()}`,
      issuePrefix: `AS${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);

  const owner = await db
    .insert(squadMemberships)
    .values({
      squadId: squad.id,
      principalType: "user",
      principalId: `owner-${randomUUID()}`,
      status: "active",
      membershipRole: "owner",
    })
    .returning()
    .then((rows) => rows[0]!);

  return { squad, owner };
}

describeEmbeddedPostgres("access service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-access-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(principalPermissionGrants);
    await db.delete(instanceUserRoles);
    await db.delete(agents);
    await db.delete(squadMemberships);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("rejects combined access updates that would demote the last active owner", async () => {
    const { squad, owner } = await createSquadWithOwner(db);
    const access = accessService(db);

    await expect(
      access.updateMemberAndPermissions(
        squad.id,
        owner.id,
        { membershipRole: "admin", grants: [] },
        "admin-user",
      ),
    ).rejects.toThrow("Cannot remove the last active owner");

    const unchanged = await db
      .select()
      .from(squadMemberships)
      .where(eq(squadMemberships.id, owner.id))
      .then((rows) => rows[0]!);
    expect(unchanged.membershipRole).toBe("owner");
  });

  it("rejects role-only updates that would suspend the last active owner", async () => {
    const { squad, owner } = await createSquadWithOwner(db);
    const access = accessService(db);

    await expect(
      access.updateMember(squad.id, owner.id, { status: "suspended" }),
    ).rejects.toThrow("Cannot remove the last active owner");

    const unchanged = await db
      .select()
      .from(squadMemberships)
      .where(eq(squadMemberships.id, owner.id))
      .then((rows) => rows[0]!);
    expect(unchanged.status).toBe("active");
  });

  it("archives members, clears grants, and reassigns open issues without deleting history", async () => {
    const { squad, owner } = await createSquadWithOwner(db);
    const member = await db
      .insert(squadMemberships)
      .values({
        squadId: squad.id,
        principalType: "user",
        principalId: `member-${randomUUID()}`,
        status: "active",
        membershipRole: "operator",
      })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(principalPermissionGrants).values({
      squadId: squad.id,
      principalType: "user",
      principalId: member.principalId,
      permissionKey: "tasks:assign",
      grantedByUserId: owner.principalId,
    });
    const openIssue = await db
      .insert(issues)
      .values({
        squadId: squad.id,
        title: "Open assigned issue",
        status: "in_progress",
        assigneeUserId: member.principalId,
      })
      .returning()
      .then((rows) => rows[0]!);
    const doneIssue = await db
      .insert(issues)
      .values({
        squadId: squad.id,
        title: "Historical assigned issue",
        status: "done",
        assigneeUserId: member.principalId,
      })
      .returning()
      .then((rows) => rows[0]!);

    const access = accessService(db);
    const result = await access.archiveMember(squad.id, member.id, {
      reassignment: { assigneeUserId: owner.principalId },
    });

    expect(result?.reassignedIssueCount).toBe(1);
    const archived = await db
      .select()
      .from(squadMemberships)
      .where(eq(squadMemberships.id, member.id))
      .then((rows) => rows[0]!);
    expect(archived.status).toBe("archived");

    const remainingGrants = await db
      .select()
      .from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.principalId, member.principalId));
    expect(remainingGrants).toHaveLength(0);

    const reassignedIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, openIssue.id))
      .then((rows) => rows[0]!);
    expect(reassignedIssue.assigneeUserId).toBe(owner.principalId);
    expect(reassignedIssue.status).toBe("todo");

    const historicalIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, doneIssue.id))
      .then((rows) => rows[0]!);
    expect(historicalIssue.assigneeUserId).toBe(member.principalId);
  });

  it("rejects instance-level squad access removal for self and protected users", async () => {
    const { squad, owner } = await createSquadWithOwner(db);
    const access = accessService(db);

    await expect(
      access.setUserSquadAccess(owner.principalId, [], { actorUserId: owner.principalId }),
    ).rejects.toThrow("You cannot remove yourself");

    const admin = await db
      .insert(squadMemberships)
      .values({
        squadId: squad.id,
        principalType: "user",
        principalId: `admin-${randomUUID()}`,
        status: "active",
        membershipRole: "admin",
      })
      .returning()
      .then((rows) => rows[0]!);

    await expect(
      access.setUserSquadAccess(admin.principalId, [], { actorUserId: owner.principalId }),
    ).rejects.toThrow("Owners and admins cannot be removed from squad access");

    const operator = await db
      .insert(squadMemberships)
      .values({
        squadId: squad.id,
        principalType: "user",
        principalId: `operator-${randomUUID()}`,
        status: "active",
        membershipRole: "operator",
      })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(instanceUserRoles).values({
      userId: operator.principalId,
      role: "instance_admin",
    });

    await expect(
      access.setUserSquadAccess(operator.principalId, [], { actorUserId: owner.principalId }),
    ).rejects.toThrow("Instance admins cannot be removed from squad access");
  });

  it("allows owner and admin role-default grants to manage environments", async () => {
    const { squad, owner } = await createSquadWithOwner(db);
    const access = accessService(db);
    const roles = ["admin", "operator", "viewer"] as const;
    const members = await db
      .insert(squadMemberships)
      .values(
        roles.map((role) => ({
          squadId: squad.id,
          principalType: "user" as const,
          principalId: `${role}-${randomUUID()}`,
          status: "active" as const,
          membershipRole: role,
        })),
      )
      .returning();

    await access.setPrincipalGrants(
      squad.id,
      "user",
      owner.principalId,
      grantsForHumanRole("owner"),
      owner.principalId,
    );
    for (const member of members) {
      await access.setPrincipalGrants(
        squad.id,
        "user",
        member.principalId,
        grantsForHumanRole(member.membershipRole as "admin" | "operator" | "viewer"),
        owner.principalId,
      );
    }

    const admin = members.find((member) => member.membershipRole === "admin")!;
    const operator = members.find((member) => member.membershipRole === "operator")!;
    const viewer = members.find((member) => member.membershipRole === "viewer")!;

    await expect(access.canUser(squad.id, owner.principalId, "environments:manage")).resolves.toBe(true);
    await expect(access.canUser(squad.id, admin.principalId, "environments:manage")).resolves.toBe(true);
    await expect(access.canUser(squad.id, operator.principalId, "environments:manage")).resolves.toBe(false);
    await expect(access.canUser(squad.id, viewer.principalId, "environments:manage")).resolves.toBe(false);
  });

  it("backfills pre-upgrade human memberships with missing role grants without replacing custom grants", async () => {
    const { squad, owner } = await createSquadWithOwner(db);
    const scopedEnvironmentGrant = { environmentId: "env-1" };
    const humanRows = await db
      .insert(squadMemberships)
      .values([
        {
          squadId: squad.id,
          principalType: "user",
          principalId: `admin-${randomUUID()}`,
          status: "active",
          membershipRole: "admin",
        },
        {
          squadId: squad.id,
          principalType: "user",
          principalId: `operator-${randomUUID()}`,
          status: "active",
          membershipRole: "operator",
        },
        {
          squadId: squad.id,
          principalType: "user",
          principalId: `viewer-${randomUUID()}`,
          status: "active",
          membershipRole: "viewer",
        },
        {
          squadId: squad.id,
          principalType: "user",
          principalId: `legacy-${randomUUID()}`,
          status: "active",
          membershipRole: null,
        },
      ])
      .returning();
    const admin = humanRows[0]!;
    const operator = humanRows[1]!;
    const viewer = humanRows[2]!;
    const legacyMember = humanRows[3]!;

    await db.insert(principalPermissionGrants).values({
      squadId: squad.id,
      principalType: "user",
      principalId: owner.principalId,
      permissionKey: "environments:manage",
      scope: scopedEnvironmentGrant,
      grantedByUserId: "custom-author",
    });

    const first = await backfillPrincipalAccessCompatibility(db);
    const second = await backfillPrincipalAccessCompatibility(db);

    expect(first.humanGrantsInserted).toBeGreaterThan(0);
    expect(second.humanGrantsInserted).toBe(0);
    await expect(accessService(db).canUser(squad.id, admin.principalId, "environments:manage")).resolves.toBe(true);
    await expect(accessService(db).canUser(squad.id, operator.principalId, "tasks:assign")).resolves.toBe(true);
    await expect(accessService(db).canUser(squad.id, legacyMember.principalId, "tasks:assign")).resolves.toBe(true);
    await expect(accessService(db).canUser(squad.id, viewer.principalId, "tasks:assign")).resolves.toBe(false);

    const ownerEnvironmentGrants = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.squadId, squad.id),
          eq(principalPermissionGrants.principalId, owner.principalId),
          eq(principalPermissionGrants.permissionKey, "environments:manage"),
        ),
      );
    expect(ownerEnvironmentGrants).toHaveLength(1);
    expect(ownerEnvironmentGrants[0]?.scope).toEqual(scopedEnvironmentGrant);
    expect(ownerEnvironmentGrants[0]?.grantedByUserId).toBe("custom-author");
  });

  it("backfills non-terminal agents as active squad members without reviving pending or terminated agents", async () => {
    const { squad } = await createSquadWithOwner(db);
    const agentRows = await db
      .insert(agents)
      .values([
        {
          squadId: squad.id,
          name: `Idle ${randomUUID()}`,
          role: "engineer",
          status: "idle",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
        {
          squadId: squad.id,
          name: `Running ${randomUUID()}`,
          role: "engineer",
          status: "running",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
        {
          squadId: squad.id,
          name: `Pending ${randomUUID()}`,
          role: "engineer",
          status: "pending_approval",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
        {
          squadId: squad.id,
          name: `Terminated ${randomUUID()}`,
          role: "engineer",
          status: "terminated",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
      ])
      .returning();
    const idleAgent = agentRows[0]!;
    const runningAgent = agentRows[1]!;
    const pendingAgent = agentRows[2]!;
    const terminatedAgent = agentRows[3]!;

    const first = await backfillPrincipalAccessCompatibility(db);
    const second = await backfillPrincipalAccessCompatibility(db);

    expect(first.agentMembershipsInserted).toBe(2);
    expect(second.agentMembershipsInserted).toBe(0);
    const memberships = await db
      .select()
      .from(squadMemberships)
      .where(eq(squadMemberships.principalType, "agent"));
    expect(memberships.map((membership) => membership.principalId).sort()).toEqual([
      idleAgent.id,
      runningAgent.id,
    ].sort());
    expect(memberships.every((membership) => membership.status === "active")).toBe(true);
    expect(memberships.every((membership) => membership.membershipRole === "member")).toBe(true);
    expect(memberships.some((membership) => membership.principalId === pendingAgent.id)).toBe(false);
    expect(memberships.some((membership) => membership.principalId === terminatedAgent.id)).toBe(false);
  });

  it("copies active user memberships with role-default grants for safe squad imports", async () => {
    const source = await createSquadWithOwner(db);
    const target = await createSquadWithOwner(db);
    const admin = await db
      .insert(squadMemberships)
      .values({
        squadId: source.squad.id,
        principalType: "user",
        principalId: `admin-${randomUUID()}`,
        status: "active",
        membershipRole: "admin",
      })
      .returning()
      .then((rows) => rows[0]!);

    const access = accessService(db);
    await access.copyActiveUserMemberships(source.squad.id, target.squad.id);

    const copiedOwnerGrants = await access.listPrincipalGrants(
      target.squad.id,
      "user",
      source.owner.principalId,
    );
    const copiedAdminGrants = await access.listPrincipalGrants(
      target.squad.id,
      "user",
      admin.principalId,
    );
    expect(copiedOwnerGrants.map((grant) => grant.permissionKey)).toEqual(
      grantsForHumanRole("owner").map((grant) => grant.permissionKey).sort(),
    );
    expect(copiedAdminGrants.map((grant) => grant.permissionKey)).toEqual(
      grantsForHumanRole("admin").map((grant) => grant.permissionKey).sort(),
    );
  });

  it("preserves explicit scoped environment grants when backfilling owner and admin defaults", async () => {
    const { squad, owner } = await createSquadWithOwner(db);
    const scopedGrant = { environmentId: "env-1" };
    await db.insert(principalPermissionGrants).values({
      squadId: squad.id,
      principalType: "user",
      principalId: owner.principalId,
      permissionKey: "environments:manage",
      scope: scopedGrant,
      grantedByUserId: "custom-grant-author",
    });

    await db.execute(sql.raw(`
      INSERT INTO "principal_permission_grants" (
        "squad_id",
        "principal_type",
        "principal_id",
        "permission_key",
        "scope",
        "granted_by_user_id",
        "created_at",
        "updated_at"
      )
      SELECT
        "squad_id",
        'user',
        "principal_id",
        'environments:manage',
        NULL,
        NULL,
        now(),
        now()
      FROM "squad_memberships"
      WHERE "principal_type" = 'user'
        AND "status" = 'active'
        AND "membership_role" IN ('owner', 'admin')
      ON CONFLICT (
        "squad_id",
        "principal_type",
        "principal_id",
        "permission_key"
      ) DO NOTHING
    `));

    const grants = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.squadId, squad.id),
          eq(principalPermissionGrants.principalId, owner.principalId),
          eq(principalPermissionGrants.permissionKey, "environments:manage"),
        ),
      );
    expect(grants).toHaveLength(1);
    expect(grants[0]?.scope).toEqual(scopedGrant);
    expect(grants[0]?.grantedByUserId).toBe("custom-grant-author");
  });
});
