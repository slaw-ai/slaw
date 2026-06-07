import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@slaw/db";
import {
  authUsers,
  operatorApiKeys,
  cliAuthChallenges,
  squads,
  squadMemberships,
  instanceUserRoles,
} from "@slaw/db";
import { conflict, forbidden, notFound } from "../errors.js";

export const OPERATOR_API_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CLI_AUTH_CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type CliAuthChallengeStatus = "pending" | "approved" | "cancelled" | "expired";

export function hashBearerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenHashesMatch(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createOperatorApiToken() {
  return `slaw_op_${randomBytes(24).toString("hex")}`;
}

export function createCliAuthSecret() {
  return `pcp_cli_auth_${randomBytes(24).toString("hex")}`;
}

export function operatorApiKeyExpiresAt(nowMs: number = Date.now()) {
  return new Date(nowMs + OPERATOR_API_KEY_TTL_MS);
}

export function cliAuthChallengeExpiresAt(nowMs: number = Date.now()) {
  return new Date(nowMs + CLI_AUTH_CHALLENGE_TTL_MS);
}

function challengeStatusForRow(row: typeof cliAuthChallenges.$inferSelect): CliAuthChallengeStatus {
  if (row.cancelledAt) return "cancelled";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  if (row.approvedAt && row.operatorApiKeyId) return "approved";
  return "pending";
}

export function operatorAuthService(db: Db) {
  async function resolveOperatorAccess(userId: string) {
    const [user, memberships, adminRole] = await Promise.all([
      db
        .select({
          id: authUsers.id,
          name: authUsers.name,
          email: authUsers.email,
        })
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .then((rows) => rows[0] ?? null),
      db
        .select({
          squadId: squadMemberships.squadId,
          membershipRole: squadMemberships.membershipRole,
          status: squadMemberships.status,
        })
        .from(squadMemberships)
        .where(
          and(
            eq(squadMemberships.principalType, "user"),
            eq(squadMemberships.principalId, userId),
            eq(squadMemberships.status, "active"),
          ),
        )
        .then((rows) => rows),
      db
        .select({ id: instanceUserRoles.id })
        .from(instanceUserRoles)
        .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
        .then((rows) => rows[0] ?? null),
    ]);

    return {
      user,
      squadIds: memberships.map((row) => row.squadId),
      memberships,
      isInstanceAdmin: Boolean(adminRole),
    };
  }

  async function resolveOperatorActivitySquadIds(input: {
    userId: string;
    requestedSquadId?: string | null;
    operatorApiKeyId?: string | null;
  }) {
    const access = await resolveOperatorAccess(input.userId);
    const squadIds = new Set(access.squadIds);

    if (squadIds.size === 0 && input.requestedSquadId?.trim()) {
      squadIds.add(input.requestedSquadId.trim());
    }

    if (squadIds.size === 0 && input.operatorApiKeyId?.trim()) {
      const challengeSquadIds = await db
        .select({ requestedSquadId: cliAuthChallenges.requestedSquadId })
        .from(cliAuthChallenges)
        .where(eq(cliAuthChallenges.operatorApiKeyId, input.operatorApiKeyId.trim()))
        .then((rows) =>
          rows
            .map((row) => row.requestedSquadId?.trim() ?? null)
            .filter((value): value is string => Boolean(value)),
        );
      for (const squadId of challengeSquadIds) {
        squadIds.add(squadId);
      }
    }

    if (squadIds.size === 0 && access.isInstanceAdmin) {
      const allSquadIds = await db
        .select({ id: squads.id })
        .from(squads)
        .then((rows) => rows.map((row) => row.id));
      for (const squadId of allSquadIds) {
        squadIds.add(squadId);
      }
    }

    return Array.from(squadIds);
  }

  async function findOperatorApiKeyByToken(token: string) {
    const tokenHash = hashBearerToken(token);
    const now = new Date();
    return db
      .select()
      .from(operatorApiKeys)
      .where(
        and(
          eq(operatorApiKeys.keyHash, tokenHash),
          isNull(operatorApiKeys.revokedAt),
        ),
      )
      .then((rows) => rows.find((row) => !row.expiresAt || row.expiresAt.getTime() > now.getTime()) ?? null);
  }

  async function touchOperatorApiKey(id: string) {
    await db.update(operatorApiKeys).set({ lastUsedAt: new Date() }).where(eq(operatorApiKeys.id, id));
  }

  async function revokeOperatorApiKey(id: string) {
    const now = new Date();
    return db
      .update(operatorApiKeys)
      .set({ revokedAt: now, lastUsedAt: now })
      .where(and(eq(operatorApiKeys.id, id), isNull(operatorApiKeys.revokedAt)))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function createNamedOperatorApiKey(input: {
    userId: string;
    name: string;
    expiresAt?: Date | null;
  }) {
    const token = createOperatorApiToken();
    const created = await db
      .insert(operatorApiKeys)
      .values({
        userId: input.userId,
        name: input.name.trim(),
        keyHash: hashBearerToken(token),
        expiresAt: input.expiresAt === undefined ? operatorApiKeyExpiresAt() : input.expiresAt,
      })
      .returning()
      .then((rows) => rows[0]);

    return {
      id: created.id,
      name: created.name,
      token,
      createdAt: created.createdAt,
      lastUsedAt: created.lastUsedAt,
      revokedAt: created.revokedAt,
      expiresAt: created.expiresAt,
    };
  }

  async function listOperatorApiKeys(
    userId: string,
    opts: { includeInactive?: boolean } = {},
  ) {
    const conditions = [eq(operatorApiKeys.userId, userId)];
    if (!opts.includeInactive) {
      const activeExpirationCondition = or(
        isNull(operatorApiKeys.expiresAt),
        gt(operatorApiKeys.expiresAt, new Date()),
      );
      conditions.push(
        isNull(operatorApiKeys.revokedAt),
      );
      if (activeExpirationCondition) conditions.push(activeExpirationCondition);
    }
    return db
      .select({
        id: operatorApiKeys.id,
        name: operatorApiKeys.name,
        createdAt: operatorApiKeys.createdAt,
        lastUsedAt: operatorApiKeys.lastUsedAt,
        revokedAt: operatorApiKeys.revokedAt,
        expiresAt: operatorApiKeys.expiresAt,
      })
      .from(operatorApiKeys)
      .where(and(...conditions))
      .orderBy(sql`${operatorApiKeys.createdAt} desc`);
  }

  async function getOperatorApiKeyForUser(keyId: string, userId: string) {
    return db
      .select({
        id: operatorApiKeys.id,
        userId: operatorApiKeys.userId,
        name: operatorApiKeys.name,
        createdAt: operatorApiKeys.createdAt,
        lastUsedAt: operatorApiKeys.lastUsedAt,
        revokedAt: operatorApiKeys.revokedAt,
        expiresAt: operatorApiKeys.expiresAt,
      })
      .from(operatorApiKeys)
      .where(and(eq(operatorApiKeys.id, keyId), eq(operatorApiKeys.userId, userId)))
      .then((rows) => rows[0] ?? null);
  }

  async function createCliAuthChallenge(input: {
    command: string;
    clientName?: string | null;
    requestedAccess: "operator" | "instance_admin_required";
    requestedSquadId?: string | null;
  }) {
    const challengeSecret = createCliAuthSecret();
    const pendingOperatorToken = createOperatorApiToken();
    const expiresAt = cliAuthChallengeExpiresAt();
    const labelBase = input.clientName?.trim() || "slaw cli";
    const pendingKeyName =
      input.requestedAccess === "instance_admin_required"
        ? `${labelBase} (instance admin)`
        : `${labelBase} (operator)`;

    const created = await db
      .insert(cliAuthChallenges)
      .values({
        secretHash: hashBearerToken(challengeSecret),
        command: input.command.trim(),
        clientName: input.clientName?.trim() || null,
        requestedAccess: input.requestedAccess,
        requestedSquadId: input.requestedSquadId?.trim() || null,
        pendingKeyHash: hashBearerToken(pendingOperatorToken),
        pendingKeyName,
        expiresAt,
      })
      .returning()
      .then((rows) => rows[0]);

    return {
      challenge: created,
      challengeSecret,
      pendingOperatorToken,
    };
  }

  async function getCliAuthChallenge(id: string) {
    return db
      .select()
      .from(cliAuthChallenges)
      .where(eq(cliAuthChallenges.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function getCliAuthChallengeBySecret(id: string, token: string) {
    const challenge = await getCliAuthChallenge(id);
    if (!challenge) return null;
    if (!tokenHashesMatch(challenge.secretHash, hashBearerToken(token))) return null;
    return challenge;
  }

  async function describeCliAuthChallenge(id: string, token: string) {
    const challenge = await getCliAuthChallengeBySecret(id, token);
    if (!challenge) return null;

    const [squad, approvedBy] = await Promise.all([
      challenge.requestedSquadId
        ? db
            .select({ id: squads.id, name: squads.name })
            .from(squads)
            .where(eq(squads.id, challenge.requestedSquadId))
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      challenge.approvedByUserId
        ? db
            .select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
            .from(authUsers)
            .where(eq(authUsers.id, challenge.approvedByUserId))
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ]);

    return {
      id: challenge.id,
      status: challengeStatusForRow(challenge),
      command: challenge.command,
      clientName: challenge.clientName ?? null,
      requestedAccess: challenge.requestedAccess as "operator" | "instance_admin_required",
      requestedSquadId: challenge.requestedSquadId ?? null,
      requestedSquadName: squad?.name ?? null,
      approvedAt: challenge.approvedAt?.toISOString() ?? null,
      cancelledAt: challenge.cancelledAt?.toISOString() ?? null,
      expiresAt: challenge.expiresAt.toISOString(),
      approvedByUser: approvedBy
        ? {
            id: approvedBy.id,
            name: approvedBy.name,
            email: approvedBy.email,
          }
        : null,
    };
  }

  async function approveCliAuthChallenge(id: string, token: string, userId: string) {
    const access = await resolveOperatorAccess(userId);
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select ${cliAuthChallenges.id} from ${cliAuthChallenges} where ${cliAuthChallenges.id} = ${id} for update`,
      );

      const challenge = await tx
        .select()
        .from(cliAuthChallenges)
        .where(eq(cliAuthChallenges.id, id))
        .then((rows) => rows[0] ?? null);
      if (!challenge || !tokenHashesMatch(challenge.secretHash, hashBearerToken(token))) {
        throw notFound("CLI auth challenge not found");
      }

      const status = challengeStatusForRow(challenge);
      if (status === "expired") return { status, challenge };
      if (status === "cancelled") return { status, challenge };

      if (challenge.requestedAccess === "instance_admin_required" && !access.isInstanceAdmin) {
        throw forbidden("Instance admin required");
      }

      let operatorKeyId = challenge.operatorApiKeyId;
      if (!operatorKeyId) {
        const createdKey = await tx
          .insert(operatorApiKeys)
          .values({
            userId,
            name: challenge.pendingKeyName,
            keyHash: challenge.pendingKeyHash,
            expiresAt: operatorApiKeyExpiresAt(),
          })
          .returning()
          .then((rows) => rows[0]);
        operatorKeyId = createdKey.id;
      }

      const approvedAt = challenge.approvedAt ?? new Date();
      const updated = await tx
        .update(cliAuthChallenges)
        .set({
          approvedByUserId: userId,
          operatorApiKeyId: operatorKeyId,
          approvedAt,
          updatedAt: new Date(),
        })
        .where(eq(cliAuthChallenges.id, challenge.id))
        .returning()
        .then((rows) => rows[0] ?? challenge);

      return { status: "approved" as const, challenge: updated };
    });
  }

  async function cancelCliAuthChallenge(id: string, token: string) {
    const challenge = await getCliAuthChallengeBySecret(id, token);
    if (!challenge) throw notFound("CLI auth challenge not found");

    const status = challengeStatusForRow(challenge);
    if (status === "approved") return { status, challenge };
    if (status === "expired") return { status, challenge };
    if (status === "cancelled") return { status, challenge };

    const updated = await db
      .update(cliAuthChallenges)
      .set({
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(cliAuthChallenges.id, challenge.id))
      .returning()
      .then((rows) => rows[0] ?? challenge);

    return { status: "cancelled" as const, challenge: updated };
  }

  async function assertCurrentOperatorKey(keyId: string | undefined, userId: string | undefined) {
    if (!keyId || !userId) throw conflict("Operator API key context is required");
    const key = await db
      .select()
      .from(operatorApiKeys)
      .where(and(eq(operatorApiKeys.id, keyId), eq(operatorApiKeys.userId, userId)))
      .then((rows) => rows[0] ?? null);
    if (!key || key.revokedAt) throw notFound("Operator API key not found");
    return key;
  }

  return {
    resolveOperatorAccess,
    findOperatorApiKeyByToken,
    touchOperatorApiKey,
    revokeOperatorApiKey,
    createNamedOperatorApiKey,
    listOperatorApiKeys,
    getOperatorApiKeyForUser,
    createCliAuthChallenge,
    getCliAuthChallengeBySecret,
    describeCliAuthChallenge,
    approveCliAuthChallenge,
    cancelCliAuthChallenge,
    assertCurrentOperatorKey,
    resolveOperatorActivitySquadIds,
  };
}
