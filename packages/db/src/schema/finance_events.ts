import { pgTable, uuid, text, timestamp, integer, index, boolean, jsonb } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { goals } from "./goals.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { costEvents } from "./cost_events.js";

export const financeEvents = pgTable(
  "finance_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    agentId: uuid("agent_id").references(() => agents.id),
    issueId: uuid("issue_id").references(() => issues.id),
    projectId: uuid("project_id").references(() => projects.id),
    goalId: uuid("goal_id").references(() => goals.id),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id),
    costEventId: uuid("cost_event_id").references(() => costEvents.id),
    billingCode: text("billing_code"),
    description: text("description"),
    eventKind: text("event_kind").notNull(),
    direction: text("direction").notNull().default("debit"),
    biller: text("biller").notNull(),
    provider: text("provider"),
    executionAdapterType: text("execution_adapter_type"),
    pricingTier: text("pricing_tier"),
    region: text("region"),
    model: text("model"),
    quantity: integer("quantity"),
    unit: text("unit"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    estimated: boolean("estimated").notNull().default(false),
    externalInvoiceId: text("external_invoice_id"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadOccurredIdx: index("finance_events_squad_occurred_idx").on(table.squadId, table.occurredAt),
    squadBillerOccurredIdx: index("finance_events_squad_biller_occurred_idx").on(
      table.squadId,
      table.biller,
      table.occurredAt,
    ),
    squadKindOccurredIdx: index("finance_events_squad_kind_occurred_idx").on(
      table.squadId,
      table.eventKind,
      table.occurredAt,
    ),
    squadDirectionOccurredIdx: index("finance_events_squad_direction_occurred_idx").on(
      table.squadId,
      table.direction,
      table.occurredAt,
    ),
    squadHeartbeatRunIdx: index("finance_events_squad_heartbeat_run_idx").on(
      table.squadId,
      table.heartbeatRunId,
    ),
    squadCostEventIdx: index("finance_events_squad_cost_event_idx").on(
      table.squadId,
      table.costEventId,
    ),
  }),
);
