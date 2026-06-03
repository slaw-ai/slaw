import { describe, expect, it } from "vitest";
import {
  buildJoinDefaultsPayloadForAccept,
  mergeJoinDefaultsPayloadForReplay,
} from "../routes/access.js";

describe("mergeJoinDefaultsPayloadForReplay", () => {
  it("merges replay payloads and allows header override", () => {
    const merged = mergeJoinDefaultsPayloadForReplay(
      {
        url: "ws://old.example:18789",
        slawApiUrl: "http://host.docker.internal:3100",
        headers: {
          "x-auth-token": "old-token-1234567890",
          "x-custom": "keep-me",
        },
      },
      {
        slawApiUrl: "https://slaw.example.com",
        headers: {
          "x-auth-token": "new-token-1234567890",
        },
      },
    );

    const normalized = buildJoinDefaultsPayloadForAccept({
      adapterType: "http",
      defaultsPayload: merged,
    }) as Record<string, unknown>;

    expect(normalized.url).toBe("ws://old.example:18789");
    expect(normalized.slawApiUrl).toBe("https://slaw.example.com");
    expect(normalized.headers).toMatchObject({
      "x-auth-token": "new-token-1234567890",
      "x-custom": "keep-me",
    });
  });
});
