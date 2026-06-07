import { createDb } from "./client.js";
import { squads, agents, goals, projects, issues } from "./schema/index.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const db = createDb(url);

console.log("Seeding database...");

const [squad] = await db
  .insert(squads)
  .values({
    name: "Slaw Demo Co",
    description: "A demo autonomous squad",
    status: "active",
    budgetMonthlyCents: 50000,
  })
  .returning();

const [squad_lead] = await db
  .insert(agents)
  .values({
    squadId: squad!.id,
    name: "Squad Lead Agent",
    role: "squad_lead",
    title: "Chief Executive Officer",
    status: "idle",
    adapterType: "process",
    adapterConfig: { command: "echo", args: ["hello from squad_lead"] },
    budgetMonthlyCents: 15000,
  })
  .returning();

const [engineer] = await db
  .insert(agents)
  .values({
    squadId: squad!.id,
    name: "Engineer Agent",
    role: "engineer",
    title: "Software Engineer",
    status: "idle",
    reportsTo: squad_lead!.id,
    adapterType: "process",
    adapterConfig: { command: "echo", args: ["hello from engineer"] },
    budgetMonthlyCents: 10000,
  })
  .returning();

const [goal] = await db
  .insert(goals)
  .values({
    squadId: squad!.id,
    title: "Ship V1",
    description: "Deliver first control plane release",
    level: "squad",
    status: "active",
    ownerAgentId: squad_lead!.id,
  })
  .returning();

const [project] = await db
  .insert(projects)
  .values({
    squadId: squad!.id,
    goalId: goal!.id,
    name: "Control Plane MVP",
    description: "Implement core operator + agent loop",
    status: "in_progress",
    leadAgentId: squad_lead!.id,
  })
  .returning();

await db.insert(issues).values([
  {
    squadId: squad!.id,
    projectId: project!.id,
    goalId: goal!.id,
    title: "Implement atomic task checkout",
    description: "Ensure in_progress claiming is conflict-safe",
    status: "todo",
    priority: "high",
    assigneeAgentId: engineer!.id,
    createdByAgentId: squad_lead!.id,
  },
  {
    squadId: squad!.id,
    projectId: project!.id,
    goalId: goal!.id,
    title: "Add budget auto-pause",
    description: "Pause agent at hard budget ceiling",
    status: "backlog",
    priority: "medium",
    createdByAgentId: squad_lead!.id,
  },
]);

console.log("Seed complete");
process.exit(0);
