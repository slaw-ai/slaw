import os from "node:os";
import path from "node:path";

export const DEFAULT_SLAW_INSTANCE_ID = "default";
export const SLAW_CONFIG_BASENAME = "config.json";
export const SLAW_ENV_FILENAME = ".env";

const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;

export function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolveSlawHomeDir(homeOverride?: string): string {
  const raw = homeOverride?.trim() || process.env.SLAW_HOME?.trim();
  if (raw) return path.resolve(expandHomePrefix(raw));
  return path.resolve(os.homedir(), ".slaw");
}

export function resolveSlawInstanceId(instanceIdOverride?: string): string {
  const raw = instanceIdOverride?.trim() || process.env.SLAW_INSTANCE_ID?.trim() || DEFAULT_SLAW_INSTANCE_ID;
  if (!PATH_SEGMENT_RE.test(raw)) {
    throw new Error(`Invalid SLAW_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolveSlawInstanceRoot(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveSlawHomeDir(input.homeDir), "instances", resolveSlawInstanceId(input.instanceId));
}

export function resolveSlawInstanceConfigPath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveSlawInstanceRoot(input), SLAW_CONFIG_BASENAME);
}

export function resolveSlawConfigPathForInstance(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return resolveSlawInstanceConfigPath(input);
}

export function resolveSlawEnvPathForConfig(configPath: string): string {
  return path.resolve(path.dirname(configPath), SLAW_ENV_FILENAME);
}

export function resolveDefaultEmbeddedPostgresDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveSlawInstanceRoot(input), "db");
}

export function resolveDefaultLogsDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveSlawInstanceRoot(input), "logs");
}

export function resolveDefaultSecretsKeyFilePath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveSlawInstanceRoot(input), "secrets", "master.key");
}

export function resolveDefaultStorageDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveSlawInstanceRoot(input), "data", "storage");
}

export function resolveDefaultBackupDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveSlawInstanceRoot(input), "data", "backups");
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}

/** Per-machine identity file, shared by all instances on this machine. */
export function resolveSlawMachineFilePath(homeOverride?: string): string {
  return path.resolve(resolveSlawHomeDir(homeOverride), "machine.json");
}

/** Botfather reporter state dir for an instance: spool, credentials. */
export function resolveBotfatherStateDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveSlawInstanceRoot(input), "botfather");
}

export function resolveBotfatherCredentialsPath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveBotfatherStateDir(input), "credentials.json");
}

export function resolveBotfatherSpoolDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveBotfatherStateDir(input), "spool");
}
