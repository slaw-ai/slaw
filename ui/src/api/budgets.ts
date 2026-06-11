import type {
  BudgetIncident,
  BudgetIncidentResolutionInput,
  BudgetOverview,
  BudgetPolicySummary,
  BudgetPolicyUpsertInput,
} from "@slaw-ai/shared";
import { api } from "./client";

export const budgetsApi = {
  overview: (squadId: string) =>
    api.get<BudgetOverview>(`/squads/${squadId}/budgets/overview`),
  upsertPolicy: (squadId: string, data: BudgetPolicyUpsertInput) =>
    api.post<BudgetPolicySummary>(`/squads/${squadId}/budgets/policies`, data),
  resolveIncident: (squadId: string, incidentId: string, data: BudgetIncidentResolutionInput) =>
    api.post<BudgetIncident>(
      `/squads/${squadId}/budget-incidents/${encodeURIComponent(incidentId)}/resolve`,
      data,
    ),
};
