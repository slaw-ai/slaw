import type {
  Project,
  ProjectWorkspace,
  WorkspaceOperation,
  WorkspaceRuntimeControlTarget,
} from "@slaw/shared";
import { api } from "./client";
import { sanitizeWorkspaceRuntimeControlTarget } from "./workspace-runtime-control";

function withSquadScope(path: string, squadId?: string) {
  if (!squadId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}squadId=${encodeURIComponent(squadId)}`;
}

function projectPath(id: string, squadId?: string, suffix = "") {
  return withSquadScope(`/projects/${encodeURIComponent(id)}${suffix}`, squadId);
}

export const projectsApi = {
  list: (squadId: string) => api.get<Project[]>(`/squads/${squadId}/projects`),
  get: (id: string, squadId?: string) => api.get<Project>(projectPath(id, squadId)),
  create: (squadId: string, data: Record<string, unknown>) =>
    api.post<Project>(`/squads/${squadId}/projects`, data),
  update: (id: string, data: Record<string, unknown>, squadId?: string) =>
    api.patch<Project>(projectPath(id, squadId), data),
  listWorkspaces: (projectId: string, squadId?: string) =>
    api.get<ProjectWorkspace[]>(projectPath(projectId, squadId, "/workspaces")),
  createWorkspace: (projectId: string, data: Record<string, unknown>, squadId?: string) =>
    api.post<ProjectWorkspace>(projectPath(projectId, squadId, "/workspaces"), data),
  updateWorkspace: (projectId: string, workspaceId: string, data: Record<string, unknown>, squadId?: string) =>
    api.patch<ProjectWorkspace>(
      projectPath(projectId, squadId, `/workspaces/${encodeURIComponent(workspaceId)}`),
      data,
    ),
  controlWorkspaceRuntimeServices: (
    projectId: string,
    workspaceId: string,
    action: "start" | "stop" | "restart",
    squadId?: string,
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ProjectWorkspace; operation: WorkspaceOperation }>(
      projectPath(projectId, squadId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}`),
      sanitizeWorkspaceRuntimeControlTarget(target),
    ),
  controlWorkspaceCommands: (
    projectId: string,
    workspaceId: string,
    action: "start" | "stop" | "restart" | "run",
    squadId?: string,
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ProjectWorkspace; operation: WorkspaceOperation }>(
      projectPath(projectId, squadId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-commands/${action}`),
      sanitizeWorkspaceRuntimeControlTarget(target),
    ),
  removeWorkspace: (projectId: string, workspaceId: string, squadId?: string) =>
    api.delete<ProjectWorkspace>(projectPath(projectId, squadId, `/workspaces/${encodeURIComponent(workspaceId)}`)),
  remove: (id: string, squadId?: string) => api.delete<Project>(projectPath(id, squadId)),
};
