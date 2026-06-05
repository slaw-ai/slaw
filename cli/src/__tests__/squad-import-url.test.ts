import { describe, expect, it } from "vitest";
import {
  isGithubShorthand,
  looksLikeRepoUrl,
  isHttpUrl,
  normalizeGithubImportSource,
} from "../commands/client/squad.js";

describe("isHttpUrl", () => {
  it("matches http URLs", () => {
    expect(isHttpUrl("http://example.com/foo")).toBe(true);
  });

  it("matches https URLs", () => {
    expect(isHttpUrl("https://example.com/foo")).toBe(true);
  });

  it("rejects local paths", () => {
    expect(isHttpUrl("/tmp/my-squad")).toBe(false);
    expect(isHttpUrl("./relative")).toBe(false);
  });
});

describe("looksLikeRepoUrl", () => {
  it("matches GitHub URLs", () => {
    expect(looksLikeRepoUrl("https://github.com/org/repo")).toBe(true);
  });

  it("rejects URLs without owner/repo path", () => {
    expect(looksLikeRepoUrl("https://example.com/foo")).toBe(false);
  });

  it("rejects local paths", () => {
    expect(looksLikeRepoUrl("/tmp/my-squad")).toBe(false);
  });
});

describe("isGithubShorthand", () => {
  it("matches owner/repo/path shorthands", () => {
    expect(isGithubShorthand("slaw/squads/gstack")).toBe(true);
    expect(isGithubShorthand("slaw/squads")).toBe(true);
  });

  it("rejects local-looking paths", () => {
    expect(isGithubShorthand("./exports/acme")).toBe(false);
    expect(isGithubShorthand("/tmp/acme")).toBe(false);
    expect(isGithubShorthand("C:\\temp\\acme")).toBe(false);
  });
});

describe("normalizeGithubImportSource", () => {
  it("normalizes shorthand imports to canonical GitHub sources", () => {
    expect(normalizeGithubImportSource("slaw/squads/gstack")).toBe(
      "https://github.com/slaw/squads?ref=main&path=gstack",
    );
  });

  it("applies --ref to shorthand imports", () => {
    expect(normalizeGithubImportSource("slaw/squads/gstack", "feature/demo")).toBe(
      "https://github.com/slaw/squads?ref=feature%2Fdemo&path=gstack",
    );
  });

  it("applies --ref to existing GitHub tree URLs without losing the package path", () => {
    expect(
      normalizeGithubImportSource(
        "https://github.com/slaw/squads/tree/main/gstack",
        "release/2026-03-23",
      ),
    ).toBe(
      "https://github.com/slaw/squads?ref=release%2F2026-03-23&path=gstack",
    );
  });
});
