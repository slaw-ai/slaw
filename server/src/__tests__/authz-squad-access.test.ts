import { describe, expect, it } from "vitest";
import { assertBoardOrgAccess, assertSquadAccess, hasBoardOrgAccess } from "../routes/authz.js";

function makeReq(input: {
  method?: string;
  actor: Express.Request["actor"];
}) {
  return {
    method: input.method ?? "GET",
    actor: input.actor,
  } as Express.Request;
}

describe("assertSquadAccess", () => {
  it("allows viewer memberships to read", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        squadIds: ["squad-1"],
        memberships: [
          { squadId: "squad-1", membershipRole: "viewer", status: "active" },
        ],
      },
    });

    expect(() => assertSquadAccess(req, "squad-1")).not.toThrow();
  });

  it("rejects viewer memberships for writes", () => {
    const req = makeReq({
      method: "PATCH",
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        squadIds: ["squad-1"],
        memberships: [
          { squadId: "squad-1", membershipRole: "viewer", status: "active" },
        ],
      },
    });

    expect(() => assertSquadAccess(req, "squad-1")).toThrow("Viewer access is read-only");
  });

  it("rejects writes when membership details are present but omit the target squad", () => {
    const req = makeReq({
      method: "POST",
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        squadIds: ["squad-1"],
        memberships: [],
      },
    });

    expect(() => assertSquadAccess(req, "squad-1")).toThrow("User does not have active squad access");
  });

  it("allows legacy board actors that only provide squad ids", () => {
    const req = makeReq({
      method: "POST",
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        squadIds: ["squad-1"],
      },
    });

    expect(() => assertSquadAccess(req, "squad-1")).not.toThrow();
  });

  it("rejects signed-in instance admins without explicit squad access", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "board",
        userId: "admin-1",
        source: "session",
        isInstanceAdmin: true,
        squadIds: [],
        memberships: [],
      },
    });

    expect(() => assertSquadAccess(req, "squad-1")).toThrow("User does not have access to this squad");
  });

  it("allows local trusted board access without explicit membership", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "board",
        userId: "local-board",
        source: "local_implicit",
        isInstanceAdmin: true,
      },
    });

    expect(() => assertSquadAccess(req, "squad-1")).not.toThrow();
  });
});

describe("assertBoardOrgAccess", () => {
  it("allows signed-in board users with active squad access", () => {
    const req = makeReq({
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        squadIds: ["squad-1"],
        memberships: [{ squadId: "squad-1", membershipRole: "operator", status: "active" }],
        isInstanceAdmin: false,
      },
    });

    expect(hasBoardOrgAccess(req)).toBe(true);
    expect(() => assertBoardOrgAccess(req)).not.toThrow();
  });

  it("allows instance admins without squad memberships", () => {
    const req = makeReq({
      actor: {
        type: "board",
        userId: "admin-1",
        source: "session",
        squadIds: [],
        memberships: [],
        isInstanceAdmin: true,
      },
    });

    expect(hasBoardOrgAccess(req)).toBe(true);
    expect(() => assertBoardOrgAccess(req)).not.toThrow();
  });

  it("rejects signed-in users without squad access or instance admin rights", () => {
    const req = makeReq({
      actor: {
        type: "board",
        userId: "outsider-1",
        source: "session",
        squadIds: [],
        memberships: [],
        isInstanceAdmin: false,
      },
    });

    expect(hasBoardOrgAccess(req)).toBe(false);
    expect(() => assertBoardOrgAccess(req)).toThrow("Squad membership or instance admin access required");
  });
});
