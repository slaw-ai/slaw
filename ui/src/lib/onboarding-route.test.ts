import { describe, expect, it } from "vitest";
import {
  isOnboardingPath,
  resolveRouteOnboardingOptions,
  shouldRedirectSquadlessRouteToOnboarding,
} from "./onboarding-route";

describe("isOnboardingPath", () => {
  it("matches the global onboarding route", () => {
    expect(isOnboardingPath("/onboarding")).toBe(true);
  });

  it("matches a squad-prefixed onboarding route", () => {
    expect(isOnboardingPath("/pap/onboarding")).toBe(true);
  });

  it("ignores non-onboarding routes", () => {
    expect(isOnboardingPath("/pap/dashboard")).toBe(false);
  });
});

describe("resolveRouteOnboardingOptions", () => {
  it("opens squad creation for the global onboarding route", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/onboarding",
        squads: [],
      }),
    ).toEqual({ initialStep: 1 });
  });

  it("opens agent creation when the prefixed squad exists", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/pap/onboarding",
        squadPrefix: "pap",
        squads: [{ id: "squad-1", issuePrefix: "PAP" }],
      }),
    ).toEqual({ initialStep: 2, squadId: "squad-1" });
  });

  it("falls back to squad creation when the prefixed squad is missing", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/pap/onboarding",
        squadPrefix: "pap",
        squads: [],
      }),
    ).toEqual({ initialStep: 1 });
  });
});

describe("shouldRedirectSquadlessRouteToOnboarding", () => {
  it("redirects squadless entry routes into onboarding", () => {
    expect(
      shouldRedirectSquadlessRouteToOnboarding({
        pathname: "/",
        hasSquads: false,
      }),
    ).toBe(true);
  });

  it("does not redirect when already on onboarding", () => {
    expect(
      shouldRedirectSquadlessRouteToOnboarding({
        pathname: "/onboarding",
        hasSquads: false,
      }),
    ).toBe(false);
  });

  it("does not redirect when squads exist", () => {
    expect(
      shouldRedirectSquadlessRouteToOnboarding({
        pathname: "/issues",
        hasSquads: true,
      }),
    ).toBe(false);
  });
});
