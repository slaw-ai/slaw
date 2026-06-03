import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, resolveTargetPackage } from "./bootstrap-npm-package.mjs";

test("parseArgs recognizes publish and skip-build flags", () => {
  assert.deepEqual(parseArgs(["@slaw/adapter-acpx-local", "--publish", "--skip-build"]), {
    help: false,
    selector: "@slaw/adapter-acpx-local",
    publish: true,
    skipBuild: true,
    otp: null,
  });
});

test("parseArgs accepts an explicit otp value", () => {
  assert.deepEqual(parseArgs(["packages/adapters/acpx-local", "--publish", "--otp", "123456"]), {
    help: false,
    selector: "packages/adapters/acpx-local",
    publish: true,
    skipBuild: false,
    otp: "123456",
  });
});

test("parseArgs leaves otp null when omitted", () => {
  assert.deepEqual(parseArgs(["packages/adapters/acpx-local", "--publish"]), {
    help: false,
    selector: "packages/adapters/acpx-local",
    publish: true,
    skipBuild: false,
    otp: null,
  });
});

test("parseArgs returns help mode", () => {
  assert.deepEqual(parseArgs(["--help"]), {
    help: true,
    selector: null,
    publish: false,
    skipBuild: false,
    otp: null,
  });
});

test("resolveTargetPackage matches by package name or dir", () => {
  const packages = [
    { dir: "packages/a", name: "@slaw/a", pkg: {} },
    { dir: "packages/b", name: "@slaw/b", pkg: {} },
  ];

  assert.equal(resolveTargetPackage("@slaw/a", packages).dir, "packages/a");
  assert.equal(resolveTargetPackage("./packages/b", packages).name, "@slaw/b");
});

test("resolveTargetPackage includes the workspace diff plugin bootstrap package", () => {
  const pkg = resolveTargetPackage("@slaw/plugin-workspace-diff");

  assert.equal(pkg.dir, "packages/plugins/plugin-workspace-diff");
});
