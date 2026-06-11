import path from "node:path";
import {
  expandHomePrefix,
  resolveDefaultBackupDir as resolveSharedDefaultBackupDir,
  resolveDefaultEmbeddedPostgresDir as resolveSharedDefaultEmbeddedPostgresDir,
  resolveDefaultLogsDir as resolveSharedDefaultLogsDir,
  resolveDefaultSecretsKeyFilePath as resolveSharedDefaultSecretsKeyFilePath,
  resolveDefaultStorageDir as resolveSharedDefaultStorageDir,
  resolveHomeAwarePath,
  resolveSlawConfigPathForInstance,
  resolveSlawHomeDir,
  resolveSlawInstanceId,
  resolveSlawInstanceRoot as resolveSharedSlawInstanceRoot,
} from "@slaw-ai/shared/home-paths";

export {
  expandHomePrefix,
  resolveHomeAwarePath,
  resolveSlawHomeDir,
  resolveSlawInstanceId,
};

export function resolveSlawInstanceRoot(instanceId?: string): string {
  return resolveSharedSlawInstanceRoot({ instanceId });
}

export function resolveDefaultConfigPath(instanceId?: string): string {
  return resolveSlawConfigPathForInstance({ instanceId });
}

export function resolveDefaultContextPath(): string {
  return path.resolve(resolveSlawHomeDir(), "context.json");
}

export function resolveDefaultCliAuthPath(): string {
  return path.resolve(resolveSlawHomeDir(), "auth.json");
}

export function resolveDefaultEmbeddedPostgresDir(instanceId?: string): string {
  return resolveSharedDefaultEmbeddedPostgresDir({ instanceId });
}

export function resolveDefaultLogsDir(instanceId?: string): string {
  return resolveSharedDefaultLogsDir({ instanceId });
}

export function resolveDefaultSecretsKeyFilePath(instanceId?: string): string {
  return resolveSharedDefaultSecretsKeyFilePath({ instanceId });
}

export function resolveDefaultStorageDir(instanceId?: string): string {
  return resolveSharedDefaultStorageDir({ instanceId });
}

export function resolveDefaultBackupDir(instanceId?: string): string {
  return resolveSharedDefaultBackupDir({ instanceId });
}

export function describeLocalInstancePaths(instanceId?: string) {
  const resolvedInstanceId = resolveSlawInstanceId(instanceId);
  const instanceRoot = resolveSlawInstanceRoot(resolvedInstanceId);
  return {
    homeDir: resolveSlawHomeDir(),
    instanceId: resolvedInstanceId,
    instanceRoot,
    configPath: resolveDefaultConfigPath(resolvedInstanceId),
    embeddedPostgresDataDir: resolveDefaultEmbeddedPostgresDir(resolvedInstanceId),
    backupDir: resolveDefaultBackupDir(resolvedInstanceId),
    logDir: resolveDefaultLogsDir(resolvedInstanceId),
    secretsKeyFilePath: resolveDefaultSecretsKeyFilePath(resolvedInstanceId),
    storageDir: resolveDefaultStorageDir(resolvedInstanceId),
  };
}
