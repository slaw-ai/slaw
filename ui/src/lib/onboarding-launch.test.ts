import { describe, expect, it } from "vitest";
import {
  buildOnboardingIssuePayload,
  buildOnboardingProjectPayload,
  selectDefaultSquadGoalId,
} from "./onboarding-launch";

describe("selectDefaultSquadGoalId", () => {
  it("prefers the earliest active root squad goal", () => {
    expect(
      selectDefaultSquadGoalId([
        {
          id: "team-goal",
          squadId: "squad-1",
          title: "Nested",
          description: null,
          level: "team",
          status: "active",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-04T00:00:00Z"),
          updatedAt: new Date("2026-03-04T00:00:00Z"),
        },
        {
          id: "goal-2",
          squadId: "squad-1",
          title: "Later active root",
          description: null,
          level: "squad",
          status: "active",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-03T00:00:00Z"),
          updatedAt: new Date("2026-03-03T00:00:00Z"),
        },
        {
          id: "goal-1",
          squadId: "squad-1",
          title: "Earliest active root",
          description: null,
          level: "squad",
          status: "active",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-02T00:00:00Z"),
          updatedAt: new Date("2026-03-02T00:00:00Z"),
        },
      ]),
    ).toBe("goal-1");
  });

  it("falls back to the earliest root squad goal when none are active", () => {
    expect(
      selectDefaultSquadGoalId([
        {
          id: "goal-2",
          squadId: "squad-1",
          title: "Cancelled root",
          description: null,
          level: "squad",
          status: "cancelled",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-03T00:00:00Z"),
          updatedAt: new Date("2026-03-03T00:00:00Z"),
        },
        {
          id: "goal-1",
          squadId: "squad-1",
          title: "Earliest root",
          description: null,
          level: "squad",
          status: "planned",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-02T00:00:00Z"),
          updatedAt: new Date("2026-03-02T00:00:00Z"),
        },
      ]),
    ).toBe("goal-1");
  });
});

describe("onboarding launch payloads", () => {
  it("links the onboarding project and first issue to the selected goal", () => {
    expect(buildOnboardingProjectPayload("goal-1")).toEqual({
      name: "Onboarding",
      status: "in_progress",
      goalIds: ["goal-1"],
    });

    expect(
      buildOnboardingIssuePayload({
        title: "  Hire your first engineer  ",
        description: "  Kick off the hiring plan  ",
        assigneeAgentId: "agent-1",
        projectId: "project-1",
        goalId: "goal-1",
      }),
    ).toEqual({
      title: "Hire your first engineer",
      description: "Kick off the hiring plan",
      assigneeAgentId: "agent-1",
      projectId: "project-1",
      goalId: "goal-1",
      status: "todo",
    });
  });

  it("omits goal links when no default squad goal exists", () => {
    expect(buildOnboardingProjectPayload(null)).toEqual({
      name: "Onboarding",
      status: "in_progress",
    });

    expect(
      buildOnboardingIssuePayload({
        title: "Task",
        description: "",
        assigneeAgentId: "agent-1",
        projectId: "project-1",
        goalId: null,
      }),
    ).toEqual({
      title: "Task",
      assigneeAgentId: "agent-1",
      projectId: "project-1",
      status: "todo",
    });
  });
});
