export const queryKeys = {
  squads: {
    all: ["squads"] as const,
    detail: (id: string) => ["squads", id] as const,
    stats: ["squads", "stats"] as const,
  },
  squadSkills: {
    list: (squadId: string) => ["squad-skills", squadId] as const,
    detail: (squadId: string, skillId: string) => ["squad-skills", squadId, skillId] as const,
    updateStatus: (squadId: string, skillId: string) =>
      ["squad-skills", squadId, skillId, "update-status"] as const,
    file: (squadId: string, skillId: string, relativePath: string) =>
      ["squad-skills", squadId, skillId, "file", relativePath] as const,
    catalog: (filters: { kind?: string; category?: string; q?: string } = {}) =>
      ["squad-skills", "catalog", filters.kind ?? "__all-kinds__", filters.category ?? "__all-categories__", filters.q ?? ""] as const,
    catalogDetail: (catalogRef: string) => ["squad-skills", "catalog", "detail", catalogRef] as const,
    catalogFile: (catalogRef: string, relativePath: string) =>
      ["squad-skills", "catalog", "file", catalogRef, relativePath] as const,
  },
  agents: {
    list: (squadId: string) => ["agents", squadId] as const,
    detail: (id: string) => ["agents", "detail", id] as const,
    runtimeState: (id: string) => ["agents", "runtime-state", id] as const,
    taskSessions: (id: string) => ["agents", "task-sessions", id] as const,
    skills: (id: string) => ["agents", "skills", id] as const,
    instructionsBundle: (id: string) => ["agents", "instructions-bundle", id] as const,
    instructionsFile: (id: string, relativePath: string) =>
      ["agents", "instructions-bundle", id, "file", relativePath] as const,
    keys: (agentId: string) => ["agents", "keys", agentId] as const,
    configRevisions: (agentId: string) => ["agents", "config-revisions", agentId] as const,
    adapterModels: (squadId: string, adapterType: string, environmentId?: string | null) =>
      ["agents", squadId, "adapter-models", adapterType, environmentId ?? null] as const,
    adapterModelProfiles: (squadId: string, adapterType: string) =>
      ["agents", squadId, "adapter-model-profiles", adapterType] as const,
    detectModel: (squadId: string, adapterType: string) =>
      ["agents", squadId, "detect-model", adapterType] as const,
  },
  issues: {
    list: (squadId: string) => ["issues", squadId] as const,
    search: (squadId: string, q: string, projectId?: string, limit?: number) =>
      ["issues", squadId, "search", q, projectId ?? "__all-projects__", limit ?? "__no-limit__"] as const,
    listAssignedToMe: (squadId: string) => ["issues", squadId, "assigned-to-me"] as const,
    listMineByMe: (squadId: string) => ["issues", squadId, "mine-by-me"] as const,
    listTouchedByMe: (squadId: string) => ["issues", squadId, "touched-by-me"] as const,
    listUnreadTouchedByMe: (squadId: string) => ["issues", squadId, "unread-touched-by-me"] as const,
    listBlockedAttention: (squadId: string) => ["issues", squadId, "blocked-attention"] as const,
    countBlockedAttention: (squadId: string) => ["issues", squadId, "blocked-attention", "count"] as const,
    labels: (squadId: string) => ["issues", squadId, "labels"] as const,
    listByProject: (squadId: string, projectId: string) =>
      ["issues", squadId, "project", projectId] as const,
    listPluginOperationsByProject: (squadId: string, projectId: string, originKindPrefix: string) =>
      ["issues", squadId, "project", projectId, "plugin-operations", originKindPrefix] as const,
    listByParent: (squadId: string, parentId: string) =>
      ["issues", squadId, "parent", parentId] as const,
    listByDescendantRoot: (squadId: string, rootIssueId: string) =>
      ["issues", squadId, "descendants", rootIssueId] as const,
    listByExecutionWorkspace: (squadId: string, executionWorkspaceId: string) =>
      ["issues", squadId, "execution-workspace", executionWorkspaceId] as const,
    detail: (id: string) => ["issues", "detail", id] as const,
    comments: (issueId: string) => ["issues", "comments", issueId] as const,
    interactions: (issueId: string) => ["issues", "interactions", issueId] as const,
    acceptedPlanDecompositions: (issueId: string) =>
      ["issues", "accepted-plan-decompositions", issueId] as const,
    feedbackVotes: (issueId: string) => ["issues", "feedback-votes", issueId] as const,
    costSummary: (issueId: string, options: { excludeRoot?: boolean } = {}) =>
      options.excludeRoot
        ? (["issues", "cost-summary", issueId, "exclude-root"] as const)
        : (["issues", "cost-summary", issueId] as const),
    attachments: (issueId: string) => ["issues", "attachments", issueId] as const,
    attachmentPreview: (attachmentId: string) => ["issues", "attachment-preview", attachmentId] as const,
    documents: (issueId: string) => ["issues", "documents", issueId] as const,
    document: (issueId: string, key: string) => ["issues", "document", issueId, key] as const,
    documentRevisions: (issueId: string, key: string) => ["issues", "document-revisions", issueId, key] as const,
    documentAnnotations: (issueId: string, key: string, status: "open" | "resolved" | "all" = "all") =>
      ["issues", "document-annotations", issueId, key, status] as const,
    activity: (issueId: string) => ["issues", "activity", issueId] as const,
    runs: (issueId: string) => ["issues", "runs", issueId] as const,
    approvals: (issueId: string) => ["issues", "approvals", issueId] as const,
    liveRuns: (issueId: string) => ["issues", "live-runs", issueId] as const,
    activeRun: (issueId: string) => ["issues", "active-run", issueId] as const,
    workProducts: (issueId: string) => ["issues", "work-products", issueId] as const,
  },
  routines: {
    list: (squadId: string, filters?: { projectId?: string | null }) =>
      ["routines", squadId, filters?.projectId ?? "__all-projects__"] as const,
    detail: (id: string) => ["routines", "detail", id] as const,
    runs: (id: string) => ["routines", "runs", id] as const,
    revisions: (id: string) => ["routines", "revisions", id] as const,
    activity: (squadId: string, id: string) => ["routines", "activity", squadId, id] as const,
  },
  executionWorkspaces: {
    list: (squadId: string, filters?: Record<string, string | boolean | undefined>) =>
      ["execution-workspaces", squadId, filters ?? {}] as const,
    summaryList: (squadId: string, filters?: Record<string, string | boolean | undefined>) =>
      ["execution-workspaces", squadId, "summary", filters ?? {}] as const,
    detail: (id: string) => ["execution-workspaces", "detail", id] as const,
    closeReadiness: (id: string) => ["execution-workspaces", "close-readiness", id] as const,
    workspaceOperations: (id: string) => ["execution-workspaces", "workspace-operations", id] as const,
  },
  environments: {
    list: (squadId: string) => ["environments", squadId] as const,
  },
  projects: {
    list: (squadId: string) => ["projects", squadId] as const,
    detail: (id: string) => ["projects", "detail", id] as const,
  },
  goals: {
    list: (squadId: string) => ["goals", squadId] as const,
    detail: (id: string) => ["goals", "detail", id] as const,
  },
  budgets: {
    overview: (squadId: string) => ["budgets", "overview", squadId] as const,
  },
  approvals: {
    list: (squadId: string, status?: string) =>
      ["approvals", squadId, status] as const,
    detail: (approvalId: string) => ["approvals", "detail", approvalId] as const,
    comments: (approvalId: string) => ["approvals", "comments", approvalId] as const,
    issues: (approvalId: string) => ["approvals", "issues", approvalId] as const,
  },
  access: {
    invites: (squadId: string, state: string = "all", limit: number = 20) =>
      ["access", "invites", "paginated-v1", squadId, state, limit] as const,
    joinRequests: (squadId: string, status: string = "pending_approval") =>
      ["access", "join-requests", squadId, status] as const,
    squadMembers: (squadId: string) => ["access", "squad-members", squadId] as const,
    squadUserDirectory: (squadId: string) => ["access", "squad-user-directory", squadId] as const,
    adminUsers: (query: string) => ["access", "admin-users", query] as const,
    userSquadAccess: (userId: string) => ["access", "user-squad-access", userId] as const,
    invite: (token: string) => ["access", "invite", token] as const,
    currentBoardAccess: ["access", "current-board-access"] as const,
  },
  auth: {
    session: ["auth", "session"] as const,
  },
  sidebarPreferences: {
    squadOrder: (userId: string) => ["sidebar-preferences", "squad-order", userId] as const,
    projectOrder: (squadId: string, userId: string) =>
      ["sidebar-preferences", "project-order", squadId, userId] as const,
  },
  resourceMemberships: {
    mine: (squadId: string) => ["resource-memberships", squadId, "me"] as const,
  },
  instance: {
    generalSettings: ["instance", "general-settings"] as const,
    schedulerHeartbeats: ["instance", "scheduler-heartbeats"] as const,
    experimentalSettings: ["instance", "experimental-settings"] as const,
  },
  cloudUpstreams: (squadId: string) => ["cloud-upstreams", squadId] as const,
  health: ["health"] as const,
  secrets: {
    list: (squadId: string) => ["secrets", squadId] as const,
    providers: (squadId: string) => ["secret-providers", squadId] as const,
    providerConfigs: (squadId: string) => ["secret-provider-configs", squadId] as const,
    usage: (secretId: string) => ["secrets", "usage", secretId] as const,
    accessEvents: (secretId: string) => ["secrets", "access-events", secretId] as const,
  },
  squadSearch: {
    search: (squadId: string, q: string, scope: string, limit: number, offset: number) =>
      ["squad-search", squadId, q, scope, limit, offset] as const,
  },
  dashboard: (squadId: string) => ["dashboard", squadId] as const,
  userProfile: (squadId: string, userSlug: string) =>
    ["user-profile", squadId, userSlug] as const,
  sidebarBadges: (squadId: string) => ["sidebar-badges", squadId] as const,
  inboxDismissals: (squadId: string) => ["inbox-dismissals", squadId] as const,
  activity: (squadId: string) => ["activity", squadId] as const,
  costs: (squadId: string, from?: string, to?: string) =>
    ["costs", squadId, from, to] as const,
  usageByProvider: (squadId: string, from?: string, to?: string) =>
    ["usage-by-provider", squadId, from, to] as const,
  usageByBiller: (squadId: string, from?: string, to?: string) =>
    ["usage-by-biller", squadId, from, to] as const,
  financeSummary: (squadId: string, from?: string, to?: string) =>
    ["finance-summary", squadId, from, to] as const,
  financeByBiller: (squadId: string, from?: string, to?: string) =>
    ["finance-by-biller", squadId, from, to] as const,
  financeByKind: (squadId: string, from?: string, to?: string) =>
    ["finance-by-kind", squadId, from, to] as const,
  financeEvents: (squadId: string, from?: string, to?: string, limit: number = 100) =>
    ["finance-events", squadId, from, to, limit] as const,
  usageWindowSpend: (squadId: string) =>
    ["usage-window-spend", squadId] as const,
  usageQuotaWindows: (squadId: string) =>
    ["usage-quota-windows", squadId] as const,
  heartbeats: (squadId: string, agentId?: string) =>
    ["heartbeats", squadId, agentId] as const,
  runDetail: (runId: string) => ["heartbeat-run", runId] as const,
  runWorkspaceOperations: (runId: string) => ["heartbeat-run", runId, "workspace-operations"] as const,
  liveRuns: (squadId: string) => ["live-runs", squadId] as const,
  runIssues: (runId: string) => ["run-issues", runId] as const,
  org: (squadId: string) => ["org", squadId] as const,
  skills: {
    available: ["skills", "available"] as const,
  },
  plugins: {
    all: ["plugins"] as const,
    examples: ["plugins", "examples"] as const,
    detail: (pluginId: string) => ["plugins", pluginId] as const,
    health: (pluginId: string) => ["plugins", pluginId, "health"] as const,
    uiContributions: ["plugins", "ui-contributions"] as const,
    config: (pluginId: string) => ["plugins", pluginId, "config"] as const,
    localFolders: (pluginId: string, squadId: string) =>
      ["plugins", pluginId, "squads", squadId, "local-folders"] as const,
    dashboard: (pluginId: string) => ["plugins", pluginId, "dashboard"] as const,
    logs: (pluginId: string) => ["plugins", pluginId, "logs"] as const,
  },
  adapters: {
    all: ["adapters"] as const,
  },
};
