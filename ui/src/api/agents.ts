import type {
  Agent,
  AgentDetail,
  AgentInstructionsBundle,
  AgentInstructionsFileDetail,
  AgentSkillSnapshot,
  AdapterEnvironmentTestResult,
  AgentKeyCreated,
  AgentRuntimeState,
  AgentTaskSession,
  AgentWakeupResponse,
  HeartbeatRun,
  Approval,
  AgentConfigRevision,
} from "@slaw-ai/shared";
import type {
  AdapterModelProfileDefinition,
  AdapterModelProfileKey,
} from "@slaw-ai/adapter-utils";
import { isUuidLike, normalizeAgentUrlKey } from "@slaw-ai/shared";
import { ApiError, api } from "./client";

export interface AgentKey {
  id: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface AdapterModel {
  id: string;
  label: string;
}

export type { AdapterModelProfileKey };
export type AdapterModelProfile = AdapterModelProfileDefinition;

export interface DetectedAdapterModel {
  model: string;
  provider: string;
  source: string;
  candidates?: string[];
}

export interface ClaudeLoginResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  loginUrl: string | null;
  stdout: string;
  stderr: string;
}

export interface OrgNode {
  id: string;
  name: string;
  role: string;
  status: string;
  reports: OrgNode[];
}

export interface AgentHireResponse {
  agent: Agent;
  approval: Approval | null;
}

export interface AgentPermissionUpdate {
  canCreateAgents: boolean;
  canAssignTasks: boolean;
}

export interface AgentWakeRequest {
  source?: "timer" | "assignment" | "on_demand" | "automation";
  triggerDetail?: "manual" | "ping" | "callback" | "system";
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  forceFreshSession?: boolean;
}

