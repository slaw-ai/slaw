import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "@slaw-ai/plugin-sdk/testing";

import manifest from "./manifest.js";
import plugin from "./plugin.js";
import { ORIGIN_KIND, JOB_KEYS, MANAGED, WEBHOOK_KEYS } from "./constants.js";

const CONFIG = {
  jiraUrl: "https://acme.atlassian.net",
  jiraBoardId: "42",
  jiraUsername: "bot@acme.com",
  jiraApiTokenRef: "jira-token",
  targetSquadId: "squad-1",
  syncStatusBack: false,
};

const JIRA_ISSUE = {
  id: "10001",
  key: "ENG-7",
  fields: {
    summary: "Fix checkout bug",
    description: "Cart total is wrong",
    priority: { name: "High" },
    status: { name: "To Do", statusCategory: { name: "To Do" } },
    issuetype: { name: "Bug" },
  },
};

describe("jira-sync manifest", () => {
  it("declares a managed agent and routine wired together", () => {
    expect(manifest.id).toBe("slaw.jira-sync");
    const agent = manifest.agents?.find((a) => a.agentKey === MANAGED.agentKey);
    expect(agent).toBeDefined();
    const routine = manifest.routines?.find((r) => r.routineKey === MANAGED.routineKey);
    expect(routine?.assigneeRef).toEqual({ resourceKind: "agent", resourceKey: MANAGED.agentKey });
    expect(routine?.triggers?.[0]?.cronExpression).toBe("0 * * * *");
  });

  it("requests the capabilities the worker uses", () => {
    for (const cap of [
      "issues.create",
      "issue.comments.create",
      "events.subscribe",
      "jobs.schedule",
      "webhooks.receive",
      "http.outbound",
      "secrets.read-ref",
      "database.namespace.migrate",
      "agents.managed",
      "routines.managed",
    ]) {
      expect(manifest.capabilities).toContain(cap);
    }
  });

  it("uses an originKind under its own plugin namespace", () => {
    expect(ORIGIN_KIND.startsWith(`plugin:${manifest.id}:`)).toBe(true);
  });
});

describe("jira-sync inbound (Jira → Slaw)", () => {
  it("creates a Slaw issue from a Jira webhook with origin metadata", async () => {
    const harness = createTestHarness({ manifest, config: CONFIG });
    harness.seed({ squads: [{ id: "squad-1" } as never] });
    await plugin.definition.setup(harness.ctx);

    await plugin.definition.onWebhook?.({
      endpointKey: WEBHOOK_KEYS.jiraEvent,
      headers: {},
      rawBody: JSON.stringify({ webhookEvent: "jira:issue_created", issue: JIRA_ISSUE }),
      parsedBody: { webhookEvent: "jira:issue_created", issue: JIRA_ISSUE },
      requestId: "req-1",
    });

    const created = await harness.ctx.issues.list({ squadId: "squad-1" });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      title: "[ENG-7] Fix checkout bug",
      priority: "high",
      status: "todo",
      originKind: ORIGIN_KIND,
      originId: "ENG-7",
    });

    // Mapping inserted + activity logged.
    expect(harness.dbExecutes.some((e) => /INSERT INTO .*jira_issue_mappings/i.test(e.sql))).toBe(true);
    expect(harness.activity.some((a) => a.message.includes("ENG-7"))).toBe(true);
  });

  it("runs the full-sync job handler without throwing on an empty board", async () => {
    const harness = createTestHarness({ manifest, config: CONFIG });
    await plugin.definition.setup(harness.ctx);
    // No real Jira server; stub the board fetch to return no issues.
    const originalFetch = harness.ctx.http.fetch;
    harness.ctx.http.fetch = (async () =>
      new Response(JSON.stringify({ issues: [], total: 0 }), { status: 200 })) as typeof originalFetch;

    await harness.runJob(JOB_KEYS.fullSync);

    const state = harness.getState({
      scopeKind: "instance",
      namespace: "jira-sync",
      stateKey: "last-full-sync",
    });
    expect(state).toMatchObject({ total: 0, created: 0, skipped: 0 });
  });
});

describe("jira-sync webhook signature verification (H2)", () => {
  const SECRET_REF = "jira-wh-secret";
  // The test harness resolves a secret ref to `resolved:<ref>`.
  const RESOLVED_SECRET = `resolved:${SECRET_REF}`;
  const SIGNED_CONFIG = { ...CONFIG, webhookSecretRef: SECRET_REF };
  const PAYLOAD = JSON.stringify({ webhookEvent: "jira:issue_created", issue: JIRA_ISSUE });

  const sign = (body: string, secret = RESOLVED_SECRET) =>
    "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

  it("rejects a delivery with no signature when a secret is configured", async () => {
    const harness = createTestHarness({ manifest, config: SIGNED_CONFIG });
    harness.seed({ squads: [{ id: "squad-1" } as never] });
    await plugin.definition.setup(harness.ctx);

    await expect(
      plugin.definition.onWebhook?.({
        endpointKey: WEBHOOK_KEYS.jiraEvent,
        headers: {},
        rawBody: PAYLOAD,
        parsedBody: JSON.parse(PAYLOAD),
        requestId: "req-nosig",
      }),
    ).rejects.toThrow(/signature/i);

    const created = await harness.ctx.issues.list({ squadId: "squad-1" });
    expect(created).toHaveLength(0);
  });

  it("rejects a forged signature", async () => {
    const harness = createTestHarness({ manifest, config: SIGNED_CONFIG });
    harness.seed({ squads: [{ id: "squad-1" } as never] });
    await plugin.definition.setup(harness.ctx);

    await expect(
      plugin.definition.onWebhook?.({
        endpointKey: WEBHOOK_KEYS.jiraEvent,
        headers: { "x-hub-signature": sign(PAYLOAD, "wrong-secret") },
        rawBody: PAYLOAD,
        parsedBody: JSON.parse(PAYLOAD),
        requestId: "req-forged",
      }),
    ).rejects.toThrow(/signature/i);

    const created = await harness.ctx.issues.list({ squadId: "squad-1" });
    expect(created).toHaveLength(0);
  });

  it("accepts a correctly-signed delivery", async () => {
    const harness = createTestHarness({ manifest, config: SIGNED_CONFIG });
    harness.seed({ squads: [{ id: "squad-1" } as never] });
    await plugin.definition.setup(harness.ctx);

    await plugin.definition.onWebhook?.({
      endpointKey: WEBHOOK_KEYS.jiraEvent,
      headers: { "x-hub-signature": sign(PAYLOAD) },
      rawBody: PAYLOAD,
      parsedBody: JSON.parse(PAYLOAD),
      requestId: "req-signed",
    });

    const created = await harness.ctx.issues.list({ squadId: "squad-1" });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ originId: "ENG-7" });
  });

  it("does not require a signature when no secret is configured (back-compat)", async () => {
    const harness = createTestHarness({ manifest, config: CONFIG });
    harness.seed({ squads: [{ id: "squad-1" } as never] });
    await plugin.definition.setup(harness.ctx);

    await plugin.definition.onWebhook?.({
      endpointKey: WEBHOOK_KEYS.jiraEvent,
      headers: {},
      rawBody: PAYLOAD,
      parsedBody: JSON.parse(PAYLOAD),
      requestId: "req-unsigned-ok",
    });

    const created = await harness.ctx.issues.list({ squadId: "squad-1" });
    expect(created).toHaveLength(1);
  });
});
