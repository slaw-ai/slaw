import type { SquadSearchResponse, SquadSearchScope } from "@slaw-ai/shared";
import { api } from "./client";

export interface SquadSearchParams {
  q: string;
  scope?: SquadSearchScope;
  limit?: number;
  offset?: number;
}

export const searchApi = {
  search: (squadId: string, params: SquadSearchParams) => {
    const search = new URLSearchParams();
    search.set("q", params.q);
    if (params.scope) search.set("scope", params.scope);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.offset !== undefined) search.set("offset", String(params.offset));
    const qs = search.toString();
    return api.get<SquadSearchResponse>(
      `/squads/${squadId}/search${qs ? `?${qs}` : ""}`,
    );
  },
};
