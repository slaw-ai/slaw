import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@slaw-ai/db";
import { agentApiKeys, agents, authUsers, squads, squadMemberships, instanceUserRoles } from "@slaw-ai/db";
import { verifyLocalAgentJwt } from "../agent-auth-jwt.js";
import type { DeploymentMode } from "@slaw-ai/shared";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import { logger } from "./logger.js";
import { operatorAuthService } from "../services/operator-auth.js";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

interface ActorMiddlewareOptions {
  deploymentMode: DeploymentMode;
  resolveSession?: (req: Request) => Promise<BetterAuthSessionResult | null>;
}

export function actorMiddleware(db: Db, opts: ActorMiddlewareOptions): RequestHandler {
  const operatorAuth = operatorAuthService(db);
  return async (req, _res, next) => {
    req.actor =
      opts.deploymentMode === "local_trusted"
        ? {
            type: "operator",
            userId: "local-operator",
            userName: "Local Operator",
            userEmail: null,
            isInstanceAdmin: true,
            source: "local_implicit",
          }
        : { type: "none", source: "none" };

    const runIdHeader = req.header("x-slaw-run-id");

    const authHeader = req.header("authorization");
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      if (opts.deploymentMode === "authenticated" && opts.resolveSession) {
        const cloudTenantActor = await resolveCloudTenantActor(db, req);
        if (cloudTenantActor) {
          req.actor = {
            ...cloudTenantActor,
            runId: runIdHeader ?? undefined,
          };
          next();
          return;
        }

        let session: BetterAuthSessionResult | null = null;
        try {
          session = await opts.resolveSession(req);
        } catch (err) {
          logger.warn(
            { err, method: req.method, url: req.originalUrl },
            "Failed to resolve auth session from request headers",
          );
        }
        if (session?.user?.id) {
          const userId = session.user.id;
          const [roleRow, memberships] = await Promise.all([
            db
              .select({ id: instanceUserRoles.id })
              .from(instanceUserRoles)
              .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
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
              ),
          ]);
          req.actor = {
            type: "operator",
            userId,
            userName: session.user.name ?? null,
            userEmail: session.user.email ?? null,
            squadIds: memberships.map((row) => row.squadId),
            memberships,
            isInstanceAdmin: Boolean(roleRow),
            runId: runIdHeader ?? undefined,
            source: "session",
          };
          next();
          return;
        }
      }
      if (runIdHeader) req.actor.runId = runIdHeader;
      next();
      return;
    }

    const token = authHeader.slice("bearer ".length).trim();
    if (!token) {
      next();
      return;
    }

    const operatorKey = await operatorAuth.findOperatorApiKeyByToken(token);
    if (operatorKey) {
      const access = await operatorAuth.resolveOperatorAccess(operatorKey.userId);
      if (access.user) {
        await operatorAuth.touchOperatorApiKey(operatorKey.id);
        req.actor = {
          type: "operator",
          userId: operatorKey.userId,
          userName: access.user?.name ?? null,
          userEmail: access.user?.email ?? null,
          squadIds: access.squadIds,
          memberships: access.memberships,
          isInstanceAdmin: access.isInstanceAdmin,
          keyId: operatorKey.id,
          runId: runIdHeader || undefined,
          source: "operator_key",
        };
        next();
        return;
      }
    }

    const tokenHash = hashToken(token);
    const key = await db
      .select()
      .from(agentApiKeys)
      .where(and(eq(agentApiKeys.keyHash, tokenHash), isNull(agentApiKeys.revokedAt)))
      .then((rows) => rows[0] ?? null);

    if (!key) {
      const claims = verifyLocalAgentJwt(token);
      if (!claims) {
        next();
        return;
      }

      const agentRecord = await db
        .select()
        .from(agents)
        .where(eq(agents.id, claims.sub))
        .then((rows) => rows[0] ?? null);

      if (!agentRecord || agentRecord.squadId !== claims.squad_id) {
        next();
        return;
      }

      if (agentRecord.status === "terminated" || agentRecord.status === "pending_approval") {
        next();
        return;
      }

      req.actor = {
        type: "agent",
        agentId: claims.sub,
        squadId: claims.squad_id,
        keyId: undefined,
        runId: runIdHeader || claims.run_id || undefined,
        source: "agent_jwt",
      };
      next();
      return;
    }

    await db
      .update(agentApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(agentApiKeys.id, key.id));

    const agentRecord = await db
      .select()
      .from(agents)
      .where(eq(agents.id, key.agentId))
      .then((rows) => rows[0] ?? null);

    if (!agentRecord || agentRecord.status === "terminated" || agentRecord.status === "pending_approval") {
      next();
      return;
    }

    req.actor = {
      type: "agent",
      agentId: key.agentId,
      squadId: key.squadId,
      keyId: key.id,
      runId: runIdHeader || undefined,
      source: "agent_key",
    };

    next();
  };
}

