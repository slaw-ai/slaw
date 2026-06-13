// VENDORED from slaw-botfather/packages/protocol/src/index.ts — keep in sync with the tower.
// The wire contract must match the botfather server's @slaw-ai/botfather-protocol package.

/**
 * @slaw-ai/botfather-protocol — the single source of truth for the
 * instance ⇄ botfather wire contract. Consumed by both the SLAW
 * reporter and the botfather ingest API.
 *
 * Versioning: botfather accepts PROTOCOL_VERSION and PROTOCOL_VERSION - 1.
 * Older instances receive HTTP 426 with a human-readable reason.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

/* ────────────────────────── identity ────────────────────────── */

export const instanceIdentitySchema = z.object({
  machineId: z.string().min(8).max(128),
  instanceId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(64),
  hostname: z.string().min(1).max(255),
  os: z.enum(["darwin", "linux", "win32"]),
  slawVersion: z.string().max(32),
});
export type InstanceIdentity = z.infer<typeof instanceIdentitySchema>;

/* ────────────────────────── enrollment ────────────────────────── */

export const enrollmentStateSchema = z.enum([
  "pending",
  "active",
  "rejected",
  "revoked",
]);
export type EnrollmentState = z.infer<typeof enrollmentStateSchema>;

/** POST /api/ingest/v1/enroll — token-less self-enrollment */
export const enrollRequestSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  instance: instanceIdentitySchema,
  capabilities: z
    .object({
      reportIssueTitles: z.boolean().default(true),
      liveStream: z.boolean().default(false),
    })
    .default({}),
  /**
   * Optional pre-shared enrollment secret. Sent when the tower is configured
   * with a secret; omitted otherwise. Back-compat with secret-less towers.
   */
  enrollmentSecret: z.string().max(512).optional(),
});
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;

export const enrollResponseSchema = z.object({
  enrollmentId: z.string().uuid(),
  state: enrollmentStateSchema,
  /** present only when state === "active" (auto-approve rule matched) */
  apiKey: z.string().optional(),
  pollIntervalSec: z.number().int().positive().default(10),
});
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;

/** POST /api/ingest/v1/enroll/poll */
export const enrollPollRequestSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  enrollmentId: z.string().uuid(),
});
export type EnrollPollRequest = z.infer<typeof enrollPollRequestSchema>;

export const enrollPollResponseSchema = z.object({
  state: enrollmentStateSchema,
  apiKey: z.string().optional(),
  pollIntervalSec: z.number().int().positive().default(10),
});
export type EnrollPollResponse = z.infer<typeof enrollPollResponseSchema>;

/* ────────────────────────── budget limits (tower-governed) ────────────── */

/**
 * A centrally-governed budget limit pushed from the tower to an instance.
 * Plan-aware: enforce on COST (cents) for metered/API runs, and on TOKENS for
 * subscription runs (where cost is ~$0). Either ceiling may be null (no cap on
 * that metric). The instance de-dupes pushes by `version` (monotonic).
 */
export const limitSpecSchema = z.object({
  costLimitCents: z.number().int().nonnegative().nullable(),
  tokenLimit: z.number().int().nonnegative().nullable(),
  window: z.enum(["calendar_month_utc"]).default("calendar_month_utc"),
  warnPercent: z.number().int().min(1).max(100).default(80),
  mode: z.enum(["off", "soft", "hard"]).default("soft"),
  /** monotonic; the instance applies a push only when version > the stored one */
  version: z.number().int().nonnegative(),
});
export type LimitSpec = z.infer<typeof limitSpecSchema>;

/* ────────────────────────── skill registry (tower-mastered) ───────────── */

/**
 * Botfather is the master skill registry. Skills are authored centrally and
 * propagate tower → instance (the body flows DOWN). The instance pulls the
 * catalog (descriptors) and then per-skill content for skills a user installs
 * onto a local squad. The fleet-wide `catalogVersion` lets the instance detect
 * "the catalog changed" cheaply; each skill carries its own monotonic version.
 */

/** Two-axis classification + free tags carried alongside each skill.
 * Optional/defaulted so older towers (pre-metadata) still validate. */
export const skillMetadataSchema = z
  .object({
    layer: z.string().max(64).optional(),
    discipline: z.string().max(64).optional(),
    tags: z.array(z.string().max(64)).optional(),
  })
  .passthrough();
export type SkillMetadata = z.infer<typeof skillMetadataSchema>;

/** Lightweight descriptor returned by the catalog list (no markdown body). */
export const skillCatalogEntrySchema = z.object({
  key: z.string().min(1).max(255),
  slug: z.string().max(255),
  name: z.string().max(255),
  description: z.string().max(2_000).nullable(),
  category: z.string().max(64).nullable(),
  trustLevel: z.string().max(64),
  version: z.number().int().positive(),
  contentHash: z.string().max(128),
  hasFiles: z.boolean().default(false),
  metadata: skillMetadataSchema.optional(),
  updatedAt: z.string().datetime(),
});
export type SkillCatalogEntry = z.infer<typeof skillCatalogEntrySchema>;

