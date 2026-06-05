import { describe, expect, it } from "vitest";
import {
  getRememberedPathOwnerSquadId,
  sanitizeRememberedPathForSquad,
} from "../lib/squad-page-memory";

const squads = [
  { id: "for", issuePrefix: "FOR" },
  { id: "pap", issuePrefix: "PAP" },
];

describe("getRememberedPathOwnerSquadId", () => {
  it("uses the route squad instead of stale selected-squad state for prefixed routes", () => {
    expect(
      getRememberedPathOwnerSquadId({
        squads,
        pathname: "/FOR/issues/FOR-1",
        fallbackSquadId: "pap",
      }),
    ).toBe("for");
  });

  it("skips saving when a prefixed route cannot yet be resolved to a known squad", () => {
    expect(
      getRememberedPathOwnerSquadId({
        squads: [],
        pathname: "/FOR/issues/FOR-1",
        fallbackSquadId: "pap",
      }),
    ).toBeNull();
  });

  it("falls back to the previous squad for unprefixed board routes", () => {
    expect(
      getRememberedPathOwnerSquadId({
        squads,
        pathname: "/dashboard",
        fallbackSquadId: "pap",
      }),
    ).toBe("pap");
  });

  it("treats unprefixed skills routes as board routes instead of squad prefixes", () => {
    expect(
      getRememberedPathOwnerSquadId({
        squads,
        pathname: "/skills/skill-123/files/SKILL.md",
        fallbackSquadId: "pap",
      }),
    ).toBe("pap");
  });
});

describe("sanitizeRememberedPathForSquad", () => {
  it("keeps remembered issue paths that belong to the target squad", () => {
    expect(
      sanitizeRememberedPathForSquad({
        path: "/issues/PAP-12",
        squadPrefix: "PAP",
      }),
    ).toBe("/issues/PAP-12");
  });

  it("falls back to dashboard for remembered issue identifiers from another squad", () => {
    expect(
      sanitizeRememberedPathForSquad({
        path: "/issues/FOR-1",
        squadPrefix: "PAP",
      }),
    ).toBe("/dashboard");
  });

  it("falls back to dashboard when no remembered path exists", () => {
    expect(
      sanitizeRememberedPathForSquad({
        path: null,
        squadPrefix: "PAP",
      }),
    ).toBe("/dashboard");
  });

  it("keeps remembered skills paths intact for the target squad", () => {
    expect(
      sanitizeRememberedPathForSquad({
        path: "/skills/skill-123/files/SKILL.md",
        squadPrefix: "PAP",
      }),
    ).toBe("/skills/skill-123/files/SKILL.md");
  });
});
