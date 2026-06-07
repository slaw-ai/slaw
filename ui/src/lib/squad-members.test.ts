import { describe, expect, it } from "vitest";
import type { SquadMember, SquadUserDirectoryEntry } from "@/api/access";
import {
  buildSquadUserInlineOptions,
  buildSquadUserLabelMap,
  buildSquadUserProfileMap,
  buildMarkdownMentionOptions,
} from "./squad-members";

const activeMember = (overrides: Partial<SquadMember>): SquadMember => ({
  id: overrides.id ?? "member-1",
  squadId: overrides.squadId ?? "squad-1",
  principalType: "user",
  principalId: overrides.principalId ?? "user-1",
  status: overrides.status ?? "active",
  membershipRole: overrides.membershipRole ?? "operator",
  createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
  user: overrides.user === undefined
    ? { id: overrides.principalId ?? "user-1", name: "Taylor", email: "taylor@example.com", image: null }
    : overrides.user,
  grants: overrides.grants ?? [],
});

describe("squad-members helpers", () => {
  it("builds labels from squad member profiles", () => {
    const labels = buildSquadUserLabelMap([
      activeMember({ principalId: "user-1", user: { id: "user-1", name: "Taylor", email: "taylor@example.com", image: null } }),
      activeMember({ id: "member-2", principalId: "local-operator", user: null }),
    ]);

    expect(labels.get("user-1")).toBe("Taylor");
    expect(labels.get("local-operator")).toBe("Operator");
  });

  it("builds user profiles with labels and avatars", () => {
    const profiles = buildSquadUserProfileMap([
      activeMember({
        principalId: "user-1",
        user: { id: "user-1", name: "Taylor", email: "taylor@example.com", image: "https://example.com/taylor.png" },
      }),
      activeMember({ id: "member-2", principalId: "local-operator", user: null }),
    ]);

    expect(profiles.get("user-1")).toEqual({
      label: "Taylor",
      image: "https://example.com/taylor.png",
    });
    expect(profiles.get("local-operator")).toEqual({
      label: "Operator",
      image: null,
    });
  });

  it("builds inline options for active users and excludes requested ids", () => {
    const options = buildSquadUserInlineOptions([
      activeMember({ principalId: "user-1", user: { id: "user-1", name: "Taylor", email: "taylor@example.com", image: null } }),
      activeMember({ id: "member-2", principalId: "user-2", user: { id: "user-2", name: "Jordan", email: "jordan@example.com", image: null } }),
      activeMember({ id: "member-3", principalId: "user-3", status: "suspended" }),
    ], { excludeUserIds: ["user-1"] });

    expect(options).toEqual([
      {
        id: "user:user-2",
        label: "Jordan",
        searchText: "Jordan jordan@example.com user-2",
      },
    ]);
  });

  it("includes human users in markdown mention options", () => {
    const options = buildMarkdownMentionOptions({
      members: [activeMember({ principalId: "user-1", user: { id: "user-1", name: "Taylor", email: "taylor@example.com", image: null } })],
      agents: [{ id: "agent-1", name: "CodexCoder", status: "active", icon: "code" }],
      projects: [{ id: "project-1", name: "Slaw App", color: "#336699" }],
    });

    expect(options).toEqual([
      { id: "user:user-1", name: "Taylor", kind: "user", userId: "user-1" },
      { id: "agent:agent-1", name: "CodexCoder", kind: "agent", agentId: "agent-1", agentIcon: "code" },
      { id: "project:project-1", name: "Slaw App", kind: "project", projectId: "project-1", projectColor: "#336699" },
    ]);
  });

  it("accepts read-only directory entries for assignee and mention helpers", () => {
    const users: SquadUserDirectoryEntry[] = [
      {
        principalId: "user-1",
        status: "active",
        user: { id: "user-1", name: "Taylor", email: "taylor@example.com", image: null },
      },
    ];

    expect(buildSquadUserInlineOptions(users)).toEqual([
      {
        id: "user:user-1",
        label: "Taylor",
        searchText: "Taylor taylor@example.com user-1",
      },
    ]);
    expect(buildMarkdownMentionOptions({ members: users })).toEqual([
      { id: "user:user-1", name: "Taylor", kind: "user", userId: "user-1" },
    ]);
  });
});
