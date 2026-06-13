/**
 * Phase 3 (security remediation) — cloud-tenant trusted-header source-IP
 * allowlist (audit finding H5). Unit-covers the CIDR matcher that gates the
 * x-slaw-cloud-* header bundle.
 */
import { describe, expect, it } from "vitest";
import { ipInCidr } from "../middleware/auth.js";

describe("ipInCidr", () => {
  it("matches a bare IP exactly", () => {
    expect(ipInCidr("10.0.0.5", "10.0.0.5")).toBe(true);
    expect(ipInCidr("10.0.0.6", "10.0.0.5")).toBe(false);
  });

  it("matches inside a /24", () => {
    expect(ipInCidr("192.168.1.42", "192.168.1.0/24")).toBe(true);
    expect(ipInCidr("192.168.2.42", "192.168.1.0/24")).toBe(false);
  });

  it("matches inside a /16 and a /8", () => {
    expect(ipInCidr("10.55.99.1", "10.0.0.0/8")).toBe(true);
    expect(ipInCidr("11.0.0.1", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("172.16.250.7", "172.16.0.0/16")).toBe(true);
    expect(ipInCidr("172.17.0.7", "172.16.0.0/16")).toBe(false);
  });

  it("handles the edge masks /32 and /0", () => {
    expect(ipInCidr("8.8.8.8", "8.8.8.8/32")).toBe(true);
    expect(ipInCidr("8.8.8.9", "8.8.8.8/32")).toBe(false);
    expect(ipInCidr("203.0.113.1", "0.0.0.0/0")).toBe(true);
  });

  it("fails closed on malformed input", () => {
    expect(ipInCidr("not-an-ip", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("10.0.0.1", "10.0.0.0/99")).toBe(false);
    expect(ipInCidr("10.0.0.1", "garbage")).toBe(false);
    expect(ipInCidr("999.0.0.1", "999.0.0.0/8")).toBe(false);
  });
});
