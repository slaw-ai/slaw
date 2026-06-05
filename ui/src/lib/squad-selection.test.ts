import { describe, expect, it } from "vitest";
import { shouldSyncSquadSelectionFromRoute } from "./squad-selection";

describe("shouldSyncSquadSelectionFromRoute", () => {
  it("does not resync when selection already matches the route", () => {
    expect(
      shouldSyncSquadSelectionFromRoute({
        selectionSource: "route_sync",
        selectedSquadId: "pap",
        routeSquadId: "pap",
      }),
    ).toBe(false);
  });

  it("defers route sync while a manual squad switch is in flight", () => {
    expect(
      shouldSyncSquadSelectionFromRoute({
        selectionSource: "manual",
        selectedSquadId: "pap",
        routeSquadId: "ret",
      }),
    ).toBe(false);
  });

  it("syncs back to the route squad for non-manual mismatches", () => {
    expect(
      shouldSyncSquadSelectionFromRoute({
        selectionSource: "route_sync",
        selectedSquadId: "pap",
        routeSquadId: "ret",
      }),
    ).toBe(true);
  });
});
