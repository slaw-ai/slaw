import type { SidebarOrderPreference, UpsertSidebarOrderPreference } from "@slaw/shared";
import { api } from "./client";

export const sidebarPreferencesApi = {
  getSquadOrder: () => api.get<SidebarOrderPreference>("/sidebar-preferences/me"),
  updateSquadOrder: (data: UpsertSidebarOrderPreference) =>
    api.put<SidebarOrderPreference>("/sidebar-preferences/me", data),
  getProjectOrder: (squadId: string) =>
    api.get<SidebarOrderPreference>(`/squads/${squadId}/sidebar-preferences/me`),
  updateProjectOrder: (squadId: string, data: UpsertSidebarOrderPreference) =>
    api.put<SidebarOrderPreference>(`/squads/${squadId}/sidebar-preferences/me`, data),
};
