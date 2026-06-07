import { describe, it, expect } from "vitest";
import { isTowerGoverned } from "./authoring-lock.js";

/**
 * P5 — tower-only authoring lock predicate. Local skill authoring is blocked
 * ONLY when an instance is both connected to a tower (url configured) AND
 * enrolled (active credentials). Standalone or pre-enrollment instances keep
 * local authoring.
 */
const cfg = (url?: string) => () => (url ? ({ url } as any) : undefined);
const creds = (apiKey?: string) => () => (apiKey ? ({ apiKey, enrollmentId: "e" } as any) : null);

describe("isTowerGoverned", () => {
  it("is GOVERNED when a tower url is configured and credentials are active", () => {
    expect(
      isTowerGoverned({ readConfigSection: cfg("http://tower:8400"), readCredentials: creds("key123") }),
    ).toBe(true);
  });

  it("is NOT governed standalone (no tower url)", () => {
    expect(isTowerGoverned({ readConfigSection: cfg(undefined), readCredentials: creds("key123") })).toBe(false);
  });

  it("is NOT governed when connected but not yet enrolled (no apiKey)", () => {
    expect(isTowerGoverned({ readConfigSection: cfg("http://tower:8400"), readCredentials: creds(undefined) })).toBe(
      false,
    );
  });

  it("is NOT governed with an empty url string", () => {
    expect(isTowerGoverned({ readConfigSection: cfg(""), readCredentials: creds("key123") })).toBe(false);
  });
});
