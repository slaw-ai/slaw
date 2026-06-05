import { and, asc, gt, or, eq, sql } from "drizzle-orm";
import type { Db } from "@slaw/db";
import {
  squads,
  agents,
  projects,
  issues,
  costEvents,
  botfatherSyncState,
} from "@slaw/db";
import type {
  EntityUpsert,
  FactEvent,
  SyncRequest,
  HeartbeatRequest,
} from "@slaw/shared/botfather/protocol";
import type { BotfatherClient } from "./client.js";
import { BotfatherEnrollment } from "./enrollment.js";

const BATCH = 500;

interface CursorRow {
  entityType: string;
  lastSyncedAt: Date | null;
  lastSyncedId: string | null;
  sentCount: number;
}

/** Read all cursors into a map keyed by entityType. */
async function loadCursors(db: Db): Promise<Map<string, CursorRow>> {
  const rows = (await db.select().from(botfatherSyncState)) as CursorRow[];
  return new Map(rows.map((r) => [r.entityType, r]));
}

async function saveCursor(
  db: Db,
  entityType: string,
  lastSyncedAt: Date,
  lastSyncedId: string,
  added: number,
): Promise<void> {
  await db
    .insert(botfatherSyncState)
    .values({ entityType, lastSyncedAt, lastSyncedId, sentCount: added, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: botfatherSyncState.entityType,
      set: {
        lastSyncedAt,
        lastSyncedId,
        sentCount: sql`${botfatherSyncState.sentCount} + ${added}`,
        updatedAt: new Date(),
      },
    });
}

/** rows updated/created strictly after the cursor (updatedAt, id) tuple. */
function afterCursor(updatedAtCol: any, idCol: any, cur: CursorRow | undefined) {
  if (!cur?.lastSyncedAt) return undefined;
  const at = cur.lastSyncedAt;
  const id = cur.lastSyncedId ?? "";
  return or(gt(updatedAtCol, at), and(eq(updatedAtCol, at), gt(idCol, id)));
}

export interface ReporterDeps {
  db: Db;
  client: BotfatherClient;
  enrollment: BotfatherEnrollment;
  reportIssueTitles: boolean;
}

export interface ReportOutcome {
  upserts: number;
  facts: number;
  skipped?: "not-active" | "revoked" | "error";
}

export class BotfatherReporter {
  constructor(private readonly deps: ReporterDeps) {}

