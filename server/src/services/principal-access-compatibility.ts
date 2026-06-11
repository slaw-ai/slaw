import { and, eq, notInArray } from "drizzle-orm";
import type { Db } from "@slaw-ai/db";
import { agents, squadMemberships, principalPermissionGrants } from "@slaw-ai/db";
import type { PermissionKey, PrincipalType } from "@slaw-ai/shared";
import { grantsForHumanRole, normalizeHumanRole } from "./squad-member-roles.js";

type GrantInput = {
  permissionKey: PermissionKey;
  scope?: Record<string, unknown> | null;
};

export type PrincipalAccessCompatibilityBackfillStats = {
  agentMembershipsInserted: number;
  humanGrantsInserted: number;
};

export async function insertMissingPrincipalGrants(
  db: Db,
  input: {
    squadId: string;
    principalType: PrincipalType;
    principalId: string;
    grants: GrantInput[];
    grantedByUserId: string | null;
  },
): Promise<number> {
  if (input.grants.length === 0) return 0;

  const now = new Date();
  const inserted = await db
    .insert(principalPermissionGrants)
    .values(
      input.grants.map((grant) => ({
        squadId: input.squadId,
        principalType: input.principalType,
        principalId: input.principalId,
        permissionKey: grant.permissionKey,
        scope: grant.scope ?? null,
        grantedByUserId: input.grantedByUserId,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [
        principalPermissionGrants.squadId,
        principalPermissionGrants.principalType,
        principalPermissionGrants.principalId,
        principalPermissionGrants.permissionKey,
      ],
    })
    .returning({ id: principalPermissionGrants.id });

  return inserted.length;
}

export async function ensureHumanRoleDefaultGrants(
  db: Db,
  input: {
    squadId: string;
    principalId: string;
    membershipRole: string | null | undefined;
    grantedByUserId: string | null;
  },
): Promise<number> {
  const role = normalizeHumanRole(input.membershipRole, "operator");
  return insertMissingPrincipalGrants(db, {
    squadId: input.squadId,
    principalType: "user",
    principalId: input.principalId,
    grants: grantsForHumanRole(role),
    grantedByUserId: input.grantedByUserId,
  });
}

export async function backfillPrincipalAccessCompatibility(
  db: Db,
): Promise<PrincipalAccessCompatibilityBackfillStats> {
  const now = new Date();
  const nonTerminalAgents = await db
    .select({
      squadId: agents.squadId,
      principalId: agents.id,
    })
    .from(agents)
    .where(notInArray(agents.status, ["pending_approval", "terminated"]));

  const agentMembershipsInserted = nonTerminalAgents.length > 0
    ? await db
      .insert(squadMemberships)
      .values(
        nonTerminalAgents.map((agent) => ({
          squadId: agent.squadId,
          principalType: "agent",
          principalId: agent.principalId,
          status: "active",
          membershipRole: "member",
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [
          squadMemberships.squadId,
          squadMemberships.principalType,
          squadMemberships.principalId,
        ],
      })
      .returning({ id: squadMemberships.id })
      .then((rows) => rows.length)
    : 0;

  const activeHumanMemberships = await db
    .select({
      squadId: squadMemberships.squadId,
      principalId: squadMemberships.principalId,
      membershipRole: squadMemberships.membershipRole,
    })
    .from(squadMemberships)
    .where(
      and(
        eq(squadMemberships.principalType, "user"),
        eq(squadMemberships.status, "active"),
      ),
    );

  let humanGrantsInserted = 0;
  for (const membership of activeHumanMemberships) {
    humanGrantsInserted += await ensureHumanRoleDefaultGrants(db, {
      squadId: membership.squadId,
      principalId: membership.principalId,
      membershipRole: membership.membershipRole,
      grantedByUserId: null,
    });
  }

  return {
    agentMembershipsInserted,
    humanGrantsInserted,
  };
}
