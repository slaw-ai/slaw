import type { DashboardSummary } from "@slaw/shared";
import { api } from "./client";

export const dashboardApi = {
  summary: (squadId: string) => api.get<DashboardSummary>(`/squads/${squadId}/dashboard`),
};
