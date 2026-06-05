import type { IssuePriority, IssueStatus } from "../constants.js";

export const SQUAD_SEARCH_SCOPES = ["all", "issues", "comments", "documents", "agents", "projects"] as const;
export type SquadSearchScope = (typeof SQUAD_SEARCH_SCOPES)[number];

export type SquadSearchResultType = "issue" | "agent" | "project";

export interface SquadSearchHighlight {
  start: number;
  end: number;
}

export interface SquadSearchSnippet {
  field: string;
  label: string;
  text: string;
  highlights: SquadSearchHighlight[];
}

export interface SquadSearchIssueSummary {
  id: string;
  identifier: string | null;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  projectId: string | null;
  updatedAt: string;
}

export interface SquadSearchResult {
  id: string;
  type: SquadSearchResultType;
  score: number;
  title: string;
  href: string;
  matchedFields: string[];
  sourceLabel: string | null;
  snippet: string | null;
  snippets: SquadSearchSnippet[];
  issue?: SquadSearchIssueSummary;
  updatedAt: string | null;
  previewImageUrl: string | null;
}

export interface SquadSearchResponse {
  query: string;
  normalizedQuery: string;
  scope: SquadSearchScope;
  limit: number;
  offset: number;
  results: SquadSearchResult[];
  countsByType: Record<SquadSearchResultType, number>;
  hasMore: boolean;
}