async function resolveCloudTenantActor(db: Db, req: Request): Promise<Express.Request["actor"] | null> {
  const expectedToken = process.env.SLAW_CLOUD_TENANT_SERVER_TOKEN?.trim();
  if (!expectedToken) return null;

  // Source-IP allowlist (H5). The trusted-header bundle grants instance-admin
  // from a shared token alone; require the request to originate from a
  // configured edge proxy CIDR so a leaked token can't be replayed from
  // anywhere. When unset we warn at startup (see assertCloudTenantConfig) but
  // still honour the token — opt-in for back-compat.
  const allowlist = parseCloudTenantAllowlist();
  if (allowlist.length > 0) {
    const remoteIp = (req.ip ?? req.socket?.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (!remoteIp || !allowlist.some((cidr) => ipInCidr(remoteIp, cidr))) {
      logger.warn(
        { remoteIp: remoteIp || "(unknown)" },
        "cloud-tenant header bundle rejected: source IP not in allowlist",
      );
      return null;
    }
  }

  const token = req.header("x-slaw-cloud-tenant-token")?.trim();
  if (!token || !constantTimeStringEqual(token, expectedToken)) return null;

  const userId = requiredCloudHeader(req, "x-slaw-cloud-user-id");
  const userEmail = requiredCloudHeader(req, "x-slaw-cloud-user-email").toLowerCase();
  const stackId = requiredCloudHeader(req, "x-slaw-cloud-stack-id");
  const stackRole = stackMembershipRole(req.header("x-slaw-cloud-stack-role"));
  const userName = req.header("x-slaw-cloud-user-name")?.trim() || userEmail;
  const slawSquadId = req.header("x-slaw-cloud-slaw-squad-id")?.trim();
  const squadId = cloudTenantSquadId(stackId);
  const squadName = slawSquadId || `${stackId} Slaw`;
  const now = new Date();

  await db
    .insert(authUsers)
    .values({
      id: userId,
      name: userName,
      email: userEmail,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: authUsers.id,
      set: {
        name: userName,
        email: userEmail,
        emailVerified: true,
        updatedAt: now,
      },
    });

  await db
    .insert(instanceUserRoles)
    .values({
      userId,
      role: "instance_admin",
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [instanceUserRoles.userId, instanceUserRoles.role],
    });

  await db
    .insert(squads)
    .values({
      id: squadId,
      name: squadName,
      description: `Provisioned by Slaw Cloud for stack ${stackId}.`,
      status: "active",
      issuePrefix: issuePrefixForCloudStack(stackId),
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: squads.id,
    });

  const membershipRole = stackRole === "owner" || stackRole === "admin" ? "owner" : stackRole;
  const membership = await db
    .insert(squadMemberships)
    .values({
      squadId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        squadMemberships.squadId,
        squadMemberships.principalType,
        squadMemberships.principalId,
      ],
      set: {
        status: "active",
        membershipRole,
        updatedAt: now,
      },
    })
    .returning()
    .then((rows) => rows[0] ?? {
      squadId,
      membershipRole,
      status: "active",
    });

  return {
    type: "operator",
    userId,
    userName,
    userEmail,
    squadIds: [squadId],
    memberships: [{
      squadId,
      membershipRole: membership.membershipRole,
      status: membership.status,
    }],
    isInstanceAdmin: true,
    source: "cloud_tenant",
  };
}

function requiredCloudHeader(req: Request, name: string): string {
  const value = req.header(name)?.trim();
  if (!value) {
    throw new Error(`Missing trusted Cloud tenant header ${name}`);
  }
  return value;
}

function stackMembershipRole(value: string | undefined): "owner" | "admin" | "member" | "support" {
  if (value === "owner" || value === "admin" || value === "member" || value === "support") {
    return value;
  }
  throw new Error("Invalid trusted Cloud tenant stack role");
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Parse SLAW_CLOUD_TENANT_ALLOWED_IPS (comma/space-separated IPs or CIDRs). */
function parseCloudTenantAllowlist(): string[] {
  return (process.env.SLAW_CLOUD_TENANT_ALLOWED_IPS ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether an IPv4 address falls inside a CIDR (or equals a bare IP). IPv6 is
 * matched by exact string equality only — deployments needing IPv6 CIDRs should
 * list explicit addresses. Returns false on any parse failure (fail closed).
 *
 * Exported for unit testing.
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes("/")) return ip === cidr;
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipNum = ipv4ToInt(ip);
  const rangeNum = ipv4ToInt(range);
  if (ipNum === null || rangeNum === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const octet = Number(p);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255 || !/^\d+$/.test(p)) return null;
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

/**
 * Startup advisory: if the cloud-tenant trusted-header path is enabled but no
 * source-IP allowlist is configured, warn that the shared token is the only
 * gate. Call once at boot. Also reminds operators the edge proxy MUST strip
 * inbound x-slaw-cloud-* headers from client requests.
 */
export function assertCloudTenantConfig(): void {
  if (!process.env.SLAW_CLOUD_TENANT_SERVER_TOKEN?.trim()) return;
  if (parseCloudTenantAllowlist().length === 0) {
    logger.warn(
      "SLAW_CLOUD_TENANT_SERVER_TOKEN is set but SLAW_CLOUD_TENANT_ALLOWED_IPS is empty — " +
        "the trusted x-slaw-cloud-* header bundle is gated by the shared token alone. " +
        "Set an edge-proxy CIDR allowlist, and ensure the proxy strips inbound x-slaw-cloud-* headers.",
    );
  }
}

function cloudTenantSquadId(stackId: string): string {
  const bytes = createHash("sha256").update(`slaw-cloud-tenant-squad:${stackId}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function issuePrefixForCloudStack(stackId: string): string {
  const hash = createHash("sha256").update(stackId).digest("hex").slice(0, 4).toUpperCase();
  return `PC${hash}`;
}

export function requireOperator(req: Express.Request) {
  return req.actor.type === "operator";
}
