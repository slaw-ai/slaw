import { describe, expect, it } from "vitest";
import {
  applySquadPrefix,
  extractSquadPrefixFromPath,
  isOperatorPathWithoutPrefix,
  toSquadRelativePath,
} from "./squad-routes";

describe("squad routes", () => {
  it("treats execution workspace paths as operator routes that need a squad prefix", () => {
    expect(isOperatorPathWithoutPrefix("/execution-workspaces/workspace-123")).toBe(true);
    expect(isOperatorPathWithoutPrefix("/execution-workspaces/workspace-123/routines")).toBe(true);
    expect(extractSquadPrefixFromPath("/execution-workspaces/workspace-123")).toBeNull();
    expect(applySquadPrefix("/execution-workspaces/workspace-123", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123",
    );
    expect(applySquadPrefix("/execution-workspaces/workspace-123/routines", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123/routines",
    );
  });

  it("normalizes prefixed execution workspace paths back to squad-relative paths", () => {
    expect(toSquadRelativePath("/PAP/execution-workspaces/workspace-123")).toBe(
      "/execution-workspaces/workspace-123",
    );
    expect(toSquadRelativePath("/PAP/execution-workspaces/workspace-123/routines")).toBe(
      "/execution-workspaces/workspace-123/routines",
    );
  });

  it("treats /search as a operator route that needs a squad prefix", () => {
    expect(isOperatorPathWithoutPrefix("/search")).toBe(true);
    expect(extractSquadPrefixFromPath("/search")).toBeNull();
    expect(applySquadPrefix("/search", "PAP")).toBe("/PAP/search");
    expect(applySquadPrefix("/search?q=hello%20world", "PAP")).toBe("/PAP/search?q=hello%20world");
    expect(toSquadRelativePath("/PAP/search?q=foo")).toBe("/search?q=foo");
  });
});
