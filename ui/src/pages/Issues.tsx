import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { useLocation, useSearchParams } from "@/lib/router";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import { useSquad } from "../context/SquadContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { collectLiveIssueIds } from "../lib/liveIssueIds";
import { queryKeys } from "../lib/queryKeys";
import { createIssueDetailLocationState } from "../lib/issueDetailBreadcrumb";
import { EmptyState } from "../components/EmptyState";
import { IssuesList } from "../components/IssuesList";
import { CircleDot } from "lucide-react";
import type { Issue } from "@slaw/shared";

const WORKSPACE_FILTER_ISSUE_LIMIT = 1000;
const ISSUES_PAGE_SIZE = 500;

export function getNextIssuesPageOffset(
  loadedPageSize: number,
  currentOffset: number,
  pageSize: number = ISSUES_PAGE_SIZE,
): number | undefined {
  return loadedPageSize >= pageSize ? currentOffset + pageSize : undefined;
}

export function mergeIssuePagesStable(pages: Issue[][]): Issue[] {
  const seenIssueIds = new Set<string>();
  const merged: Issue[] = [];

  for (const page of pages) {
    for (const issue of page) {
      if (seenIssueIds.has(issue.id)) continue;
      seenIssueIds.add(issue.id);
      merged.push(issue);
    }
  }

  return merged;
}

export function buildIssuesSearchUrl(currentHref: string, search: string): string | null {
  const url = new URL(currentHref);
  const currentSearch = url.searchParams.get("q") ?? "";
  if (currentSearch === search) return null;

  if (search.length > 0) {
    url.searchParams.set("q", search);
  } else {
    url.searchParams.delete("q");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function Issues() {
  const { selectedSquadId } = useSquad();
  const { setBreadcrumbs } = useBreadcrumbs();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const fetchNextPageInFlightRef = useRef(false);

  const urlSearch = searchParams.get("q") ?? "";
  const [searchOverride, setSearchOverride] = useState<{ search: string; locationSearch: string } | null>(null);
  const syncedSearch = useMemo(() => {
    if (typeof window !== "undefined" && searchOverride?.locationSearch === window.location.search) {
      return searchOverride.search;
    }
    return urlSearch;
  }, [searchOverride, urlSearch, location.search]);
  const participantAgentId = searchParams.get("participantAgentId") ?? undefined;
  const initialWorkspaces = searchParams.getAll("workspace").filter((workspaceId) => workspaceId.length > 0);
  const workspaceIdFilter = initialWorkspaces.length === 1 ? initialWorkspaces[0] : undefined;
  const handleSearchChange = useCallback((search: string) => {
    const nextUrl = buildIssuesSearchUrl(window.location.href, search);
    if (!nextUrl) {
      setSearchOverride(null);
      return;
    }
    window.history.replaceState(window.history.state, "", nextUrl);
    setSearchOverride({ search, locationSearch: window.location.search });
  }, []);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedSquadId!),
    queryFn: () => agentsApi.list(selectedSquadId!),
    enabled: !!selectedSquadId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedSquadId!),
    queryFn: () => projectsApi.list(selectedSquadId!),
    enabled: !!selectedSquadId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedSquadId!),
    queryFn: () => heartbeatsApi.liveRunsForSquad(selectedSquadId!),
    enabled: !!selectedSquadId,
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => collectLiveIssueIds(liveRuns), [liveRuns]);

  const issueLinkState = useMemo(
    () =>
      createIssueDetailLocationState(
        "Issues",
        `${location.pathname}${location.search}${location.hash}`,
        "issues",
      ),
    [location.pathname, location.search, location.hash],
  );

  useEffect(() => {
    setBreadcrumbs([{ label: "Issues" }]);
  }, [setBreadcrumbs]);

  const issuePageSize = workspaceIdFilter ? WORKSPACE_FILTER_ISSUE_LIMIT : ISSUES_PAGE_SIZE;

  const {
    data: issuePages,
    isLoading,
    isFetchingNextPage,
    error,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: [
      ...queryKeys.issues.list(selectedSquadId!),
      "participant-agent",
      participantAgentId ?? "__all__",
      "workspace",
      workspaceIdFilter ?? "__all__",
      "with-routine-executions",
      "infinite",
      issuePageSize,
    ],
    queryFn: ({ pageParam }) => issuesApi.list(selectedSquadId!, {
      participantAgentId,
      workspaceId: workspaceIdFilter,
      includeRoutineExecutions: true,
      limit: issuePageSize,
      offset: pageParam,
      sortField: "updated",
      sortDir: "desc",
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      getNextIssuesPageOffset(lastPage.length, lastPageParam, issuePageSize),
    enabled: !!selectedSquadId,
    placeholderData: (previousData) => previousData,
  });

  const issues = useMemo(() => mergeIssuePagesStable(issuePages?.pages ?? []), [issuePages]);
  const hasMoreServerIssues = syncedSearch.trim().length === 0
    && hasNextPage === true;
  const loadMoreServerIssues = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || fetchNextPageInFlightRef.current) return;
    fetchNextPageInFlightRef.current = true;
    void fetchNextPage({ cancelRefetch: false }).finally(() => {
      fetchNextPageInFlightRef.current = false;
    });
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedSquadId!) });
    },
  });

  if (!selectedSquadId) {
    return <EmptyState icon={CircleDot} message="Select a squad to view issues." />;
  }

  return (
    <IssuesList
      issues={issues ?? []}
      isLoading={isLoading}
      isLoadingMoreIssues={isFetchingNextPage}
      error={error as Error | null}
      agents={agents}
      projects={projects}
      liveIssueIds={liveIssueIds}
      viewStateKey="slaw:issues-view"
      issueLinkState={issueLinkState}
      initialAssignees={searchParams.get("assignee") ? [searchParams.get("assignee")!] : undefined}
      initialWorkspaces={initialWorkspaces.length > 0 ? initialWorkspaces : undefined}
      initialSearch={syncedSearch}
      onSearchChange={handleSearchChange}
      enableRoutineVisibilityFilter
      hasMoreIssues={hasMoreServerIssues}
      onLoadMoreIssues={loadMoreServerIssues}
      onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
      searchFilters={participantAgentId || workspaceIdFilter ? { participantAgentId, workspaceId: workspaceIdFilter } : undefined}
    />
  );
}
