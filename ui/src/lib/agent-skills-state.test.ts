import { describe, expect, it } from "vitest";
import { applyAgentSkillSnapshot, isReadOnlyUnmanagedSkillEntry } from "./agent-skills-state";

describe("applyAgentSkillSnapshot", () => {
  it("hydrates the initial snapshot without arming autosave", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: [],
        lastSaved: [],
        hasHydratedSnapshot: false,
      },
      ["slaw", "para-memory-files"],
    );

    expect(result).toEqual({
      draft: ["slaw", "para-memory-files"],
      lastSaved: ["slaw", "para-memory-files"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: true,
    });
  });

  it("keeps unsaved local edits when a fresh snapshot arrives", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: ["slaw", "custom-skill"],
        lastSaved: ["slaw"],
        hasHydratedSnapshot: true,
      },
      ["slaw"],
    );

    expect(result).toEqual({
      draft: ["slaw", "custom-skill"],
      lastSaved: ["slaw"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: false,
    });
  });

  it("adopts server state after a successful save and skips the follow-up autosave pass", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: ["slaw", "custom-skill"],
        lastSaved: ["slaw", "custom-skill"],
        hasHydratedSnapshot: true,
      },
      ["slaw", "custom-skill"],
    );

    expect(result).toEqual({
      draft: ["slaw", "custom-skill"],
      lastSaved: ["slaw", "custom-skill"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: true,
    });
  });

  it("treats user-installed entries outside the squad library as read-only unmanaged skills", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "crack-python",
      runtimeName: "crack-python",
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
    }, new Set(["slaw"]))).toBe(true);
  });

  it("keeps squad-library entries in the managed section even when the adapter reports an external conflict", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "slaw",
      runtimeName: "slaw",
      desired: true,
      managed: false,
      state: "external",
      origin: "squad_managed",
    }, new Set(["slaw"]))).toBe(false);
  });

  it("falls back to legacy snapshots that only mark unmanaged external entries", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "legacy-external",
      runtimeName: "legacy-external",
      desired: false,
      managed: false,
      state: "external",
    }, new Set())).toBe(true);
  });
});
