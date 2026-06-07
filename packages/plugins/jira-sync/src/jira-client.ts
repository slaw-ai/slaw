/**
 * Thin client for the Jira Cloud REST API (v3 + Agile v1).
 *
 * All network access goes through an injected `fetch` implementation so the
 * client uses the host-provided `ctx.http.fetch` (which enforces the
 * `http.outbound` capability) rather than global fetch. This also makes the
 * client trivially testable with a stub.
 */

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: string | null;
    priority: { name: string } | null;
    status: { name: string; statusCategory: { name: string } };
    issuetype: { name: string };
  };
}

export interface JiraTransition {
  id: string;
  name: string;
  to?: { name?: string };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface JiraClientOptions {
  /** Base URL of the Jira site, e.g. `https://acme.atlassian.net`. */
  baseUrl: string;
  /** Atlassian account email used for Basic auth. */
  username: string;
  /** Atlassian API token. */
  apiToken: string;
  /** Board id whose issues are synced. */
  boardId: string;
  /** Host-provided outbound fetch (ctx.http.fetch). */
  fetch: FetchLike;
}

const PAGE_SIZE = 50;

export class JiraClient {
  private readonly baseUrl: string;
  private readonly boardId: string;
  private readonly authHeader: string;
  private readonly doFetch: FetchLike;

  constructor(options: JiraClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.boardId = options.boardId;
    this.doFetch = options.fetch;
    const token = Buffer.from(`${options.username}:${options.apiToken}`).toString("base64");
    this.authHeader = `Basic ${token}`;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (init.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const response = await this.doFetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new JiraApiError(
        `Jira API ${init.method ?? "GET"} ${path} failed: ${response.status} ${response.statusText}${
          detail ? ` — ${detail.slice(0, 500)}` : ""
        }`,
        response.status,
      );
    }
    return response;
  }

  /** Fetch every issue on the configured board, paginating until exhausted. */
  async getBoardIssues(): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];
    let startAt = 0;
    for (;;) {
      const params = new URLSearchParams({
        maxResults: String(PAGE_SIZE),
        startAt: String(startAt),
        fields: "summary,description,priority,status,issuetype",
      });
      const response = await this.request(
        `/rest/agile/1.0/board/${encodeURIComponent(this.boardId)}/issue?${params.toString()}`,
      );
      const page = (await response.json()) as { issues?: JiraIssue[]; total?: number };
      const batch = page.issues ?? [];
      issues.push(...batch);
      startAt += batch.length;
      const total = page.total ?? issues.length;
      if (batch.length === 0 || issues.length >= total) break;
    }
    return issues;
  }

  /**
   * Move an issue to a new status by applying the transition whose target
   * status (or transition name) matches `targetStatusName`.
   *
   * Returns `false` when no matching transition is available (so callers can
   * log rather than throw — Jira workflows vary per project).
   */
  async updateIssueStatus(issueKey: string, targetStatusName: string): Promise<boolean> {
    const response = await this.request(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    );
    const body = (await response.json()) as { transitions?: JiraTransition[] };
    const transitions = body.transitions ?? [];
    const wanted = targetStatusName.toLowerCase();
    const match =
      transitions.find((t) => (t.to?.name ?? "").toLowerCase() === wanted) ??
      transitions.find((t) => t.name.toLowerCase() === wanted);
    if (!match) return false;
    await this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: match.id } }),
    });
    return true;
  }

  /** Append a plain-text comment (as an ADF document) to a Jira issue. */
  async addComment(issueKey: string, lines: string[]): Promise<void> {
    const body = {
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: lines.join("\n") }],
          },
        ],
      },
    };
    await this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

export class JiraApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}
