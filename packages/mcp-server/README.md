# Slaw MCP Server

Model Context Protocol server for Slaw.

This package is a thin MCP wrapper over the existing Slaw REST API. It does
not talk to the database directly and it does not reimplement business logic.

## Authentication

The server reads its configuration from environment variables:

- `SLAW_API_URL` - Slaw base URL, for example `http://localhost:3100`
- `SLAW_API_KEY` - bearer token used for `/api` requests
- `SLAW_SQUAD_ID` - optional default squad for squad-scoped tools
- `SLAW_AGENT_ID` - optional default agent for checkout helpers
- `SLAW_RUN_ID` - optional run id forwarded on mutating requests

## Usage

```sh
npx -y @slaw-ai/mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @slaw-ai/mcp-server build
node packages/mcp-server/dist/stdio.js
```

## Tool Surface

Read tools:

- `slawMe`
- `slawInboxLite`
- `slawListAgents`
- `slawGetAgent`
- `slawListIssues`
- `slawGetIssue`
- `slawGetHeartbeatContext`
- `slawListComments`
- `slawGetComment`
- `slawListIssueApprovals`
- `slawListDocuments`
- `slawGetDocument`
- `slawListDocumentRevisions`
- `slawListProjects`
- `slawGetProject`
- `slawGetIssueWorkspaceRuntime`
- `slawWaitForIssueWorkspaceService`
- `slawListGoals`
- `slawGetGoal`
- `slawListApprovals`
- `slawGetApproval`
- `slawGetApprovalIssues`
- `slawListApprovalComments`

Write tools:

- `slawCreateIssue`
- `slawUpdateIssue`
- `slawCheckoutIssue`
- `slawReleaseIssue`
- `slawAddComment`
- `slawSuggestTasks`
- `slawAskUserQuestions`
- `slawRequestConfirmation`
- `slawUpsertIssueDocument`
- `slawRestoreIssueDocumentRevision`
- `slawControlIssueWorkspaceServices`
- `slawCreateApproval`
- `slawLinkIssueApproval`
- `slawUnlinkIssueApproval`
- `slawApprovalDecision`
- `slawAddApprovalComment`

Escape hatch:

- `slawApiRequest`

`slawApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that do not yet have a dedicated MCP tool.
