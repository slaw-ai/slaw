import type {
  CostSummary,
  CostByAgent,
  CostByProviderModel,
  CostByBiller,
  CostByAgentModel,
  CostByProject,
  CostWindowSpendRow,
  FinanceSummary,
  FinanceByBiller,
  FinanceByKind,
  FinanceEvent,
  ProviderQuotaResult,
} from "@slaw/shared";
import { api } from "./client";

function dateParams(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const costsApi = {
  summary: (squadId: string, from?: string, to?: string) =>
    api.get<CostSummary>(`/squads/${squadId}/costs/summary${dateParams(from, to)}`),
  byAgent: (squadId: string, from?: string, to?: string) =>
    api.get<CostByAgent[]>(`/squads/${squadId}/costs/by-agent${dateParams(from, to)}`),
  byAgentModel: (squadId: string, from?: string, to?: string) =>
    api.get<CostByAgentModel[]>(`/squads/${squadId}/costs/by-agent-model${dateParams(from, to)}`),
  byProject: (squadId: string, from?: string, to?: string) =>
    api.get<CostByProject[]>(`/squads/${squadId}/costs/by-project${dateParams(from, to)}`),
  byProvider: (squadId: string, from?: string, to?: string) =>
    api.get<CostByProviderModel[]>(`/squads/${squadId}/costs/by-provider${dateParams(from, to)}`),
  byBiller: (squadId: string, from?: string, to?: string) =>
    api.get<CostByBiller[]>(`/squads/${squadId}/costs/by-biller${dateParams(from, to)}`),
  financeSummary: (squadId: string, from?: string, to?: string) =>
    api.get<FinanceSummary>(`/squads/${squadId}/costs/finance-summary${dateParams(from, to)}`),
  financeByBiller: (squadId: string, from?: string, to?: string) =>
    api.get<FinanceByBiller[]>(`/squads/${squadId}/costs/finance-by-biller${dateParams(from, to)}`),
  financeByKind: (squadId: string, from?: string, to?: string) =>
    api.get<FinanceByKind[]>(`/squads/${squadId}/costs/finance-by-kind${dateParams(from, to)}`),
  financeEvents: (squadId: string, from?: string, to?: string, limit: number = 100) =>
    api.get<FinanceEvent[]>(`/squads/${squadId}/costs/finance-events${dateParamsWithLimit(from, to, limit)}`),
  windowSpend: (squadId: string) =>
    api.get<CostWindowSpendRow[]>(`/squads/${squadId}/costs/window-spend`),
  quotaWindows: (squadId: string) =>
    api.get<ProviderQuotaResult[]>(`/squads/${squadId}/costs/quota-windows`),
};

function dateParamsWithLimit(from?: string, to?: string, limit?: number): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
