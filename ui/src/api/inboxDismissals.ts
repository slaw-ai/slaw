import type { InboxDismissal } from "@slaw/shared";
import { api } from "./client";

export const inboxDismissalsApi = {
  list: (squadId: string) => api.get<InboxDismissal[]>(`/squads/${squadId}/inbox-dismissals`),
  dismiss: (squadId: string, itemKey: string) =>
    api.post<InboxDismissal>(`/squads/${squadId}/inbox-dismissals`, { itemKey }),
};
