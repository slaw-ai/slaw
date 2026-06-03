import { describe, expect, it } from "vitest";
import { hasAgentShortnameCollision, deduplicateAgentName } from "../services/agents.ts";

describe("hasAgentShortnameCollision", () => {
  it("detects collisions by normalized shortname", () => {
    const collision = hasAgentShortnameCollision("Codex Coder", [
      { id: "a1", name: "codex-coder", status: "idle" },
    ]);
    expect(collision).toBe(true);
  });

  it("ignores terminated agents", () => {
    const collision = hasAgentShortnameCollision("Codex Coder", [
      { id: "a1", name: "codex-coder", status: "terminated" },
    ]);
    expect(collision).toBe(false);
  });

  it("ignores the excluded agent id", () => {
    const collision = hasAgentShortnameCollision(
      "Codex Coder",
      [
        { id: "a1", name: "codex-coder", status: "idle" },
        { id: "a2", name: "other-agent", status: "idle" },
      ],
      { excludeAgentId: "a1" },
    );
    expect(collision).toBe(false);
  });

  it("does not collide when candidate has no shortname", () => {
    const collision = hasAgentShortnameCollision("!!!", [
      { id: "a1", name: "codex-coder", status: "idle" },
    ]);
    expect(collision).toBe(false);
  });
});

describe("deduplicateAgentName", () => {
  it("returns original name when no collision", () => {
    const name = deduplicateAgentName("Hermes", [
      { id: "a1", name: "other-agent", status: "idle" },
    ]);
    expect(name).toBe("Hermes");
  });

  it("appends suffix when name collides", () => {
    const name = deduplicateAgentName("Hermes", [
      { id: "a1", name: "hermes", status: "idle" },
    ]);
    expect(name).toBe("Hermes 2");
  });

  it("increments suffix until unique", () => {
    const name = deduplicateAgentName("Hermes", [
      { id: "a1", name: "hermes", status: "idle" },
      { id: "a2", name: "hermes-2", status: "idle" },
      { id: "a3", name: "hermes-3", status: "idle" },
    ]);
    expect(name).toBe("Hermes 4");
  });

  it("ignores terminated agents for collision", () => {
    const name = deduplicateAgentName("Hermes", [
      { id: "a1", name: "hermes", status: "terminated" },
    ]);
    expect(name).toBe("Hermes");
  });
});
