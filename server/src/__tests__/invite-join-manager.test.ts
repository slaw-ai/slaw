import { describe, expect, it } from "vitest";
import { resolveJoinRequestAgentManagerId } from "../routes/access.js";

describe("resolveJoinRequestAgentManagerId", () => {
  it("returns null when no Squad Lead exists in the squad agent list", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "a1", role: "engineering_lead", reportsTo: null },
      { id: "a2", role: "engineer", reportsTo: "a1" },
    ]);

    expect(managerId).toBeNull();
  });

  it("selects the root Squad Lead when available", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "squad_lead-child", role: "squad_lead", reportsTo: "manager-1" },
      { id: "manager-1", role: "engineering_lead", reportsTo: null },
      { id: "squad_lead-root", role: "squad_lead", reportsTo: null },
    ]);

    expect(managerId).toBe("squad_lead-root");
  });

  it("falls back to the first Squad Lead when no root Squad Lead is present", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "squad_lead-1", role: "squad_lead", reportsTo: "mgr" },
      { id: "squad_lead-2", role: "squad_lead", reportsTo: "mgr" },
      { id: "mgr", role: "engineering_lead", reportsTo: null },
    ]);

    expect(managerId).toBe("squad_lead-1");
  });
});
