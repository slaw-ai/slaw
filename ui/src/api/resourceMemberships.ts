import type {
  ResourceMemberships,
  ResourceMembershipUpdateResult,
  UpdateResourceMembership,
} from "@slaw/shared";
import { api } from "./client";

export const resourceMembershipsApi = {
  listMine: (squadId: string) =>
    api.get<ResourceMemberships>(`/squads/${squadId}/resource-memberships/me`),
  updateProject: (squadId: string, projectId: string, data: UpdateResourceMembership) =>
    api.put<ResourceMembershipUpdateResult>(
      `/squads/${squadId}/resource-memberships/me/projects/${projectId}`,
      data,
    ),
  updateAgent: (squadId: string, agentId: string, data: UpdateResourceMembership) =>
    api.put<ResourceMembershipUpdateResult>(
      `/squads/${squadId}/resource-memberships/me/agents/${agentId}`,
      data,
    ),
};
