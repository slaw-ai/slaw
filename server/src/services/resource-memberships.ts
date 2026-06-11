import { and, eq } from "drizzle-orm";
import type { Db } from "@slaw-ai/db";
import {
  agentMemberships,
  agents,
  projectMemberships,
  projects,
} from "@slaw-ai/db";
import type {
  ResourceMembershipResourceType,
  ResourceMembershipState,
  ResourceMemberships,
  ResourceMembershipUpdateResult,
} from "@slaw-ai/shared";
import { forbidden, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";

type OperatorActor = {
  type: "operator" | "agent" | "none";
  userId?: string;
  squadIds?: string[];
  memberships?: Array<{
    squadId: string;
    membershipRole?: string | null;
    status?: string;
  }>;
  isInstanceAdmin?: boolean;
  source?: string;
};

type PolicyDecision = {
  allowed: boolean;
  reason?: string | null;
  source?: string | null;
};

export type ResourceMembershipPolicyHook = (input: {
  actor: OperatorActor;
  squadId: string;
  userId: string;
  resourceType: ResourceMembershipResourceType;
  resourceId: string;
  state: ResourceMembershipState;
}) => Promise<PolicyDecision> | PolicyDecision;

type ResourceMembershipServiceOptions = {
  policyHook?: ResourceMembershipPolicyHook | null;
};

function defaultJoinedMap<T extends { projectId?: string; agentId?: string; state: string }>(
  rows: T[],
  key: "projectId" | "agentId",
): Record<string, ResourceMembershipState> {
  const result: Record<string, ResourceMembershipState> = {};
  for (const row of rows) {
    const id = row[key];
    if (typeof id !== "string") continue;
    result[id] = row.state === "left" ? "left" : "joined";
  }
  return result;
}

function latestDate(...dates: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }
  return latest;
}

function assertOperatorSelfMembershipAccess(actor: OperatorActor, squadId: string, userId: string) {
  if (actor.type !== "operator" || !actor.userId) {
    throw forbidden("Operator user access required");
  }
  if (actor.userId !== userId) {
    throw forbidden("Users may only update their own resource memberships");
  }
  if (actor.source === "local_implicit" || actor.isInstanceAdmin) {
    return;
  }
  const membership = actor.memberships?.find((item) => item.squadId === squadId);
  if (!membership || membership.status !== "active") {
    throw forbidden("User does not have active squad access");
  }
}

async function evaluatePolicy(
  hook: ResourceMembershipPolicyHook | null | undefined,
  input: Parameters<ResourceMembershipPolicyHook>[0],
): Promise<PolicyDecision> {
  if (!hook) return { allowed: true, source: "oss_default" };
  try {
    const decision = await hook(input);
    return {
      allowed: decision.allowed === true,
      reason: decision.reason ?? null,
      source: decision.source ?? "policy_hook",
    };
  } catch (err) {
    logger.warn(
      { err, squadId: input.squadId, resourceType: input.resourceType, resourceId: input.resourceId },
      "resource membership policy hook failed closed",
    );
    return { allowed: false, reason: "policy_hook_failed", source: "policy_hook" };
  }
}