/** GET /api/ingest/v1/skills — the full published catalog (descriptors only). */
export const skillCatalogResponseSchema = z.object({
  catalogVersion: z.number().int().nonnegative(),
  skills: z.array(skillCatalogEntrySchema).default([]),
});
export type SkillCatalogResponse = z.infer<typeof skillCatalogResponseSchema>;

/** One file beyond the canonical .md. */
export const skillFileSchema = z.object({
  path: z.string().min(1).max(1024),
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});
export type SkillFile = z.infer<typeof skillFileSchema>;

/** GET /api/ingest/v1/skills/:key — full content for one skill (pulled on install/update). */
export const skillContentResponseSchema = z.object({
  key: z.string().min(1).max(255),
  slug: z.string().max(255),
  name: z.string().max(255),
  description: z.string().max(2_000).nullable(),
  category: z.string().max(64).nullable(),
  trustLevel: z.string().max(64),
  version: z.number().int().positive(),
  contentHash: z.string().max(128),
  markdown: z.string(),
  files: z.array(skillFileSchema).default([]),
  metadata: skillMetadataSchema.optional(),
});
export type SkillContentResponse = z.infer<typeof skillContentResponseSchema>;

/* ────────────────────────── directives (tower → instance back-channel) ── */

export const directiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set_sync_interval"), seconds: z.number().int().min(10).max(3600) }),
  z.object({ kind: z.literal("request_reconciliation") }),
  z.object({ kind: z.literal("request_live_stream"), durationSec: z.number().int().positive() }),
  z.object({ kind: z.literal("stop_live_stream") }),
  // Push (or clear, with mode:"off") the effective budget limit for this instance.
  z.object({ kind: z.literal("set_limits"), limit: limitSpecSchema }),
  // HINT only (no body): the skill catalog advanced; pull at your leisure.
  z.object({ kind: z.literal("skills_updated"), catalogVersion: z.number().int().nonnegative() }),
]);
export type Directive = z.infer<typeof directiveSchema>;

/* ────────────────────────── heartbeat ────────────────────────── */

export const heartbeatRequestSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sentAt: z.string().datetime(),
  status: z.enum(["ok", "degraded"]),
  uptimeSec: z.number().int().nonnegative(),
  counts: z.object({
    squads: z.number().int().nonnegative(),
    agents: z.number().int().nonnegative(),
    activeRuns: z.number().int().nonnegative(),
    openIssues: z.number().int().nonnegative(),
  }),
  spend: z.object({
    todayCents: z.number().int().nonnegative(),
    monthCents: z.number().int().nonnegative(),
  }),
  lastEventCursor: z.string().nullable(),
  /** version of the budget limit the instance has currently applied (de-dupe) */
  appliedLimitVersion: z.number().int().nonnegative().optional(),
  /** catalog version the instance has last seen/pulled (observability; never forced) */
  appliedSkillCatalogVersion: z.number().int().nonnegative().optional(),
});
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

export const heartbeatResponseSchema = z.object({
  acknowledged: z.literal(true),
  directives: z.array(directiveSchema).default([]),
});
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;

/* ────────────────────────── sync: entity upserts ────────────────────────── */

const cents = z.number().int().nonnegative();
const localId = z.string().min(1).max(64);

export const squadUpsertSchema = z.object({
  type: z.literal("squad"),
  localId,
  name: z.string().max(255),
  status: z.string().max(32),
  budgetMonthlyCents: cents.nullable(),
  spentMonthlyCents: cents,
  updatedAt: z.string().datetime(),
});

export const agentUpsertSchema = z.object({
  type: z.literal("agent"),
  localId,
  squadLocalId: localId,
  name: z.string().max(255),
  role: z.string().max(64),
  status: z.string().max(32),
  adapterType: z.string().max(64),
  budgetMonthlyCents: cents.nullable(),
  spentMonthlyCents: cents,
  /** display title / job title (metadata, read-only) */
  title: z.string().max(255).nullable().optional(),
  /** free-text persona / operating instructions for the agent (metadata, read-only) */
  capabilities: z.string().max(20_000).nullable().optional(),
  /** localId of the agent this one reports to, if any */
  reportsToLocalId: localId.nullable().optional(),
  updatedAt: z.string().datetime(),
});

/**
 * Skills are squad-scoped in SLAW (one library per squad). Metadata only —
 * the skill markdown body itself is NOT synced to the tower, just its descriptor.
 */
export const squadSkillUpsertSchema = z.object({
  type: z.literal("squad_skill"),
  localId,
  squadLocalId: localId,
  key: z.string().max(255),
  name: z.string().max(255),
  description: z.string().max(2_000).nullable().optional(),
  sourceType: z.string().max(64),
  trustLevel: z.string().max(64),
  updatedAt: z.string().datetime(),
});

export const projectUpsertSchema = z.object({
  type: z.literal("project"),
  localId,
  squadLocalId: localId,
  name: z.string().max(255),
  status: z.string().max(32),
  updatedAt: z.string().datetime(),
});

