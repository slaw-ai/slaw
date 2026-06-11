import type {
  SquadSecret,
  SquadSecretUsageBinding,
  SquadSecretProviderConfig,
  SecretProviderConfigDiscoveryPreviewResult,
  RemoteSecretImportPreviewResult,
  RemoteSecretImportResult,
  SecretAccessEvent,
  SecretManagedMode,
  SecretProvider,
  SecretProviderConfigStatus,
  SecretProviderConfigHealthResponse,
  SecretProviderDescriptor,
  SecretStatus,
} from "@slaw-ai/shared";
import { api } from "./client";

export interface SecretUsageResponse {
  secretId: string;
  bindings: SquadSecretUsageBinding[];
}

export interface CreateSecretInput {
  name: string;
  key?: string;
  provider?: SecretProvider;
  managedMode?: SecretManagedMode;
  value?: string | null;
  description?: string | null;
  externalRef?: string | null;
  providerVersionRef?: string | null;
  providerConfigId?: string | null;
  providerMetadata?: Record<string, unknown> | null;
}

export interface SecretProviderHealthResponse {
  providers: Array<{
    provider: SecretProvider;
    status: "ok" | "warn" | "error";
    message: string;
    warnings?: string[];
    backupGuidance?: string[];
    details?: Record<string, unknown>;
  }>;
}

export interface UpdateSecretInput {
  name?: string;
  key?: string;
  status?: SecretStatus;
  description?: string | null;
  externalRef?: string | null;
  providerMetadata?: Record<string, unknown> | null;
}

export interface RotateSecretInput {
  value?: string | null;
  externalRef?: string | null;
  providerVersionRef?: string | null;
  providerConfigId?: string | null;
}

export interface CreateSecretProviderConfigInput {
  provider: SecretProvider;
  displayName: string;
  status?: SecretProviderConfigStatus;
  isDefault?: boolean;
  config?: Record<string, unknown>;
}

export interface UpdateSecretProviderConfigInput {
  displayName?: string;
  status?: SecretProviderConfigStatus;
  isDefault?: boolean;
  config?: Record<string, unknown>;
}

export interface RemoteImportPreviewInput {
  providerConfigId: string;
  query?: string | null;
  nextToken?: string | null;
  pageSize?: number;
}

export interface RemoteImportSelectionInput {
  externalRef: string;
  name?: string | null;
  key?: string | null;
  description?: string | null;
  providerVersionRef?: string | null;
  providerMetadata?: Record<string, unknown> | null;
}

export interface RemoteImportInput {
  providerConfigId: string;
  secrets: RemoteImportSelectionInput[];
}

export interface SecretProviderConfigDiscoveryPreviewInput {
  provider: SecretProvider;
  config?: Record<string, unknown>;
  query?: string | null;
  nextToken?: string | null;
  pageSize?: number;
}

export const secretsApi = {
  list: (squadId: string) => api.get<SquadSecret[]>(`/squads/${squadId}/secrets`),
  providers: (squadId: string) =>
    api.get<SecretProviderDescriptor[]>(`/squads/${squadId}/secret-providers`),
  providerHealth: (squadId: string) =>
    api.get<SecretProviderHealthResponse>(`/squads/${squadId}/secret-providers/health`),
  providerConfigs: (squadId: string) =>
    api.get<SquadSecretProviderConfig[]>(`/squads/${squadId}/secret-provider-configs`),
  providerConfigDiscoveryPreview: (
    squadId: string,
    data: SecretProviderConfigDiscoveryPreviewInput,
  ) =>
    api.post<SecretProviderConfigDiscoveryPreviewResult>(
      `/squads/${squadId}/secret-provider-configs/discovery/preview`,
      data,
    ),
  createProviderConfig: (squadId: string, data: CreateSecretProviderConfigInput) =>
    api.post<SquadSecretProviderConfig>(`/squads/${squadId}/secret-provider-configs`, data),
  updateProviderConfig: (id: string, data: UpdateSecretProviderConfigInput) =>
    api.patch<SquadSecretProviderConfig>(`/secret-provider-configs/${id}`, data),
  disableProviderConfig: (id: string) =>
    api.patch<SquadSecretProviderConfig>(`/secret-provider-configs/${id}`, { status: "disabled" }),
  removeProviderConfig: (id: string) =>
    api.delete<SquadSecretProviderConfig>(`/secret-provider-configs/${id}`),
  setDefaultProviderConfig: (id: string) =>
    api.post<SquadSecretProviderConfig>(`/secret-provider-configs/${id}/default`, {}),
  checkProviderConfigHealth: (id: string) =>
    api.post<SecretProviderConfigHealthResponse>(`/secret-provider-configs/${id}/health`, {}),
  create: (squadId: string, data: CreateSecretInput) =>
    api.post<SquadSecret>(`/squads/${squadId}/secrets`, data),
  update: (id: string, data: UpdateSecretInput) =>
    api.patch<SquadSecret>(`/secrets/${id}`, data),
  rotate: (id: string, data: RotateSecretInput) =>
    api.post<SquadSecret>(`/secrets/${id}/rotate`, data),
  disable: (id: string) =>
    api.patch<SquadSecret>(`/secrets/${id}`, { status: "disabled" satisfies SecretStatus }),
  enable: (id: string) =>
    api.patch<SquadSecret>(`/secrets/${id}`, { status: "active" satisfies SecretStatus }),
  archive: (id: string) =>
    api.patch<SquadSecret>(`/secrets/${id}`, { status: "archived" satisfies SecretStatus }),
  remove: (id: string) => api.delete<{ ok: true }>(`/secrets/${id}`),
  usage: (id: string) => api.get<SecretUsageResponse>(`/secrets/${id}/usage`),
  accessEvents: (id: string) => api.get<SecretAccessEvent[]>(`/secrets/${id}/access-events`),
  remoteImportPreview: (squadId: string, data: RemoteImportPreviewInput) =>
    api.post<RemoteSecretImportPreviewResult>(
      `/squads/${squadId}/secrets/remote-import/preview`,
      data,
    ),
  remoteImport: (squadId: string, data: RemoteImportInput) =>
    api.post<RemoteSecretImportResult>(`/squads/${squadId}/secrets/remote-import`, data),
};
