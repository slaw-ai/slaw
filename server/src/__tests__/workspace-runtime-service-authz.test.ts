import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  squads,
  createDb,
  executionWorkspaces,
  issues,
  projectWorkspaces,
  projects,
} from "@slaw/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  assertCanManageExecutionWorkspaceRuntimeServices,
  assertCanManageProjectWorkspaceRuntimeServices,
} from "../routes/workspace-runtime-service-authz.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres workspace runtime auth tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("workspace runtime service authz helper", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-workspace-runtime-authz-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(squads);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedSquad() {
    const squadId = randomUUID();
    await db.insert(squads).values({
      id: squadId,
      name: "Slaw",
      issuePrefix: `PAP-${squadId.slice(0, 8)}`,
      requireBoardApprovalForNewAgents: false,
    });
    return squadId;
  }

  async function seedProjectWorkspace(squadId: string) {
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      squadId,
      name: "Workspace authz",
      status: "in_progress",
    });
    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      squadId,
      projectId,
      name: "Primary",
      sourceType: "local_path",
      cwd: "/tmp/slaw-authz-project",
      isPrimary: true,
    });
    return { projectId, projectWorkspaceId };
  }

  async function seedExecutionWorkspace(squadId: string, projectId: string, projectWorkspaceId: string) {
    const executionWorkspaceId = randomUUID();
    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      squadId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Execution workspace",
      status: "active",
      providerType: "local_fs",
      cwd: "/tmp/slaw-authz-execution",
    });
    return executionWorkspaceId;
  }

  async function seedAgent(
    squadId: string,
    input: { role?: string; reportsTo?: string | null; name?: string } = {},
  ) {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      squadId,
      name: input.name ?? "Agent",
      role: input.role ?? "engineer",
      reportsTo: input.reportsTo ?? null,
    });
    return agentId;
  }

  it("allows board actors to manage project workspace runtime services", async () => {
    const squadId = await seedSquad();
    const { projectWorkspaceId } = await seedProjectWorkspace(squadId);

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "board",
        userId: "board-1",
        squadIds: [squadId],
        source: "session",
        isInstanceAdmin: false,
      },
    } as any, {
      squadId,
      projectWorkspaceId,
    })).resolves.toBeUndefined();
  });

  it("allows Squad Lead agents to manage any project workspace runtime services in their squad", async () => {
    const squadId = await seedSquad();
    const { projectWorkspaceId } = await seedProjectWorkspace(squadId);
    const ceoAgentId = await seedAgent(squadId, { role: "squad_lead", name: "Squad Lead" });

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId: ceoAgentId,
        squadId,
        source: "agent_key",
      },
    } as any, {
      squadId,
      projectWorkspaceId,
    })).resolves.toBeUndefined();
  });

  it("allows agents with a non-terminal assigned issue in the target project workspace", async () => {
    const squadId = await seedSquad();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(squadId);
    const agentId = await seedAgent(squadId, { name: "Engineer" });

    await db.insert(issues).values({
      id: randomUUID(),
      squadId,
      projectId,
      projectWorkspaceId,
      title: "Use this workspace",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId,
        squadId,
        source: "agent_key",
      },
    } as any, {
      squadId,
      projectWorkspaceId,
    })).resolves.toBeUndefined();
  });

  it("allows managers to manage execution workspace runtime services for their reporting subtree", async () => {
    const squadId = await seedSquad();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(squadId);
    const executionWorkspaceId = await seedExecutionWorkspace(squadId, projectId, projectWorkspaceId);
    const managerId = await seedAgent(squadId, { role: "cto", name: "Manager" });
    const reportId = await seedAgent(squadId, { reportsTo: managerId, name: "Report" });

    await db.insert(issues).values({
      id: randomUUID(),
      squadId,
      projectId,
      projectWorkspaceId,
      executionWorkspaceId,
      title: "Use execution workspace",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: reportId,
    });

    await expect(assertCanManageExecutionWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId: managerId,
        squadId,
        source: "agent_key",
      },
    } as any, {
      squadId,
      executionWorkspaceId,
    })).resolves.toBeUndefined();
  });

  it("rejects unrelated same-squad agents without matching workspace assignments", async () => {
    const squadId = await seedSquad();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(squadId);
    const executionWorkspaceId = await seedExecutionWorkspace(squadId, projectId, projectWorkspaceId);
    const assignedAgentId = await seedAgent(squadId, { name: "Assigned" });
    const unrelatedAgentId = await seedAgent(squadId, { name: "Unrelated" });

    await db.insert(issues).values({
      id: randomUUID(),
      squadId,
      projectId,
      projectWorkspaceId,
      executionWorkspaceId,
      title: "Assigned issue",
      status: "todo",
      priority: "medium",
      assigneeAgentId: assignedAgentId,
    });

    await expect(assertCanManageExecutionWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId: unrelatedAgentId,
        squadId,
        source: "agent_key",
      },
    } as any, {
      squadId,
      executionWorkspaceId,
    })).rejects.toMatchObject({
      status: 403,
      message: "Missing permission to manage workspace runtime services",
    });
  });

  it("rejects completed workspace assignments so stale issues do not keep access alive", async () => {
    const squadId = await seedSquad();
    const { projectId, projectWorkspaceId } = await seedProjectWorkspace(squadId);
    const agentId = await seedAgent(squadId, { name: "Engineer" });

    await db.insert(issues).values({
      id: randomUUID(),
      squadId,
      projectId,
      projectWorkspaceId,
      title: "Completed issue",
      status: "done",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    await expect(assertCanManageProjectWorkspaceRuntimeServices(db, {
      actor: {
        type: "agent",
        agentId,
        squadId,
        source: "agent_key",
      },
    } as any, {
      squadId,
      projectWorkspaceId,
    })).rejects.toMatchObject({
      status: 403,
      message: "Missing permission to manage workspace runtime services",
    });
  });
});
