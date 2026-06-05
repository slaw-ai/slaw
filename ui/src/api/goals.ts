import type { Goal } from "@slaw/shared";
import { api } from "./client";

export const goalsApi = {
  list: (squadId: string) => api.get<Goal[]>(`/squads/${squadId}/goals`),
  get: (id: string) => api.get<Goal>(`/goals/${id}`),
  create: (squadId: string, data: Record<string, unknown>) =>
    api.post<Goal>(`/squads/${squadId}/goals`, data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Goal>(`/goals/${id}`, data),
  remove: (id: string) => api.delete<Goal>(`/goals/${id}`),
};
