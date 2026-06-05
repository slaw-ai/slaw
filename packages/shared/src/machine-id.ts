import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveSlawMachineFilePath } from "./home-paths.js";

/**
 * Per-machine identity for botfather reporting (ARCHITECTURE §3).
 * Stable, salted hash derived from the OS machine GUID where available,
 * else from stable host facts. Persisted at ~/.slaw/machine.json so every
 * instance on one box shares the same machineId. Hostname is captured for
 * display only (it can change).
 */
const SALT = "slaw-botfather-machine-id-v1";

export interface MachineIdentity {
  machineId: string;
  hostname: string;
  os: NodeJS.Platform;
  createdAt: string;
}

/** Best-effort read of the OS machine GUID; falls back to stable host facts. */
function readOsMachineGuid(): string {
  try {
    if (process.platform === "linux") {
      for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        if (fs.existsSync(p)) {
          const v = fs.readFileSync(p, "utf8").trim();
          if (v) return v;
        }
      }
    }
    // darwin/win32 GUIDs require shelling out; avoid that here and use host facts.
  } catch {
    /* ignore and fall through */
  }
  // Stable-ish fallback: hostname + platform + arch + first non-internal MAC.
  const macs = Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && !n.internal && !!n.mac && n.mac !== "00:00:00:00:00:00")
    .map((n) => n.mac)
    .sort();
  return `${os.hostname()}|${os.platform()}|${os.arch()}|${macs[0] ?? "nomac"}`;
}

function deriveMachineId(): string {
  const raw = readOsMachineGuid();
  const hash = crypto.createHash("sha256").update(SALT).update("|").update(raw).digest("hex");
  // shape it like a uuid for readability; it's just a 32-hex slice with dashes
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");
}

/**
 * Load the persisted machine identity, deriving + writing it on first run.
 * Synchronous + cheap; safe to call at startup.
 */
export function loadOrCreateMachineIdentity(homeOverride?: string): MachineIdentity {
  const file = resolveSlawMachineFilePath(homeOverride);
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<MachineIdentity>;
      if (typeof parsed.machineId === "string" && parsed.machineId.length >= 8) {
        return {
          machineId: parsed.machineId,
          hostname: os.hostname(),
          os: process.platform,
          createdAt: parsed.createdAt ?? new Date().toISOString(),
        };
      }
    }
  } catch {
    /* corrupt file → regenerate below */
  }

  const identity: MachineIdentity = {
    machineId: deriveMachineId(),
    hostname: os.hostname(),
    os: process.platform,
    createdAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(identity, null, 2), { encoding: "utf8", mode: 0o600 });
  } catch {
    /* non-fatal: still return the derived id even if we can't persist */
  }
  return identity;
}
