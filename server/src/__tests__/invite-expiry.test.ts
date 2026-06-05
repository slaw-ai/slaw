import { describe, expect, it } from "vitest";
import { squadInviteExpiresAt } from "../routes/access.js";

describe("squadInviteExpiresAt", () => {
  it("sets invite expiration to 72 hours after invite creation time", () => {
    const createdAtMs = Date.parse("2026-03-06T00:00:00.000Z");
    const expiresAt = squadInviteExpiresAt(createdAtMs);
    expect(expiresAt.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });
});
