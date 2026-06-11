import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Db } from "@slaw-ai/db";
import { agents, issues } from "@slaw-ai/db";
import type { Request } from "express";
import { forbidden } from "../errors.js";
import { assertSquadAccess } from "./authz.js";

const WORKSPACE_RUNTIME_ELIGIBLE_ISSUE_STATUSES: string[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
];

async function listReportingSubtreeAgentIds(db: Db, squadId: string, actorAgentId: string) {
  const squadAgents = await db
    .select({
      id: agents.id,
      reportsTo: agents.reportsTo,
    })
    .from(agents)
    .where(and(eq(agents.squadId, squadId), ne(agents.status, "terminated")));

  const reportsByManager = new Map<string, string[]>();
  for (const agent of squadAgents) {
    if (!agent.reportsTo) continue;
    const reports = reportsByManager.get(agent.reportsTo) ?? [];
    reports.push(agent.id);
    reportsByManager.set(agent.reportsTo, reports);
  }

  const visited = new Set<string>([actorAgentId]);
  const queue = [actorAgentId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const reports = reportsByManager.get(current) ?? [];
    for (const reportId of reports) {
      if (visited.has(reportId)) continue;
      visited.add(reportId);
      queue.push(reportId);
    }
  }

  return [...visited];
}

async function assertAgentCanManageRuntimeServicesForWorkspace(
  db: Db,
  req: Request,
  input: {
    squadId: string;
    projectWorkspaceId?: string | null;
    executionWorkspaceId?: string | null;
    sourceIssueId?: string | null;
  },
) {
  if (req.actor.type !== "agent" || !req.actor.agentId) {
    throw forbidden("Agent authentication required");
  }

  const actorAgent = await db
    .select({
      id: agents.id,
      squadId: agents.squadId,
      role: agents.role,
    })
    .from(agents)
    .where(eq(agents.id, req.actor.agentId))
    .then((rows) => rows[0] ?? null);

  if (!actorAgent || actorAgent.squadId !== input.squadId) {
    throw forbidden("Agent key cannot access another squad");
  }

  if (actorAgent.role === "squad_lead") {
    return;
  }

  const eligibleAgentIds = await listReportingSubtreeAgentIds(db, input.squadId, actorAgent.id);
  const workspaceScopeConditions = [
    input.projectWorkspaceId ? eq(issues.projectWorkspaceId, input.projectWorkspaceId) : null,
    input.executionWorkspaceId ? eq(issues.executionWorkspaceId, input.executionWorkspaceId) : null,
    input.sourceIssueId ? eq(issues.id, input.sourceIssueId) : null,
  ].filter((condition): condition is NonNullable<typeof condition> => condition !== null);

  if (workspaceScopeConditions.length === 0) {
    throw forbidden("Missing permission to manage workspace runtime services");
  }

  const linkedIssue = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(
      eq(issues.squadId, input.squadId),
      isNull(issues.hiddenAt),
      inArray(issues.status, WORKSPACE_RUNTIME_ELIGIBLE_ISSUE_STATUSES),
      inArray(issues.assigneeAgentId, eligibleAgentIds),
      workspaceScopeConditions.length === 1
        ? workspaceScopeConditions[0]!
        : or(...workspaceScopeConditions),
    ))
    .then((rows) => rows[0] ?? null);

  if (linkedIssue) {
    return;
  }

  throw forbidden("Missing permission to manage workspace runtime services");
}

export async function assertCanManageProjectWorkspaceRuntimeServices(
  db: Db,
  req: Request,
  input: {
    squadId: string;
    projectWorkspaceId: string;
  },
) {
  assertSquadAccess(req, input.squadId);
  if (req.actor.type === "operator") return;
  await assertAgentCanManageRuntimeServicesForWorkspace(db, req, input);
}

export async function assertCanManageExecutionWorkspaceRuntimeServices(
  db: Db,
  req: Request,
  input: {
    squadId: string;
    executionWorkspaceId: string;
    sourceIssueId?: string | null;
  },
) {
  assertSquadAccess(req, input.squadId);
  if (req.actor.type === "operator") return;
  await assertAgentCanManageRuntimeServicesForWorkspace(db, req, input);
}