export function resourceMembershipService(db: Db, options: ResourceMembershipServiceOptions = {}) {
  const policyHook = options.policyHook ?? null;

  async function assertMutationAllowed(input: {
    actor: OperatorActor;
    squadId: string;
    userId: string;
    resourceType: ResourceMembershipResourceType;
    resourceId: string;
    state: ResourceMembershipState;
  }): Promise<PolicyDecision> {
    assertOperatorSelfMembershipAccess(input.actor, input.squadId, input.userId);
    const decision = await evaluatePolicy(policyHook, input);
    if (!decision.allowed) {
      logger.warn(
        {
          squadId: input.squadId,
          userId: input.userId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          reason: decision.reason ?? "denied",
          source: decision.source ?? "policy_hook",
        },
        "resource membership mutation denied",
      );
      throw forbidden("Resource membership policy denied this request");
    }
    return decision;
  }

  return {
    async listForUser(squadId: string, userId: string, actor: OperatorActor): Promise<ResourceMemberships> {
      assertOperatorSelfMembershipAccess(actor, squadId, userId);
      const [projectRows, agentRows] = await Promise.all([
        db
          .select({
            projectId: projectMemberships.projectId,
            state: projectMemberships.state,
            updatedAt: projectMemberships.updatedAt,
          })
          .from(projectMemberships)
          .where(and(
            eq(projectMemberships.squadId, squadId),
            eq(projectMemberships.userId, userId),
          )),
        db
          .select({
            agentId: agentMemberships.agentId,
            state: agentMemberships.state,
            updatedAt: agentMemberships.updatedAt,
          })
          .from(agentMemberships)
          .where(and(
            eq(agentMemberships.squadId, squadId),
            eq(agentMemberships.userId, userId),
          )),
      ]);
      return {
        projectMemberships: defaultJoinedMap(projectRows, "projectId"),
        agentMemberships: defaultJoinedMap(agentRows, "agentId"),
        updatedAt: latestDate(
          ...projectRows.map((row) => row.updatedAt),
          ...agentRows.map((row) => row.updatedAt),
        ),
      };
    },

    async updateProject(input: {
      squadId: string;
      userId: string;
      projectId: string;
      state: ResourceMembershipState;
      actor: OperatorActor;
    }): Promise<ResourceMembershipUpdateResult & { changed: boolean; policySource: string }> {
      const project = await db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.squadId, input.squadId),
        ),
      });
      if (!project) throw notFound("Project not found");
      const decision = await assertMutationAllowed({
        actor: input.actor,
        squadId: input.squadId,
        userId: input.userId,
        resourceType: "project",
        resourceId: input.projectId,
        state: input.state,
      });

      const existing = await db.query.projectMemberships.findFirst({
        where: and(
          eq(projectMemberships.squadId, input.squadId),
          eq(projectMemberships.userId, input.userId),
          eq(projectMemberships.projectId, input.projectId),
        ),
      });
      const previousState: ResourceMembershipState = existing?.state === "left" ? "left" : "joined";
      if (previousState === input.state) {
        return {
          resourceType: "project",
          resourceId: input.projectId,
          state: input.state,
          updatedAt: existing?.updatedAt ?? new Date(),
          changed: false,
          policySource: decision.source ?? "oss_default",
        };
      }

      const now = new Date();
      const [row] = await db
        .insert(projectMemberships)
        .values({
          squadId: input.squadId,
          projectId: input.projectId,
          userId: input.userId,
          state: input.state,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [projectMemberships.squadId, projectMemberships.userId, projectMemberships.projectId],
          set: {
            state: input.state,
            updatedAt: now,
          },
        })
        .returning();

      return {
        resourceType: "project",
        resourceId: input.projectId,
        state: row?.state === "left" ? "left" : "joined",
        updatedAt: row?.updatedAt ?? now,
        changed: true,
        policySource: decision.source ?? "oss_default",
      };
    },

    async updateAgent(input: {
      squadId: string;
      userId: string;
      agentId: string;
      state: ResourceMembershipState;
      actor: OperatorActor;
    }): Promise<ResourceMembershipUpdateResult & { changed: boolean; policySource: string }> {
      const agent = await db.query.agents.findFirst({
        where: and(
          eq(agents.id, input.agentId),
          eq(agents.squadId, input.squadId),
        ),
      });
      if (!agent) throw notFound("Agent not found");
      const decision = await assertMutationAllowed({
        actor: input.actor,
        squadId: input.squadId,
        userId: input.userId,
        resourceType: "agent",
        resourceId: input.agentId,
        state: input.state,
      });

      const existing = await db.query.agentMemberships.findFirst({
        where: and(
          eq(agentMemberships.squadId, input.squadId),
          eq(agentMemberships.userId, input.userId),
          eq(agentMemberships.agentId, input.agentId),
        ),
      });
      const previousState: ResourceMembershipState = existing?.state === "left" ? "left" : "joined";
      if (previousState === input.state) {
        return {
          resourceType: "agent",
          resourceId: input.agentId,
          state: input.state,
          updatedAt: existing?.updatedAt ?? new Date(),
          changed: false,
          policySource: decision.source ?? "oss_default",
        };
      }

      const now = new Date();
      const [row] = await db
        .insert(agentMemberships)
        .values({
          squadId: input.squadId,
          agentId: input.agentId,
          userId: input.userId,
          state: input.state,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [agentMemberships.squadId, agentMemberships.userId, agentMemberships.agentId],
          set: {
            state: input.state,
            updatedAt: now,
          },
        })
        .returning();

      return {
        resourceType: "agent",
        resourceId: input.agentId,
        state: row?.state === "left" ? "left" : "joined",
        updatedAt: row?.updatedAt ?? now,
        changed: true,
        policySource: decision.source ?? "oss_default",
      };
    },
  };
}