function withSquadScope(path: string, squadId?: string) {
  if (!squadId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}squadId=${encodeURIComponent(squadId)}`;
}

function agentPath(id: string, squadId?: string, suffix = "") {
  return withSquadScope(`/agents/${encodeURIComponent(id)}${suffix}`, squadId);
}

export const agentsApi = {
  list: (squadId: string) => api.get<Agent[]>(`/squads/${squadId}/agents`),
  org: (squadId: string) => api.get<OrgNode[]>(`/squads/${squadId}/org`),
  listConfigurations: (squadId: string) =>
    api.get<Record<string, unknown>[]>(`/squads/${squadId}/agent-configurations`),
  get: async (id: string, squadId?: string) => {
    try {
      return await api.get<AgentDetail>(agentPath(id, squadId));
    } catch (error) {
      // Backward-compat fallback: if backend shortname lookup reports ambiguity,
      // resolve using squad agent list while ignoring terminated agents.
      if (
        !(error instanceof ApiError) ||
        error.status !== 409 ||
        !squadId ||
        isUuidLike(id)
      ) {
        throw error;
      }

      const urlKey = normalizeAgentUrlKey(id);
      if (!urlKey) throw error;

      const agents = await api.get<Agent[]>(`/squads/${squadId}/agents`);
      const matches = agents.filter(
        (agent) => agent.status !== "terminated" && normalizeAgentUrlKey(agent.urlKey) === urlKey,
      );
      if (matches.length !== 1) throw error;
      return api.get<AgentDetail>(agentPath(matches[0]!.id, squadId));
    }
  },
  getConfiguration: (id: string, squadId?: string) =>
    api.get<Record<string, unknown>>(agentPath(id, squadId, "/configuration")),
  listConfigRevisions: (id: string, squadId?: string) =>
    api.get<AgentConfigRevision[]>(agentPath(id, squadId, "/config-revisions")),
  getConfigRevision: (id: string, revisionId: string, squadId?: string) =>
    api.get<AgentConfigRevision>(agentPath(id, squadId, `/config-revisions/${revisionId}`)),
  rollbackConfigRevision: (id: string, revisionId: string, squadId?: string) =>
    api.post<Agent>(agentPath(id, squadId, `/config-revisions/${revisionId}/rollback`), {}),
  create: (squadId: string, data: Record<string, unknown>) =>
    api.post<Agent>(`/squads/${squadId}/agents`, data),
  hire: (squadId: string, data: Record<string, unknown>) =>
    api.post<AgentHireResponse>(`/squads/${squadId}/agent-hires`, data),
  update: (id: string, data: Record<string, unknown>, squadId?: string) =>
    api.patch<Agent>(agentPath(id, squadId), data),
  updatePermissions: (id: string, data: AgentPermissionUpdate, squadId?: string) =>
    api.patch<AgentDetail>(agentPath(id, squadId, "/permissions"), data),
  instructionsBundle: (id: string, squadId?: string) =>
    api.get<AgentInstructionsBundle>(agentPath(id, squadId, "/instructions-bundle")),
  updateInstructionsBundle: (
    id: string,
    data: {
      mode?: "managed" | "external";
      rootPath?: string | null;
      entryFile?: string;
      clearLegacyPromptTemplate?: boolean;
    },
    squadId?: string,
  ) => api.patch<AgentInstructionsBundle>(agentPath(id, squadId, "/instructions-bundle"), data),
  instructionsFile: (id: string, relativePath: string, squadId?: string) =>
    api.get<AgentInstructionsFileDetail>(
      agentPath(id, squadId, `/instructions-bundle/file?path=${encodeURIComponent(relativePath)}`),
    ),
  saveInstructionsFile: (
    id: string,
    data: { path: string; content: string; clearLegacyPromptTemplate?: boolean },
    squadId?: string,
  ) => api.put<AgentInstructionsFileDetail>(agentPath(id, squadId, "/instructions-bundle/file"), data),
  deleteInstructionsFile: (id: string, relativePath: string, squadId?: string) =>
    api.delete<AgentInstructionsBundle>(
      agentPath(id, squadId, `/instructions-bundle/file?path=${encodeURIComponent(relativePath)}`),
    ),
  pause: (id: string, squadId?: string) => api.post<Agent>(agentPath(id, squadId, "/pause"), {}),
  resume: (id: string, squadId?: string) => api.post<Agent>(agentPath(id, squadId, "/resume"), {}),
  approve: (id: string, squadId?: string) => api.post<Agent>(agentPath(id, squadId, "/approve"), {}),
  terminate: (id: string, squadId?: string) => api.post<Agent>(agentPath(id, squadId, "/terminate"), {}),
  remove: (id: string, squadId?: string) => api.delete<{ ok: true }>(agentPath(id, squadId)),
  listKeys: (id: string, squadId?: string) => api.get<AgentKey[]>(agentPath(id, squadId, "/keys")),
  skills: (id: string, squadId?: string) =>
    api.get<AgentSkillSnapshot>(agentPath(id, squadId, "/skills")),
  syncSkills: (id: string, desiredSkills: string[], squadId?: string) =>
    api.post<AgentSkillSnapshot>(agentPath(id, squadId, "/skills/sync"), { desiredSkills }),
  createKey: (id: string, name: string, squadId?: string) =>
    api.post<AgentKeyCreated>(agentPath(id, squadId, "/keys"), { name }),
  revokeKey: (agentId: string, keyId: string, squadId?: string) =>
    api.delete<{ ok: true }>(agentPath(agentId, squadId, `/keys/${encodeURIComponent(keyId)}`)),
  runtimeState: (id: string, squadId?: string) =>
    api.get<AgentRuntimeState>(agentPath(id, squadId, "/runtime-state")),
  taskSessions: (id: string, squadId?: string) =>
    api.get<AgentTaskSession[]>(agentPath(id, squadId, "/task-sessions")),
  resetSession: (id: string, taskKey?: string | null, squadId?: string) =>
    api.post<void>(agentPath(id, squadId, "/runtime-state/reset-session"), { taskKey: taskKey ?? null }),
  adapterModels: (
    squadId: string,
    type: string,
    options?: { refresh?: boolean; environmentId?: string | null },
  ) => {
    const params = new URLSearchParams();
    if (options?.refresh) params.set("refresh", "1");
    if (options?.environmentId) params.set("environmentId", options.environmentId);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return api.get<AdapterModel[]>(
      `/squads/${encodeURIComponent(squadId)}/adapters/${encodeURIComponent(type)}/models${query}`,
    );
  },
  detectModel: (squadId: string, type: string) =>
    api.get<DetectedAdapterModel | null>(
      `/squads/${encodeURIComponent(squadId)}/adapters/${encodeURIComponent(type)}/detect-model`,
    ),
  adapterModelProfiles: (squadId: string, type: string) =>
    api.get<AdapterModelProfile[]>(
      `/squads/${encodeURIComponent(squadId)}/adapters/${encodeURIComponent(type)}/model-profiles`,
    ),
  testEnvironment: (
    squadId: string,
    type: string,
    data: {
      adapterConfig: Record<string, unknown>;
      environmentId?: string | null;
    },
  ) =>
    api.post<AdapterEnvironmentTestResult>(
      `/squads/${squadId}/adapters/${type}/test-environment`,
      data,
    ),
  invoke: (id: string, squadId?: string, data: AgentWakeRequest = {}) =>
    api.post<HeartbeatRun>(agentPath(id, squadId, "/heartbeat/invoke"), data),
  wakeup: (
    id: string,
    data: AgentWakeRequest,
    squadId?: string,
  ) => api.post<AgentWakeupResponse>(agentPath(id, squadId, "/wakeup"), data),
  loginWithClaude: (id: string, squadId?: string) =>
    api.post<ClaudeLoginResult>(agentPath(id, squadId, "/claude-login"), {}),
  availableSkills: () =>
    api.get<{ skills: AvailableSkill[] }>("/skills/available"),
};

export interface AvailableSkill {
  name: string;
  description: string;
  isSlawManaged: boolean;
}
