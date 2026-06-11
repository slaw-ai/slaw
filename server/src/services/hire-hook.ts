import { and, eq } from "drizzle-orm";
import type { Db } from "@slaw-ai/db";
import { agents } from "@slaw-ai/db";
import type { HireApprovedPayload } from "@slaw-ai/adapter-utils";
import { findActiveServerAdapter } from "../adapters/registry.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";

const HIRE_APPROVED_MESSAGE =
  "Tell your user that your hire was approved, now they should assign you a task in Slaw or ask you to create issues.";

export interface NotifyHireApprovedInput {
  squadId: string;
  agentId: string;
  source: "join_request" | "approval";
  sourceId: string;
  approvedAt?: Date;
}

/**
 * Invokes the adapter's onHireApproved hook when an agent is approved (join-request or hire_agent approval).
 * Failures are non-fatal: we log and write to activity, never throw.
 */
export async function notifyHireApproved(
  db: Db,
  input: NotifyHireApprovedInput,
): Promise<void> {
  const { squadId, agentId, source, sourceId } = input;
  const approvedAt = input.approvedAt ?? new Date();

  const row = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.squadId, squadId)))
    .then((rows) => rows[0] ?? null);

  if (!row) {
    logger.warn({ squadId, agentId, source, sourceId }, "hire hook: agent not found in squad, skipping");
    return;
  }

  const adapterType = row.adapterType ?? "process";
  const adapter = findActiveServerAdapter(adapterType);
  const onHireApproved = adapter?.onHireApproved;
  if (!onHireApproved) {
    return;
  }

  const payload: HireApprovedPayload = {
    squadId,
    agentId,
    agentName: row.name,
    adapterType,
    source,
    sourceId,
    approvedAt: approvedAt.toISOString(),
    message: HIRE_APPROVED_MESSAGE,
  };

  const adapterConfig =
    typeof row.adapterConfig === "object" && row.adapterConfig !== null && !Array.isArray(row.adapterConfig)
      ? (row.adapterConfig as Record<string, unknown>)
      : {};

  try {
    const result = await onHireApproved(payload, adapterConfig);
    if (result.ok) {
      await logActivity(db, {
        squadId,
        actorType: "system",
        actorId: "hire_hook",
        action: "hire_hook.succeeded",
        entityType: "agent",
        entityId: agentId,
        details: { source, sourceId, adapterType },
      });
      return;
    }

    logger.warn(
      { squadId, agentId, adapterType, source, sourceId, error: result.error, detail: result.detail },
      "hire hook: adapter returned failure",
    );
    await logActivity(db, {
      squadId,
      actorType: "system",
      actorId: "hire_hook",
      action: "hire_hook.failed",
      entityType: "agent",
      entityId: agentId,
      details: { source, sourceId, adapterType, error: result.error, detail: result.detail },
    });
  } catch (err) {
    logger.error(
      { err, squadId, agentId, adapterType, source, sourceId },
      "hire hook: adapter threw",
    );
    await logActivity(db, {
      squadId,
      actorType: "system",
      actorId: "hire_hook",
      action: "hire_hook.error",
      entityType: "agent",
      entityId: agentId,
      details: {
        source,
        sourceId,
        adapterType,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