export const issueUpsertSchema = z.object({
  type: z.literal("issue"),
  localId,
  squadLocalId: localId,
  projectLocalId: localId.nullable(),
  /** title may be redacted to the issue key when reportIssueTitles=false */
  title: z.string().max(500),
  status: z.string().max(32),
  assigneeAgentLocalId: localId.nullable(),
  updatedAt: z.string().datetime(),
});

export const entityUpsertSchema = z.discriminatedUnion("type", [
  squadUpsertSchema,
  agentUpsertSchema,
  squadSkillUpsertSchema,
  projectUpsertSchema,
  issueUpsertSchema,
]);
export type EntityUpsert = z.infer<typeof entityUpsertSchema>;

/* ────────────────────────── sync: fact events (append-only) ─────────────── */

export const costFactSchema = z.object({
  type: z.literal("cost_event"),
  localId,
  squadLocalId: localId,
  agentLocalId: localId.nullable(),
  issueLocalId: localId.nullable(),
  projectLocalId: localId.nullable(),
  provider: z.string().max(64),
  biller: z.string().max(64).nullable(),
  billingType: z.enum(["metered_api", "subscription_included", "subscription_overage"]),
  model: z.string().max(128),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costCents: cents,
  occurredAt: z.string().datetime(),
});

export const runFactSchema = z.object({
  type: z.literal("run_event"),
  localId,
  agentLocalId: localId,
  squadLocalId: localId,
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  occurredAt: z.string().datetime(),
});

/** Whitelisted activity_log actions — anything else is rejected at the schema. */
export const activityActionSchema = z.enum([
  "agent.created",
  "agent.deleted",
  "squad.created",
  "cost.reported",
  "budget_soft_threshold_crossed",
  "budget_hard_threshold_crossed",
  "squad.budget_updated",
  "agent.budget_updated",
]);

export const activityFactSchema = z.object({
  type: z.literal("activity_event"),
  localId,
  squadLocalId: localId.nullable(),
  action: activityActionSchema,
  entityRef: z.string().max(255).nullable(),
  /** details filtered through per-action allowlist on the instance side */
  details: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  occurredAt: z.string().datetime(),
});

export const factEventSchema = z.discriminatedUnion("type", [
  costFactSchema,
  runFactSchema,
  activityFactSchema,
]);
export type FactEvent = z.infer<typeof factEventSchema>;

/* ────────────────────────── sync envelope ────────────────────────── */

export const syncRequestSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sentAt: z.string().datetime(),
  /** monotonically increasing cursor the instance proposes for this batch */
  batchCursor: z.string().min(1).max(128),
  upserts: z.array(entityUpsertSchema).max(2000).default([]),
  facts: z.array(factEventSchema).max(5000).default([]),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export const syncResponseSchema = z.object({
  acknowledgedCursor: z.string(),
  accepted: z.object({
    upserts: z.number().int().nonnegative(),
    facts: z.number().int().nonnegative(),
    deduplicated: z.number().int().nonnegative(),
  }),
  directives: z.array(directiveSchema).default([]),
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;

/* ────────────────────────── live stream (phase 2) ────────────────────────── */

/**
 * Instance opens an OUTBOUND WebSocket to wss://botfather/api/ingest/v1/live
 * (ARCHITECTURE §4.4) only while an admin has a drill-down open. The instance
 * first sends a hello frame to authenticate, then streams fact events live.
 */
export const liveHelloSchema = z.object({
  type: z.literal("hello"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  apiKey: z.string(),
});
export type LiveHello = z.infer<typeof liveHelloSchema>;

export const liveFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fact"), event: factEventSchema }),
  z.object({ type: z.literal("ping") }),
]);
export type LiveFrame = z.infer<typeof liveFrameSchema>;

/** Server → instance acknowledgement of a successful hello. */
export const liveAckSchema = z.object({ type: z.literal("ack"), subscribed: z.boolean() });
export type LiveAck = z.infer<typeof liveAckSchema>;

/* ────────────────────────── reconciliation ────────────────────────── */

/**
 * POST /api/ingest/v1/manifest — nightly self-heal (ARCHITECTURE §4.5).
 * Instance reports per-entity-type counts; botfather compares against its
 * own view and asks for a full resync of any divergent type.
 */
export const manifestRequestSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sentAt: z.string().datetime(),
  counts: z.object({
    squads: z.number().int().nonnegative(),
    agents: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    issues: z.number().int().nonnegative(),
    costEvents: z.number().int().nonnegative(),
  }),
});
export type ManifestRequest = z.infer<typeof manifestRequestSchema>;

export const manifestResponseSchema = z.object({
  inSync: z.boolean(),
  /** entity types where botfather's count disagrees → instance should full-resync */
  resyncTypes: z.array(z.enum(["squad", "agent", "project", "issue", "cost_event"])),
});
export type ManifestResponse = z.infer<typeof manifestResponseSchema>;

/* ────────────────────────── errors ────────────────────────── */

export const protocolErrorSchema = z.object({
  error: z.string(),
  code: z.enum([
    "protocol_version_unsupported",
    "invalid_payload",
    "unauthorized",
    "enrollment_not_found",
    "enrollment_rejected",
    "enrollment_revoked",
    "rate_limited",
  ]),
});
export type ProtocolError = z.infer<typeof protocolErrorSchema>;
