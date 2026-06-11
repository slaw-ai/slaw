import type { Environment, EnvironmentCapabilities, EnvironmentLease, EnvironmentProbeResult } from "@slaw-ai/shared";
import { api } from "./client";

export const environmentsApi = {
  list: (squadId: string) => api.get<Environment[]>(`/squads/${squadId}/environments`),
  capabilities: (squadId: string) =>
    api.get<EnvironmentCapabilities>(`/squads/${squadId}/environments/capabilities`),
  lease: (leaseId: string) => api.get<EnvironmentLease>(`/environment-leases/${leaseId}`),
  create: (squadId: string, body: {
    name: string;
    description?: string | null;
    driver: "local" | "ssh" | "sandbox" | "plugin";
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown> | null;
  }) => api.post<Environment>(`/squads/${squadId}/environments`, body),
  update: (environmentId: string, body: {
    name?: string;
    description?: string | null;
    driver?: "local" | "ssh" | "sandbox" | "plugin";
    status?: "active" | "archived";
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown> | null;
  }) => api.patch<Environment>(`/environments/${environmentId}`, body),
  probe: (environmentId: string) => api.post<EnvironmentProbeResult>(`/environments/${environmentId}/probe`, {}),
  probeConfig: (squadId: string, body: {
    name?: string;
    driver: "local" | "ssh" | "sandbox" | "plugin";
    description?: string | null;
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown> | null;
  }) => api.post<EnvironmentProbeResult>(`/squads/${squadId}/environments/probe-config`, body),
};