  /** Lightweight liveness + summary. */
  async heartbeat(): Promise<void> {
    const apiKey = this.deps.enrollment.apiKey;
    if (!apiKey) return;
    const { db } = this.deps;

    const [counts] = (await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM squads) AS squads,
        (SELECT count(*)::int FROM agents) AS agents,
        (SELECT count(*)::int FROM heartbeat_runs WHERE status IN ('running','queued')) AS active_runs,
        (SELECT count(*)::int FROM issues WHERE status NOT IN ('done','closed','completed','cancelled')) AS open_issues,
        (SELECT coalesce(sum(cost_cents),0)::int FROM cost_events WHERE occurred_at >= date_trunc('day', now() at time zone 'utc')) AS today_cents,
        (SELECT coalesce(sum(cost_cents),0)::int FROM cost_events WHERE occurred_at >= date_trunc('month', now() at time zone 'utc')) AS month_cents
    `)) as unknown as Array<{
      squads: number;
      agents: number;
      active_runs: number;
      open_issues: number;
      today_cents: number;
      month_cents: number;
    }>;

    const body: HeartbeatRequest = {
      protocolVersion: 1,
      sentAt: new Date().toISOString(),
      status: "ok",
      uptimeSec: Math.floor(process.uptime()),
      counts: {
        squads: counts?.squads ?? 0,
        agents: counts?.agents ?? 0,
        activeRuns: counts?.active_runs ?? 0,
        openIssues: counts?.open_issues ?? 0,
      },
      spend: { todayCents: counts?.today_cents ?? 0, monthCents: counts?.month_cents ?? 0 },
      lastEventCursor: null,
    };

    try {
      await this.deps.client.heartbeat(apiKey, body);
    } catch (err) {
      if (BotfatherEnrollment.isRevokedError(err)) this.deps.enrollment.onRevoked();
      throw err;
    }
  }

  /** Collect entity upserts + fact deltas above the cursor and sync them. */
  async sync(): Promise<ReportOutcome> {
    const apiKey = this.deps.enrollment.apiKey;
    if (!apiKey) return { upserts: 0, facts: 0, skipped: "not-active" };
    const { db, reportIssueTitles } = this.deps;
    const cursors = await loadCursors(db);

    const upserts: EntityUpsert[] = [];
    const facts: FactEvent[] = [];
    const advances: Array<{ type: string; at: Date; id: string }> = [];

    // ── entity upserts ──
    const squadRows = await db
      .select()
      .from(squads)
      .where(afterCursor(squads.updatedAt, squads.id, cursors.get("squad")))
      .orderBy(asc(squads.updatedAt), asc(squads.id))
      .limit(BATCH);
    for (const s of squadRows) {
      upserts.push({
        type: "squad",
        localId: s.id,
        name: s.name,
        status: s.status,
        budgetMonthlyCents: s.budgetMonthlyCents ?? null,
        spentMonthlyCents: s.spentMonthlyCents ?? 0,
        updatedAt: s.updatedAt.toISOString(),
      });
    }
    if (squadRows.length) {
      const last = squadRows[squadRows.length - 1];
      advances.push({ type: "squad", at: last.updatedAt, id: last.id });
    }

    const agentRows = await db
      .select()
      .from(agents)
      .where(afterCursor(agents.updatedAt, agents.id, cursors.get("agent")))
      .orderBy(asc(agents.updatedAt), asc(agents.id))
      .limit(BATCH);
    for (const a of agentRows) {
      upserts.push({
        type: "agent",
        localId: a.id,
        squadLocalId: a.squadId,
        name: a.name,
        role: a.role,
        status: a.status,
        adapterType: a.adapterType,
        budgetMonthlyCents: a.budgetMonthlyCents ?? null,
        spentMonthlyCents: a.spentMonthlyCents ?? 0,
        updatedAt: a.updatedAt.toISOString(),
      });
    }
    if (agentRows.length) {
      const last = agentRows[agentRows.length - 1];
      advances.push({ type: "agent", at: last.updatedAt, id: last.id });
    }

    const projectRows = await db
      .select()
      .from(projects)
      .where(afterCursor(projects.updatedAt, projects.id, cursors.get("project")))
      .orderBy(asc(projects.updatedAt), asc(projects.id))
      .limit(BATCH);
    for (const p of projectRows) {
      upserts.push({
        type: "project",
        localId: p.id,
        squadLocalId: p.squadId,
        name: p.name,
        status: p.status,
        updatedAt: p.updatedAt.toISOString(),
      });
    }
    if (projectRows.length) {
      const last = projectRows[projectRows.length - 1];
      advances.push({ type: "project", at: last.updatedAt, id: last.id });
    }

    const issueRows = await db
      .select()
      .from(issues)
      .where(afterCursor(issues.updatedAt, issues.id, cursors.get("issue")))
      .orderBy(asc(issues.updatedAt), asc(issues.id))
      .limit(BATCH);
    for (const i of issueRows) {
      upserts.push({
        type: "issue",
        localId: i.id,
        squadLocalId: i.squadId,
        projectLocalId: i.projectId ?? null,
        // redact title to the local id when reporting is disabled (§4.3)
        title: reportIssueTitles ? i.title : i.id,
        status: i.status,
        assigneeAgentLocalId: i.assigneeAgentId ?? null,
        updatedAt: i.updatedAt.toISOString(),
      });
    }
    if (issueRows.length) {
      const last = issueRows[issueRows.length - 1];
      advances.push({ type: "issue", at: last.updatedAt, id: last.id });
    }

    // ── cost facts (append-only; watermark on occurredAt,id) ──
    const costCursor = cursors.get("cost_event");
    const costRows = await db
      .select()
      .from(costEvents)
      .where(afterCursor(costEvents.occurredAt, costEvents.id, costCursor))
      .orderBy(asc(costEvents.occurredAt), asc(costEvents.id))
      .limit(BATCH);
    for (const c of costRows) {
      facts.push({
        type: "cost_event",
        localId: c.id,
        squadLocalId: c.squadId,
        agentLocalId: c.agentId ?? null,
        issueLocalId: c.issueId ?? null,
        projectLocalId: c.projectId ?? null,
        provider: c.provider,
        biller: c.biller ?? null,
        billingType: normalizeBillingType(c.billingType),
        model: c.model,
        inputTokens: c.inputTokens ?? 0,
        cachedInputTokens: c.cachedInputTokens ?? 0,
        outputTokens: c.outputTokens ?? 0,
        costCents: c.costCents,
        occurredAt: c.occurredAt.toISOString(),
      });
    }
    if (costRows.length) {
      const last = costRows[costRows.length - 1];
      advances.push({ type: "cost_event", at: last.occurredAt, id: last.id });
    }

    if (upserts.length === 0 && facts.length === 0) {
      return { upserts: 0, facts: 0 };
    }

    const batch: SyncRequest = {
      protocolVersion: 1,
      sentAt: new Date().toISOString(),
      batchCursor: `${Date.now()}-${advances.map((a) => a.id.slice(0, 4)).join("")}`,
      upserts,
      facts,
    };

    try {
      const res = await this.deps.client.sync(apiKey, batch);
      // only advance cursors after the tower acks
      for (const a of advances) {
        const added =
          a.type === "cost_event"
            ? costRows.length
            : a.type === "squad"
              ? squadRows.length
              : a.type === "agent"
                ? agentRows.length
                : a.type === "project"
                  ? projectRows.length
                  : issueRows.length;
        await saveCursor(db, a.type, a.at, a.id, added);
      }
      return { upserts: res.accepted.upserts, facts: res.accepted.facts };
    } catch (err) {
      if (BotfatherEnrollment.isRevokedError(err)) {
        this.deps.enrollment.onRevoked();
        return { upserts: 0, facts: 0, skipped: "revoked" };
      }
      throw err;
    }
  }
}

function normalizeBillingType(v: string): "metered_api" | "subscription_included" | "subscription_overage" {
  if (v === "subscription_included" || v === "subscription_overage") return v;
  return "metered_api";
}
