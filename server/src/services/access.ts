import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@slaw/db";
import {
  agents,
  squadMemberships,
  instanceUserRoles,
  issues,
  principalPermissionGrants,
} from "@slaw/db";
import type { PermissionKey, PrincipalType } from "@slaw/shared";
import { conflict } from "../errors.js";
import { authorizationService, type AuthorizationActor, type AuthorizationResource } from "./authorization.js";
import { ensureHumanRoleDefaultGrants } from "./principal-access-compatibility.js";

type MembershipRow = typeof squadMemberships.$inferSelect;
type GrantInput = {
  permissionKey: PermissionKey;
  scope?: Record<string, unknown> | null;
};

type MemberArchiveInput = {
  reassignment?: {
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
  } | null;
};

export function accessService(db: Db) {
  const authorization = authorizationService(db);

  async function isInstanceAdmin(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const row = await db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    return Boolean(row);
  }

  async function getMembership(
    squadId: string,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<MembershipRow | null> {
    return db
      .select()
      .from(squadMemberships)
      .where(
        and(
          eq(squadMemberships.squadId, squadId),
          eq(squadMemberships.principalType, principalType),
          eq(squadMemberships.principalId, principalId),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function hasPermission(
    squadId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKey: PermissionKey,
  ): Promise<boolean> {
    return authorization.decidePrincipalGrant({
      squadId,
      principalType,
      principalId,
      permissionKey,
      action: permissionKey,
    }).then((decision) => decision.allowed);
  }

  async function canUser(
    squadId: string,
    userId: string | null | undefined,
    permissionKey: PermissionKey,
  ): Promise<boolean> {
    return authorization.decide({
      actor: { type: "operator", userId },
      action: permissionKey,
      resource: { type: "squad", squadId },
    }).then((decision) => decision.allowed);
  }

  async function decide(input: {
    actor: AuthorizationActor;
    action: Parameters<typeof authorization.decide>[0]["action"];
    resource: AuthorizationResource;
    scope?: Record<string, unknown> | null;
  }) {
    return authorization.decide(input);
  }

  async function listMembers(squadId: string) {
    return db
      .select()
      .from(squadMemberships)
      .where(eq(squadMemberships.squadId, squadId))
      .orderBy(sql`${squadMemberships.createdAt} desc`);
  }

  async function getMemberById(squadId: string, memberId: string) {
    return db
      .select()
      .from(squadMemberships)
      .where(and(eq(squadMemberships.squadId, squadId), eq(squadMemberships.id, memberId)))
      .then((rows) => rows[0] ?? null);
  }

  async function listActiveUserMemberships(squadId: string) {
    return db
      .select()
      .from(squadMemberships)
      .where(
        and(
          eq(squadMemberships.squadId, squadId),
          eq(squadMemberships.principalType, "user"),
          eq(squadMemberships.status, "active"),
        ),
      )
      .orderBy(sql`${squadMemberships.createdAt} asc`);
  }

  async function setMemberPermissions(
    squadId: string,
    memberId: string,
    grants: GrantInput[],
    grantedByUserId: string | null,
  ) {
    const member = await getMemberById(squadId, memberId);
    if (!member) return null;

    await db.transaction(async (tx) => {
      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.squadId, squadId),
            eq(principalPermissionGrants.principalType, member.principalType),
            eq(principalPermissionGrants.principalId, member.principalId),
          ),
        );
      if (grants.length > 0) {
        await tx.insert(principalPermissionGrants).values(
          grants.map((grant) => ({
            squadId,
            principalType: member.principalType,
            principalId: member.principalId,
            permissionKey: grant.permissionKey,
            scope: grant.scope ?? null,
            grantedByUserId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
      }
    });

    return member;
  }

  async function updateMemberAndPermissions(
    squadId: string,
    memberId: string,
    data: {
      membershipRole?: string | null;
      status?: "pending" | "active" | "suspended";
      grants: GrantInput[];
    },
    grantedByUserId: string | null,
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`
        select ${squadMemberships.id}
        from ${squadMemberships}
        where ${squadMemberships.squadId} = ${squadId}
          and ${squadMemberships.principalType} = 'user'
          and ${squadMemberships.status} = 'active'
          and ${squadMemberships.membershipRole} = 'owner'
        for update
      `);

      const existing = await tx
        .select()
        .from(squadMemberships)
        .where(and(eq(squadMemberships.squadId, squadId), eq(squadMemberships.id, memberId)))
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const nextMembershipRole =
        data.membershipRole !== undefined ? data.membershipRole : existing.membershipRole;
      const nextStatus = data.status ?? existing.status;

      if (
        existing.principalType === "user" &&
        existing.status === "active" &&
        existing.membershipRole === "owner" &&
        (nextStatus !== "active" || nextMembershipRole !== "owner")
      ) {
        const activeOwnerCount = await tx
          .select({ id: squadMemberships.id })
          .from(squadMemberships)
          .where(
            and(
              eq(squadMemberships.squadId, squadId),
              eq(squadMemberships.principalType, "user"),
              eq(squadMemberships.status, "active"),
              eq(squadMemberships.membershipRole, "owner"),
            ),
          )
          .then((rows) => rows.length);
        if (activeOwnerCount <= 1) {
          throw conflict("Cannot remove the last active owner");
        }
      }

      const now = new Date();
      const updated = await tx
        .update(squadMemberships)
        .set({
          membershipRole: nextMembershipRole,
          status: nextStatus,
          updatedAt: now,
        })
        .where(eq(squadMemberships.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? existing);

      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.squadId, squadId),
            eq(principalPermissionGrants.principalType, existing.principalType),
            eq(principalPermissionGrants.principalId, existing.principalId),
          ),
        );
      if (data.grants.length > 0) {
        await tx.insert(principalPermissionGrants).values(
          data.grants.map((grant) => ({
            squadId,
            principalType: existing.principalType,
            principalId: existing.principalId,
            permissionKey: grant.permissionKey,
            scope: grant.scope ?? null,
            grantedByUserId,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      return updated;
    });
  }

  async function assertCanRemoveActiveOwner(
    squadId: string,
    principalType: PrincipalType,
    status: string,
    membershipRole: string | null,
    tx: Pick<Db, "select">,
  ) {
    if (
      principalType !== "user" ||
      status !== "active" ||
      membershipRole !== "owner"
    ) {
      return;
    }

    const activeOwnerCount = await tx
      .select({ id: squadMemberships.id })
      .from(squadMemberships)
      .where(
        and(
          eq(squadMemberships.squadId, squadId),
          eq(squadMemberships.principalType, "user"),
          eq(squadMemberships.status, "active"),
          eq(squadMemberships.membershipRole, "owner"),
        ),
      )
      .then((rows) => rows.length);
    if (activeOwnerCount <= 1) {
      throw conflict("Cannot remove the last active owner");
    }
  }

  async function assertAssignableArchiveTarget(
    squadId: string,
    input: MemberArchiveInput["reassignment"],
    tx: Pick<Db, "select">,
  ) {
    if (!input?.assigneeAgentId && !input?.assigneeUserId) return;
    if (input.assigneeAgentId && input.assigneeUserId) {
      throw conflict("Choose either an agent or user reassignment target");
    }
    if (input.assigneeUserId) {
      const membership = await tx
        .select({ id: squadMemberships.id })
        .from(squadMemberships)
        .where(
          and(
            eq(squadMemberships.squadId, squadId),
            eq(squadMemberships.principalType, "user"),
            eq(squadMemberships.principalId, input.assigneeUserId),
            eq(squadMemberships.status, "active"),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!membership) {
        throw conflict("Replacement user must be an active squad member");
      }
      return;
    }

    const agent = await tx
      .select({
        id: agents.id,
        squadId: agents.squadId,
        status: agents.status,
      })
      .from(agents)
      .where(eq(agents.id, input.assigneeAgentId!))
      .then((rows) => rows[0] ?? null);
    if (!agent || agent.squadId !== squadId) {
      throw conflict("Replacement agent must belong to the same squad");
    }
    if (agent.status === "pending_approval" || agent.status === "terminated") {
      throw conflict("Replacement agent must be assignable");
    }
  }

  async function archiveMember(squadId: string, memberId: string, input: MemberArchiveInput = {}) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`
        select ${squadMemberships.id}
        from ${squadMemberships}
        where ${squadMemberships.squadId} = ${squadId}
          and ${squadMemberships.principalType} = 'user'
          and ${squadMemberships.status} = 'active'
          and ${squadMemberships.membershipRole} = 'owner'
        for update
      `);

      const existing = await tx
        .select()
        .from(squadMemberships)
        .where(and(eq(squadMemberships.squadId, squadId), eq(squadMemberships.id, memberId)))
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;
      if (existing.principalType !== "user") {
        throw conflict("Only human squad members can be archived");
      }
      if (existing.status === "archived") {
        return { member: existing, reassignedIssueCount: 0 };
      }
      if (input.reassignment?.assigneeUserId === existing.principalId) {
        throw conflict("Replacement user cannot be the archived member");
      }

      await assertCanRemoveActiveOwner(
        squadId,
        existing.principalType,
        existing.status,
        existing.membershipRole,
        tx,
      );
      await assertAssignableArchiveTarget(squadId, input.reassignment, tx);

      const now = new Date();
      const assignmentPatch = {
        assigneeAgentId: input.reassignment?.assigneeAgentId ?? null,
        assigneeUserId: input.reassignment?.assigneeUserId ?? null,
        updatedAt: now,
      };
      const assignedOpenIssueWhere = and(
        eq(issues.squadId, squadId),
        eq(issues.assigneeUserId, existing.principalId),
        sql`${issues.status} not in ('done', 'cancelled')`,
      );
      const resetInProgress = await tx
        .update(issues)
        .set({
          ...assignmentPatch,
          status: "todo",
          startedAt: null,
          checkoutRunId: null,
          executionRunId: null,
          executionLockedAt: null,
        })
        .where(and(assignedOpenIssueWhere, eq(issues.status, "in_progress")))
        .returning({ id: issues.id });
      const reassigned = await tx
        .update(issues)
        .set(assignmentPatch)
        .where(and(assignedOpenIssueWhere, ne(issues.status, "in_progress")))
        .returning({ id: issues.id });

      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.squadId, squadId),
            eq(principalPermissionGrants.principalType, existing.principalType),
            eq(principalPermissionGrants.principalId, existing.principalId),
          ),
        );

      const archived = await tx
        .update(squadMemberships)
        .set({
          status: "archived",
          updatedAt: now,
        })
        .where(eq(squadMemberships.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? existing);

      return {
        member: archived,
        reassignedIssueCount: resetInProgress.length + reassigned.length,
      };
    });
  }

  async function promoteInstanceAdmin(userId: string) {
    const existing = await db
      .select()
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    if (existing) return existing;
    return db
      .insert(instanceUserRoles)
      .values({
        userId,
        role: "instance_admin",
      })
      .returning()
      .then((rows) => rows[0]);
  }

  async function demoteInstanceAdmin(userId: string) {
    return db
      .delete(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function listUserSquadAccess(userId: string) {
    return db
      .select()
      .from(squadMemberships)
      .where(and(eq(squadMemberships.principalType, "user"), eq(squadMemberships.principalId, userId)))
      .orderBy(sql`${squadMemberships.createdAt} desc`);
  }

  async function setUserSquadAccess(
    userId: string,
    squadIds: string[],
    options: { actorUserId?: string | null } = {},
  ) {
    const existing = await listUserSquadAccess(userId);
    const existingBySquad = new Map(existing.map((row) => [row.squadId, row]));
    const target = new Set(squadIds);

    await db.transaction(async (tx) => {
      const toArchive = existing.filter((row) => !target.has(row.squadId) && row.status !== "archived");
      if (toArchive.length > 0 && options.actorUserId && options.actorUserId === userId) {
        throw conflict("You cannot remove yourself");
      }
      if (toArchive.length > 0 && (await isInstanceAdmin(userId))) {
        throw conflict("Instance admins cannot be removed from squad access");
      }
      const protectedArchives = toArchive.filter((row) => row.membershipRole === "owner" || row.membershipRole === "admin");
      if (protectedArchives.length > 0) {
        throw conflict("Owners and admins cannot be removed from squad access");
      }
      const activeOwnerArchives = toArchive.filter(
        (row) => row.status === "active" && row.membershipRole === "owner",
      );
      if (activeOwnerArchives.length > 0) {
        const activeOwnerRows = await tx
          .select({ squadId: squadMemberships.squadId, id: squadMemberships.id })
          .from(squadMemberships)
          .where(
            and(
              eq(squadMemberships.principalType, "user"),
              eq(squadMemberships.status, "active"),
              eq(squadMemberships.membershipRole, "owner"),
              inArray(squadMemberships.squadId, activeOwnerArchives.map((row) => row.squadId)),
            ),
          );
        for (const row of activeOwnerArchives) {
          const remainingOwners =
            activeOwnerRows.filter((owner) => owner.squadId === row.squadId).length - 1;
          if (remainingOwners <= 0) {
            throw conflict("Cannot remove the last active owner");
          }
        }
      }
      if (toArchive.length > 0) {
        await tx
          .update(squadMemberships)
          .set({ status: "archived", updatedAt: new Date() })
          .where(inArray(squadMemberships.id, toArchive.map((row) => row.id)));
        await tx
          .delete(principalPermissionGrants)
          .where(
            and(
              eq(principalPermissionGrants.principalType, "user"),
              eq(principalPermissionGrants.principalId, userId),
              inArray(principalPermissionGrants.squadId, toArchive.map((row) => row.squadId)),
            ),
          );
      }

      for (const squadId of target) {
        const existingMembership = existingBySquad.get(squadId);
        if (existingMembership) {
          if (existingMembership.status !== "active") {
            await tx
              .update(squadMemberships)
              .set({
                status: "active",
                membershipRole: existingMembership.membershipRole ?? "operator",
                updatedAt: new Date(),
              })
              .where(eq(squadMemberships.id, existingMembership.id));
          }
          continue;
        }
        await tx.insert(squadMemberships).values({
          squadId,
          principalType: "user",
          principalId: userId,
          status: "active",
          membershipRole: "operator",
        });
      }
    });

    return listUserSquadAccess(userId);
  }

  async function ensureMembership(
    squadId: string,
    principalType: PrincipalType,
    principalId: string,
    membershipRole: string | null = "member",
    status: "pending" | "active" | "suspended" = "active",
  ) {
    const existing = await getMembership(squadId, principalType, principalId);
    if (existing) {
      if (existing.status !== status || existing.membershipRole !== membershipRole) {
        const updated = await db
          .update(squadMemberships)
          .set({ status, membershipRole, updatedAt: new Date() })
          .where(eq(squadMemberships.id, existing.id))
          .returning()
          .then((rows) => rows[0] ?? null);
        return updated ?? existing;
      }
      return existing;
    }

    return db
      .insert(squadMemberships)
      .values({
        squadId,
        principalType,
        principalId,
        status,
        membershipRole,
      })
      .returning()
      .then((rows) => rows[0]);
  }

  async function setPrincipalGrants(
    squadId: string,
    principalType: PrincipalType,
    principalId: string,
    grants: GrantInput[],
    grantedByUserId: string | null,
  ) {
    await db.transaction(async (tx) => {
      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.squadId, squadId),
            eq(principalPermissionGrants.principalType, principalType),
            eq(principalPermissionGrants.principalId, principalId),
          ),
        );
      if (grants.length === 0) return;
      await tx.insert(principalPermissionGrants).values(
        grants.map((grant) => ({
          squadId,
          principalType,
          principalId,
          permissionKey: grant.permissionKey,
          scope: grant.scope ?? null,
          grantedByUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    });
  }

  async function copyActiveUserMemberships(sourceSquadId: string, targetSquadId: string) {
    const sourceMemberships = await listActiveUserMemberships(sourceSquadId);
    for (const membership of sourceMemberships) {
      await ensureMembership(
        targetSquadId,
        "user",
        membership.principalId,
        membership.membershipRole,
        "active",
      );
      await ensureHumanRoleDefaultGrants(db, {
        squadId: targetSquadId,
        principalId: membership.principalId,
        membershipRole: membership.membershipRole,
        grantedByUserId: null,
      });
    }
    return sourceMemberships;
  }

  async function ensureRoleDefaultGrants(
    squadId: string,
    principalId: string,
    membershipRole: string | null | undefined,
    grantedByUserId: string | null,
  ) {
    return ensureHumanRoleDefaultGrants(db, {
      squadId,
      principalId,
      membershipRole,
      grantedByUserId,
    });
  }

  async function listPrincipalGrants(
    squadId: string,
    principalType: PrincipalType,
    principalId: string,
  ) {
    return db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.squadId, squadId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
        ),
      )
      .orderBy(principalPermissionGrants.permissionKey);
  }

  async function setPrincipalPermission(
    squadId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKey: PermissionKey,
    enabled: boolean,
    grantedByUserId: string | null,
    scope: Record<string, unknown> | null = null,
  ) {
    if (!enabled) {
      await db
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.squadId, squadId),
            eq(principalPermissionGrants.principalType, principalType),
            eq(principalPermissionGrants.principalId, principalId),
            eq(principalPermissionGrants.permissionKey, permissionKey),
          ),
        );
      return;
    }

    await ensureMembership(squadId, principalType, principalId, "member", "active");

    const existing = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.squadId, squadId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
          eq(principalPermissionGrants.permissionKey, permissionKey),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (existing) {
      await db
        .update(principalPermissionGrants)
        .set({
          scope,
          grantedByUserId,
          updatedAt: new Date(),
        })
        .where(eq(principalPermissionGrants.id, existing.id));
      return;
    }

    await db.insert(principalPermissionGrants).values({
      squadId,
      principalType,
      principalId,
      permissionKey,
      scope,
      grantedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async function updateMember(
    squadId: string,
    memberId: string,
    data: {
      membershipRole?: string | null;
      status?: "pending" | "active" | "suspended";
    },
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`
        select ${squadMemberships.id}
        from ${squadMemberships}
        where ${squadMemberships.squadId} = ${squadId}
          and ${squadMemberships.principalType} = 'user'
          and ${squadMemberships.status} = 'active'
          and ${squadMemberships.membershipRole} = 'owner'
        for update
      `);

      const existing = await tx
        .select()
        .from(squadMemberships)
        .where(and(eq(squadMemberships.squadId, squadId), eq(squadMemberships.id, memberId)))
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const nextMembershipRole =
        data.membershipRole !== undefined ? data.membershipRole : existing.membershipRole;
      const nextStatus = data.status ?? existing.status;

      if (
        existing.principalType === "user" &&
        existing.status === "active" &&
        existing.membershipRole === "owner" &&
        (nextStatus !== "active" || nextMembershipRole !== "owner")
      ) {
        const activeOwnerCount = await tx
          .select({ id: squadMemberships.id })
          .from(squadMemberships)
          .where(
            and(
              eq(squadMemberships.squadId, squadId),
              eq(squadMemberships.principalType, "user"),
              eq(squadMemberships.status, "active"),
              eq(squadMemberships.membershipRole, "owner"),
            ),
          )
          .then((rows) => rows.length);
        if (activeOwnerCount <= 1) {
          throw conflict("Cannot remove the last active owner");
        }
      }

      return tx
        .update(squadMemberships)
        .set({
          membershipRole: nextMembershipRole,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(squadMemberships.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? existing);
    });
  }

  return {
    isInstanceAdmin,
    decide,
    canUser,
    hasPermission,
    getMembership,
    getMemberById,
    ensureMembership,
    listMembers,
    listActiveUserMemberships,
    copyActiveUserMemberships,
    ensureRoleDefaultGrants,
    archiveMember,
    setMemberPermissions,
    updateMemberAndPermissions,
    promoteInstanceAdmin,
    demoteInstanceAdmin,
    listUserSquadAccess,
    setUserSquadAccess,
    setPrincipalGrants,
    listPrincipalGrants,
    setPrincipalPermission,
    updateMember,
  };
}
