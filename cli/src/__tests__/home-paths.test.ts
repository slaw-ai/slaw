import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeLocalInstancePaths,
  expandHomePrefix,
  resolveSlawHomeDir,
  resolveSlawInstanceId,
} from "../config/home.js";

const ORIGINAL_ENV = { ...process.env };

describe("home path resolution", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to ~/.slaw and default instance", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "slaw-home-paths-"));
    process.env.SLAW_HOME = home;
    delete process.env.SLAW_INSTANCE_ID;

    const paths = describeLocalInstancePaths();
    expect(paths.homeDir).toBe(home);
    expect(paths.instanceId).toBe("default");
    expect(paths.configPath).toBe(path.resolve(home, "instances", "default", "config.json"));
  });

  it("supports SLAW_HOME and explicit instance ids", () => {
    process.env.SLAW_HOME = "~/slaw-home";

    const home = resolveSlawHomeDir();
    expect(home).toBe(path.resolve(os.homedir(), "slaw-home"));
    expect(resolveSlawInstanceId("dev_1")).toBe("dev_1");
  });

  it("rejects invalid instance ids", () => {
    expect(() => resolveSlawInstanceId("bad/id")).toThrow(/Invalid SLAW_INSTANCE_ID/);
  });

  it("expands ~ prefixes", () => {
    expect(expandHomePrefix("~")).toBe(os.homedir());
    expect(expandHomePrefix("~/x/y")).toBe(path.resolve(os.homedir(), "x/y"));
  });
});
