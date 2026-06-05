import { describe, expect, it } from "vitest";
import type { Squad } from "@slaw/shared";
import { assertDeleteConfirmation, resolveSquadForDeletion } from "../commands/client/squad.js";

function makeSquad(overrides: Partial<Squad>): Squad {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Alpha",
    description: null,
    status: "active",
    pauseReason: null,
    pausedAt: null,
    issuePrefix: "ALP",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    attachmentMaxBytes: 10 * 1024 * 1024,
    requireBoardApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    brandColor: null,
    logoAssetId: null,
    logoUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("resolveSquadForDeletion", () => {
  const squads: Squad[] = [
    makeSquad({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Alpha",
      issuePrefix: "ALP",
    }),
    makeSquad({
      id: "22222222-2222-2222-2222-222222222222",
      name: "Slaw",
      issuePrefix: "PAP",
    }),
  ];

  it("resolves by ID in auto mode", () => {
    const result = resolveSquadForDeletion(squads, "22222222-2222-2222-2222-222222222222", "auto");
    expect(result.issuePrefix).toBe("PAP");
  });

  it("resolves by prefix in auto mode", () => {
    const result = resolveSquadForDeletion(squads, "pap", "auto");
    expect(result.id).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("throws when selector is not found", () => {
    expect(() => resolveSquadForDeletion(squads, "MISSING", "auto")).toThrow(/No squad found/);
  });

  it("respects explicit id mode", () => {
    expect(() => resolveSquadForDeletion(squads, "PAP", "id")).toThrow(/No squad found by ID/);
  });

  it("respects explicit prefix mode", () => {
    expect(() => resolveSquadForDeletion(squads, "22222222-2222-2222-2222-222222222222", "prefix"))
      .toThrow(/No squad found by shortname/);
  });
});

describe("assertDeleteConfirmation", () => {
  const squad = makeSquad({
    id: "22222222-2222-2222-2222-222222222222",
    issuePrefix: "PAP",
  });

  it("requires --yes", () => {
    expect(() => assertDeleteConfirmation(squad, { confirm: "PAP" })).toThrow(/requires --yes/);
  });

  it("accepts matching prefix confirmation", () => {
    expect(() => assertDeleteConfirmation(squad, { yes: true, confirm: "pap" })).not.toThrow();
  });

  it("accepts matching id confirmation", () => {
    expect(() =>
      assertDeleteConfirmation(squad, {
        yes: true,
        confirm: "22222222-2222-2222-2222-222222222222",
      })).not.toThrow();
  });

  it("rejects mismatched confirmation", () => {
    expect(() => assertDeleteConfirmation(squad, { yes: true, confirm: "nope" }))
      .toThrow(/does not match target squad/);
  });
});
