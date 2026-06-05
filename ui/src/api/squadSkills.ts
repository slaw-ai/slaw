import type {
  CatalogSkill,
  CatalogSkillFileDetail,
  CatalogSkillKind,
  SquadSkill,
  SquadSkillCreateRequest,
  SquadSkillDetail,
  SquadSkillFileDetail,
  SquadSkillImportResult,
  SquadSkillInstallCatalogRequest,
  SquadSkillInstallCatalogResult,
  SquadSkillListItem,
  SquadSkillProjectScanRequest,
  SquadSkillProjectScanResult,
  SquadSkillUpdateStatus,
} from "@slaw/shared";
import { api } from "./client";

export interface CatalogListQuery {
  kind?: CatalogSkillKind;
  category?: string;
  q?: string;
}

export const squadSkillsApi = {
  list: (squadId: string) =>
    api.get<SquadSkillListItem[]>(`/squads/${encodeURIComponent(squadId)}/skills`),
  detail: (squadId: string, skillId: string) =>
    api.get<SquadSkillDetail>(
      `/squads/${encodeURIComponent(squadId)}/skills/${encodeURIComponent(skillId)}`,
    ),
  updateStatus: (squadId: string, skillId: string) =>
    api.get<SquadSkillUpdateStatus>(
      `/squads/${encodeURIComponent(squadId)}/skills/${encodeURIComponent(skillId)}/update-status`,
    ),
  file: (squadId: string, skillId: string, relativePath: string) =>
    api.get<SquadSkillFileDetail>(
      `/squads/${encodeURIComponent(squadId)}/skills/${encodeURIComponent(skillId)}/files?path=${encodeURIComponent(relativePath)}`,
    ),
  updateFile: (squadId: string, skillId: string, path: string, content: string) =>
    api.patch<SquadSkillFileDetail>(
      `/squads/${encodeURIComponent(squadId)}/skills/${encodeURIComponent(skillId)}/files`,
      { path, content },
    ),
  create: (squadId: string, payload: SquadSkillCreateRequest) =>
    api.post<SquadSkill>(
      `/squads/${encodeURIComponent(squadId)}/skills`,
      payload,
    ),
  importFromSource: (squadId: string, source: string) =>
    api.post<SquadSkillImportResult>(
      `/squads/${encodeURIComponent(squadId)}/skills/import`,
      { source },
    ),
  scanProjects: (squadId: string, payload: SquadSkillProjectScanRequest = {}) =>
    api.post<SquadSkillProjectScanResult>(
      `/squads/${encodeURIComponent(squadId)}/skills/scan-projects`,
      payload,
    ),
  installUpdate: (squadId: string, skillId: string) =>
    api.post<SquadSkill>(
      `/squads/${encodeURIComponent(squadId)}/skills/${encodeURIComponent(skillId)}/install-update`,
      {},
    ),
  delete: (squadId: string, skillId: string) =>
    api.delete<SquadSkill>(
      `/squads/${encodeURIComponent(squadId)}/skills/${encodeURIComponent(skillId)}`,
    ),
  catalogList: (query: CatalogListQuery = {}) => {
    const params = new URLSearchParams();
    if (query.kind) params.set("kind", query.kind);
    if (query.category) params.set("category", query.category);
    if (query.q) params.set("q", query.q);
    const search = params.toString();
    return api.get<CatalogSkill[]>(`/skills/catalog${search ? `?${search}` : ""}`);
  },
  catalogDetail: (catalogRef: string) =>
    api.get<CatalogSkill>(`/skills/catalog/${encodeURIComponent(catalogRef)}`),
  catalogFile: (catalogRef: string, relativePath: string = "SKILL.md") =>
    api.get<CatalogSkillFileDetail>(
      `/skills/catalog/${encodeURIComponent(catalogRef)}/files?path=${encodeURIComponent(relativePath)}`,
    ),
  installCatalog: (squadId: string, payload: SquadSkillInstallCatalogRequest) =>
    api.post<SquadSkillInstallCatalogResult>(
      `/squads/${encodeURIComponent(squadId)}/skills/install-catalog`,
      payload,
    ),
};
