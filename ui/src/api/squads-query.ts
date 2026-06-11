import type { Squad } from "@slaw-ai/shared";
import { squadsApi } from "./squads";
import { ApiError } from "./client";
import { queryKeys } from "../lib/queryKeys";

export type SquadListResult = { squads: Squad[]; unauthorized: boolean };

// Single source of truth for the `["squads"]` query. Both SquadProvider and
// the invite landing page read this cache entry, so they must agree on the shape —
// returning a bare `Squad[]` from one and this wrapped object from the other
// silently corrupts the shared cache and crashes whichever reads the other's shape.
export const squadsListQueryOptions = {
  queryKey: queryKeys.squads.all,
  queryFn: async (): Promise<SquadListResult> => {
    try {
      return { squads: await squadsApi.list(), unauthorized: false };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return { squads: [], unauthorized: true };
      }
      throw err;
    }
  },
  retry: false,
} as const;
