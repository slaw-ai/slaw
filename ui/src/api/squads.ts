import type {
  Squad,
  SquadPortabilityExportRequest,
  SquadPortabilityExportPreviewResult,
  SquadPortabilityExportResult,
  SquadPortabilityImportRequest,
  SquadPortabilityImportResult,
  SquadPortabilityPreviewRequest,
  SquadPortabilityPreviewResult,
  UpdateSquadBranding,
} from "@slaw/shared";
import { api } from "./client";

export type SquadStats = Record<string, { agentCount: number; issueCount: number }>;

export const squadsApi = {
  list: () => api.get<Squad[]>("/squads"),
  get: (squadId: string) => api.get<Squad>(`/squads/${squadId}`),
  stats: () => api.get<SquadStats>("/squads/stats"),
  create: (data: {
    name: string;
    description?: string | null;
    budgetMonthlyCents?: number;
  }) =>
    api.post<Squad>("/squads", data),
  update: (
    squadId: string,
    data: Partial<
      Pick<
        Squad,
        | "name"
        | "description"
        | "status"
        | "budgetMonthlyCents"
        | "attachmentMaxBytes"
        | "requireOperatorApprovalForNewAgents"
        | "feedbackDataSharingEnabled"
        | "brandColor"
        | "logoAssetId"
      >
    >,
  ) => api.patch<Squad>(`/squads/${squadId}`, data),
  updateBranding: (squadId: string, data: UpdateSquadBranding) =>
    api.patch<Squad>(`/squads/${squadId}/branding`, data),
  archive: (squadId: string) => api.post<Squad>(`/squads/${squadId}/archive`, {}),
  remove: (squadId: string) => api.delete<{ ok: true }>(`/squads/${squadId}`),
  exportBundle: (
    squadId: string,
    data: SquadPortabilityExportRequest,
  ) =>
    api.post<SquadPortabilityExportResult>(`/squads/${squadId}/exports`, data),
  exportPreview: (
    squadId: string,
    data: SquadPortabilityExportRequest,
  ) =>
    api.post<SquadPortabilityExportPreviewResult>(`/squads/${squadId}/exports/preview`, data),
  importPreview: (data: SquadPortabilityPreviewRequest) =>
    api.post<SquadPortabilityPreviewResult>("/squads/import/preview", data),
  importBundle: (data: SquadPortabilityImportRequest) =>
    api.post<SquadPortabilityImportResult>("/squads/import", data),
};
