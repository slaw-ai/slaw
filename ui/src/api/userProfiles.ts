import type { UserProfileResponse } from "@slaw-ai/shared";
import { api } from "./client";

export const userProfilesApi = {
  get: (squadId: string, userSlug: string) =>
    api.get<UserProfileResponse>(
      `/squads/${squadId}/users/${encodeURIComponent(userSlug)}/profile`,
    ),
};
