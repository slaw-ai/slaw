import type { DashboardSummary } from "@slaw/shared";
import { api } from "./client";

export const dashoperatorApi = {
  summary: (squadId: string) => api.get<DashboardSummary>(`/squads/${squadId}/dashboard`),
};
