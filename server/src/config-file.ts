import fs from "node:fs";
import { slawConfigSchema, type SlawConfig } from "@slaw/shared";
import { resolveSlawConfigPath } from "./paths.js";

export function readConfigFile(): SlawConfig | null {
  const configPath = resolveSlawConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return slawConfigSchema.parse(raw);
  } catch {
    return null;
  }
}
