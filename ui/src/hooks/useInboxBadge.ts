import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accessApi } from "../api/access";
import { ApiError } from "../api/client";
import { inboxDismissalsApi } from "../api/inboxDismissals";
import { approvalsApi } from "../api/approvals";
import { authApi } from "../api/auth";
import { dashoperatorApi } from "../api/dashboard";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import {
  buildInboxDismissedAtByKey,
  computeInboxBadgeData,
  getRecentTouchedIssues,
  loadDismissedInboxAlerts,
  saveDismissedInboxAlerts,
  loadReadInboxItems,
  saveReadInboxItems,
  READ_ITEMS_KEY,
} from "../lib/inbox";

const INBOX_ISSUE_STATUSES = "backlog,todo,in_progress,in_review,blocked,done";
const INBOX_BADGE_ISSUE_LIMIT = 500;
const INBOX_BADGE_HEARTBEAT_RUN_LIMIT = 200;

export function useDismissedInboxAlerts() {
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissedInboxAlerts);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== "slaw:inbox:dismissed") return;
      setDismissed(loadDismissedInboxAlerts());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissedInboxAlerts(next);
      return next;
    });
  };

  return { dismissed, dismiss };
}

export function useInboxDismissals(squadId: string | null | undefined) {
  const queryClient = useQueryClient();
  const queryKey = squadId
    ? queryKeys.inboxDismissals(squadId)
    : ["inbox-dismissals", "__disabled__"] as const;

  const { data: dismissals = [] } = useQuery({
    queryKey,
    queryFn: () => inboxDismissalsApi.list(squadId!),
    enabled: !!squadId,
  });

  const dismissMutation = useMutation({
    mutationFn: ({ itemKey }: { itemKey: string }) => inboxDismissalsApi.dismiss(squadId!, itemKey),
    onMutate: async ({ itemKey }) => {
      if (!squadId) return { previous: [] as typeof dismissals };
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<typeof dismissals>(queryKey) ?? [];
      const now = new Date();
      queryClient.setQueryData(queryKey, [
        {
          id: `optimistic:${itemKey}`,
          squadId,
          userId: "me",
          itemKey,
          dismissedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        ...previous.filter((dismissal) => dismissal.itemKey !== itemKey),
      ]);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      if (!squadId) return;
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(squadId) });
    },
  });

  const dismissedAtByKey = useMemo(
    () => buildInboxDismissedAtByKey(dismissals),
    [dismissals],
  );

  return {
    dismissals,
    dismissedAtByKey,
    dismiss: (itemKey: string) => dismissMutation.mutate({ itemKey }),
    isPending: dismissMutation.isPending,
  };
}

export function useReadInboxItems() {
  const [readItems, setReadItems] = useState<Set<string>>(loadReadInboxItems);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== READ_ITEMS_KEY) return;
      setReadItems(loadReadInboxItems());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const markRead = (id: string) => {
    setReadItems((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveReadInboxItems(next);
      return next;
    });
  };

  const markUnread = (id: string) => {
    setReadItems((prev) => {
      const next = new Set(prev);
      next.delete(id);
      saveReadInboxItems(next);
      return next;
    });
  };

  return { readItems, markRead, markUnread };
}

export function useInboxBadge(squadId: string | null | undefined) {
  const { dismissed: dismissedAlerts } = useDismissedInboxAlerts();
  const { dismissedAtByKey } = useInboxDismissals(squadId);
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const { data: approvals = [] } = useQuery({
    queryKey: queryKeys.approvals.list(squadId!),
    queryFn: () => approvalsApi.list(squadId!),
    enabled: !!squadId,
  });

  const { data: joinRequests = [] } = useQuery({
    queryKey: queryKeys.access.joinRequests(squadId!),
    queryFn: async () => {
      try {
        return await accessApi.listJoinRequests(squadId!, "pending_approval");
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          return [];
        }
        throw err;
      }
    },
    enabled: !!squadId,
    retry: false,
  });

  const { data: dashboard } = useQuery({
    queryKey: queryKeys.dashboard(squadId!),
    queryFn: () => dashoperatorApi.summary(squadId!),
    enabled: !!squadId,
  });

  const { data: mineIssuesRaw = [] } = useQuery({
    queryKey: queryKeys.issues.listMineByMe(squadId!),
    queryFn: () =>
      issuesApi.list(squadId!, {
        touchedByUserId: "me",
        inboxArchivedByUserId: "me",
        status: INBOX_ISSUE_STATUSES,
        limit: INBOX_BADGE_ISSUE_LIMIT,
      }),
    enabled: !!squadId,
  });

  const mineIssues = useMemo(() => getRecentTouchedIssues(mineIssuesRaw), [mineIssuesRaw]);
  const currentUserId = session?.user.id ?? session?.session.userId ?? null;

  const { data: heartbeatRuns = [] } = useQuery({
    queryKey: [...queryKeys.heartbeats(squadId!), "limit", INBOX_BADGE_HEARTBEAT_RUN_LIMIT],
    queryFn: () => heartbeatsApi.list(squadId!, undefined, INBOX_BADGE_HEARTBEAT_RUN_LIMIT),
    enabled: !!squadId,
  });

  return useMemo(
    () =>
      computeInboxBadgeData({
        approvals,
        joinRequests,
        dashboard,
        heartbeatRuns,
        mineIssues,
        dismissedAlerts,
        dismissedAtByKey,
        currentUserId,
      }),
    [approvals, joinRequests, dashboard, heartbeatRuns, mineIssues, dismissedAlerts, dismissedAtByKey, currentUserId],
  );
}
