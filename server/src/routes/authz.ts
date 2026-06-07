import type { Request } from "express";
import { forbidden, unauthorized } from "../errors.js";

export function assertAuthenticated(req: Request) {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
}

export function assertOperator(req: Request) {
  if (req.actor.type !== "operator") {
    throw forbidden("Operator access required");
  }
}

export function hasOperatorOrgAccess(req: Request) {
  if (req.actor.type !== "operator") {
    return false;
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return true;
  }
  return Array.isArray(req.actor.squadIds) && req.actor.squadIds.length > 0;
}

export function assertOperatorOrgAccess(req: Request) {
  assertOperator(req);
  if (hasOperatorOrgAccess(req)) {
    return;
  }
  throw forbidden("Squad membership or instance admin access required");
}

export function assertInstanceAdmin(req: Request) {
  assertOperator(req);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

export function assertSquadAccess(req: Request, squadId: string) {
  assertAuthenticated(req);
  if (req.actor.type === "agent" && req.actor.squadId !== squadId) {
    throw forbidden("Agent key cannot access another squad");
  }
  if (req.actor.type === "operator" && req.actor.source !== "local_implicit") {
    const allowedSquads = req.actor.squadIds ?? [];
    if (!allowedSquads.includes(squadId)) {
      throw forbidden("User does not have access to this squad");
    }
    const method = typeof req.method === "string" ? req.method.toUpperCase() : "GET";
    const isSafeMethod = ["GET", "HEAD", "OPTIONS"].includes(method);
    if (!isSafeMethod && !req.actor.isInstanceAdmin && Array.isArray(req.actor.memberships)) {
      const membership = req.actor.memberships.find((item) => item.squadId === squadId);
      if (!membership || membership.status !== "active") {
        throw forbidden("User does not have active squad access");
      }
      if (membership.membershipRole === "viewer") {
        throw forbidden("Viewer access is read-only");
      }
    }
  }
}

export function getActorInfo(req: Request) {
  assertAuthenticated(req);
  if (req.actor.type === "agent") {
    return {
      actorType: "agent" as const,
      actorId: req.actor.agentId ?? "unknown-agent",
      agentId: req.actor.agentId ?? null,
      runId: req.actor.runId ?? null,
    };
  }

  return {
    actorType: "user" as const,
    actorId: req.actor.userId ?? "operator",
    agentId: null,
    runId: req.actor.runId ?? null,
  };
}
