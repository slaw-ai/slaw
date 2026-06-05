import type {
  CloudUpstreamActivationEntityType,
  CloudUpstreamConnectStartResponse,
  CloudUpstreamConnection,
  CloudUpstreamPreview,
  CloudUpstreamRun,
  CloudUpstreamsState,
} from "@slaw/shared";
import { api } from "./client";

export const cloudUpstreamsApi = {
  list: (squadId: string) =>
    api.get<CloudUpstreamsState>(`/cloud-upstreams?squadId=${encodeURIComponent(squadId)}`),
  startConnect: (input: { squadId: string; remoteUrl: string; redirectUri: string }) =>
    api.post<CloudUpstreamConnectStartResponse>("/cloud-upstreams/connect/start", input),
  finishConnect: (input: { pendingConnectionId: string; code: string; state: string }) =>
    api.post<CloudUpstreamConnection>("/cloud-upstreams/connect/finish", input),
  preview: (connectionId: string, input: { squadId: string }) =>
    api.post<CloudUpstreamPreview>(`/cloud-upstreams/${encodeURIComponent(connectionId)}/push-runs/preview`, input),
  createRun: (connectionId: string, input: { squadId: string; retryOfRunId?: string | null }) =>
    api.post<CloudUpstreamRun>(`/cloud-upstreams/${encodeURIComponent(connectionId)}/push-runs`, input ?? {}),
  getRun: (connectionId: string, runId: string, squadId: string) =>
    api.get<CloudUpstreamRun>(
      `/cloud-upstreams/${encodeURIComponent(connectionId)}/push-runs/${encodeURIComponent(runId)}?squadId=${encodeURIComponent(squadId)}`,
    ),
  cancelRun: (connectionId: string, runId: string, input: { squadId: string }) =>
    api.post<CloudUpstreamRun>(
      `/cloud-upstreams/${encodeURIComponent(connectionId)}/push-runs/${encodeURIComponent(runId)}/cancel`,
      input,
    ),
  activateEntities: (
    connectionId: string,
    runId: string,
    input: { squadId: string; entityType: CloudUpstreamActivationEntityType },
  ) =>
    api.post<CloudUpstreamRun>(
      `/cloud-upstreams/${encodeURIComponent(connectionId)}/push-runs/${encodeURIComponent(runId)}/activation`,
      input,
    ),
};
