import type { SidebarBadges } from "@slaw-ai/shared";
import { api } from "./client";

export const sidebarBadgesApi = {
  get: (squadId: string) => api.get<SidebarBadges>(`/squads/${squadId}/sidebar-badges`),
};
