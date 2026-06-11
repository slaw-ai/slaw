# `@slaw-ai/plugin-sdk`

Official TypeScript SDK for Slaw plugin authors.

- **Worker SDK:** `@slaw-ai/plugin-sdk` — `definePlugin`, context, lifecycle
- **UI SDK:** `@slaw-ai/plugin-sdk/ui` — React hooks and slot props
- **Testing:** `@slaw-ai/plugin-sdk/testing` — in-memory host harness
- **Bundlers:** `@slaw-ai/plugin-sdk/bundlers` — esbuild/rollup presets
- **Dev server:** `@slaw-ai/plugin-sdk/dev-server` — static UI server + SSE reload

Reference: `doc/plugins/PLUGIN_SPEC.md`

## Package surface

| Import | Purpose |
|--------|--------|
| `@slaw-ai/plugin-sdk` | Worker entry: `definePlugin`, `runWorker`, context types, protocol helpers |
| `@slaw-ai/plugin-sdk/ui` | UI entry: `usePluginData`, `usePluginAction`, `usePluginStream`, `useHostContext`, `useHostNavigation`, slot prop types |
| `@slaw-ai/plugin-sdk/ui/hooks` | Hooks only |
| `@slaw-ai/plugin-sdk/ui/types` | UI types and slot prop interfaces |
| `@slaw-ai/plugin-sdk/testing` | `createTestHarness` for unit/integration tests |
| `@slaw-ai/plugin-sdk/bundlers` | `createPluginBundlerPresets` for worker/manifest/ui builds |
| `@slaw-ai/plugin-sdk/dev-server` | `startPluginDevServer`, `getUiBuildSnapshot` |
| `@slaw-ai/plugin-sdk/protocol` | JSON-RPC protocol types and helpers (advanced) |
| `@slaw-ai/plugin-sdk/types` | Worker context and API types (advanced) |

## Manifest entrypoints

In your plugin manifest you declare:

- **`entrypoints.worker`** (required) — Path to the worker bundle (e.g. `dist/worker.js`). The host loads this and calls `setup(ctx)`.
- **`entrypoints.ui`** (required if you use UI) — Path to the UI bundle directory. The host loads components from here for slots and launchers.

## Install

```bash
pnpm add @slaw-ai/plugin-sdk
```

## Current deployment caveats

The SDK is stable enough for local development and first-party examples, but the runtime deployment model is still early.

- Plugin workers and plugin UI should both be treated as trusted code today.
- Plugin UI bundles run as same-origin JavaScript inside the main Slaw app. They can call ordinary Slaw HTTP APIs with the operator session, so manifest capabilities are not a frontend sandbox.
- Local-path installs and the repo example plugins are development workflows. They assume the plugin source checkout exists on disk.
- For deployed plugins, publish an npm package and install that package into the Slaw instance at runtime.
- The current host runtime expects a writable filesystem, `npm` available at runtime, and network access to the package registry used for plugin installation.
- Dynamic plugin install is currently best suited to single-node persistent deployments. Multi-instance cloud deployments still need a shared artifact/distribution model before runtime installs are reliable across nodes.
- The host ships a small shared React component kit through `@slaw-ai/plugin-sdk/ui`. Use it for native Slaw controls; custom React and CSS are still supported.
- `ctx.assets` is not part of the supported runtime in this build. Do not depend on asset upload/read APIs yet.

If you are authoring a plugin for others to deploy, treat npm-packaged installation as the supported path and treat repo-local example installs as a development convenience.

## Worker quick start

```ts
import { definePlugin, runWorker } from "@slaw-ai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.events.on("issue.created", async (event) => {
      ctx.logger.info("Issue created", { issueId: event.entityId });
    });

    ctx.data.register("health", async () => ({ status: "ok" }));
    ctx.actions.register("ping", async () => ({ pong: true }));

    ctx.tools.register("calculator", {
      displayName: "Calculator",
      description: "Basic math",
      parametersSchema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"]
      }
    }, async (params) => {
      const { a, b } = params as { a: number; b: number };
      return { content: `Result: ${a + b}`, data: { result: a + b } };
    });
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
```

**Note:** `runWorker(plugin, import.meta.url)` must be called so that when the host runs your worker (e.g. `node dist/worker.js`), the RPC host starts and the process stays alive. When the file is imported (e.g. for tests), the main-module check prevents the host from starting.

### Worker lifecycle and context

**Lifecycle (definePlugin):**

| Hook | Purpose |
|------|--------|
| `setup(ctx)` | **Required.** Called once at startup. Register event handlers, jobs, data/actions/tools, etc. |
| `onHealth?()` | Optional. Return `{ status, message?, details? }` for health dashboard. |
| `onConfigChanged?(newConfig)` | Optional. Apply new config without restart; if omitted, host restarts worker. |
| `onShutdown?()` | Optional. Clean up before process exit (limited time window). |
| `onValidateConfig?(config)` | Optional. Return `{ ok, warnings?, errors? }` for settings UI / Test Connection. |
| `onWebhook?(input)` | Optional. Handle `POST /api/plugins/:pluginId/webhooks/:endpointKey`; required if webhooks declared. |

**Context (`ctx`) in setup:** `config`, `localFolders`, `events`, `jobs`, `launchers`, `http`, `secrets`, `activity`, `state`, `entities`, `projects`, `squads`, `issues`, `agents`, `goals`, `access`, `authorization`, `data`, `actions`, `streams`, `tools`, `metrics`, `logger`, `manifest`. Worker-side host APIs are capability-gated; declare capabilities in the manifest.

**Agents:** `ctx.agents.invoke(agentId, squadId, opts)` for one-shot invocation. `ctx.agents.sessions` for two-way chat: `create`, `list`, `sendMessage` (with streaming `onEvent` callback), `close`. See the [Plugin Authoring Guide](../../doc/plugins/PLUGIN_AUTHORING_GUIDE.md#agent-sessions-two-way-chat) for details.

**Jobs:** Declare in `manifest.jobs` with `jobKey`, `displayName`, `schedule` (cron). Register handler with `ctx.jobs.register(jobKey, fn)`. **Webhooks:** Declare in `manifest.webhooks` with `endpointKey`; handle in `onWebhook(input)`. **State:** `ctx.state.get/set/delete(scopeKey)`; scope kinds: `instance`, `squad`, `project`, `project_workspace`, `agent`, `issue`, `goal`, `run`.

**Trusted local folders:** Declare `manifest.localFolders[]` and the `local.folders` capability when a plugin needs an operator-configured squad-scoped folder. Use `ctx.localFolders.configure()`, `status()`, `readText()`, and `writeTextAtomic()` instead of resolving arbitrary filesystem paths yourself. The host validates absolute roots, read/write access, required relative folders/files, traversal attempts, symlink escapes, and writes through temp-file-plus-rename atomic replacement.

## Events

Subscribe in `setup` with `ctx.events.on(name, handler)` or `ctx.events.on(name, filter, handler)`. Emit plugin-scoped events with `ctx.events.emit(name, squadId, payload)` (requires `events.emit`).

**Core domain events (subscribe with `events.subscribe`):**

| Event | Typical entity |
|-------|-----------------|
| `squad.created`, `squad.updated` | squad |
| `project.created`, `project.updated` | project |
| `project.workspace_created`, `project.workspace_updated`, `project.workspace_deleted` | project_workspace |
| `issue.created`, `issue.updated`, `issue.comment.created` | issue |
| `issue.document.created`, `issue.document.updated`, `issue.document.deleted` | issue |
| `issue.relations.updated`, `issue.checked_out`, `issue.released`, `issue.assignment_wakeup_requested` | issue |
| `agent.created`, `agent.updated`, `agent.status_changed` | agent |
| `agent.run.started`, `agent.run.finished`, `agent.run.failed`, `agent.run.cancelled` | run |
| `goal.created`, `goal.updated` | goal |
| `approval.created`, `approval.decided` | approval |
| `budget.incident.opened`, `budget.incident.resolved` | budget_incident |
| `cost_event.created` | cost |
| `activity.logged` | activity |

**Plugin-to-plugin:** Subscribe to `plugin.<pluginId>.<eventName>` (e.g. `plugin.acme.linear.sync-done`). Emit with `ctx.events.emit("sync-done", squadId, payload)`; the host namespaces it automatically.

**Filter (optional):** Pass a second argument to `on()`: `{ projectId?, squadId?, agentId? }` so the host only delivers matching events.

**Squad context:** Events still carry `squadId` for squad-scoped data, but plugin installation and activation are instance-wide in the current runtime. Access and authorization host services require an active squad-scoped invocation such as an event, API route, tool run, environment call, or UI bridge call; the requested `squadId` must match that active scope.

## Scheduled (recurring) jobs

Plugins can declare **scheduled jobs** that the host runs on a cron schedule. Use this for recurring tasks like syncs, digest reports, or cleanup.

1. **Capability:** Add `jobs.schedule` to `manifest.capabilities`.
2. **Declare jobs** in `manifest.jobs`: each entry has `jobKey`, `displayName`, optional `description`, and `schedule` (a 5-field cron expression).
3. **Register a handler** in `setup()` with `ctx.jobs.register(jobKey, async (job) => { ... })`.

**Cron format** (5 fields: minute, hour, day-of-month, month, day-of-week):

| Field        | Values   | Example |
|-------------|----------|---------|
| minute      | 0–59     | `0`, `*/15` |
| hour        | 0–23     | `2`, `*` |
| day of month | 1–31   | `1`, `*` |
| month       | 1–12     | `*` |
| day of week | 0–6 (Sun=0) | `*`, `1-5` |

Examples: `"0 * * * *"` = every hour at minute 0; `"*/5 * * * *"` = every 5 minutes; `"0 2 * * *"` = daily at 2:00.

**Job handler context** (`PluginJobContext`):

| Field        | Type     | Description |
|-------------|----------|-------------|
| `jobKey`    | string   | Matches the manifest declaration. |
| `runId`     | string   | UUID for this run. |
| `trigger`   | `"schedule" \| "manual" \| "retry"` | What caused this run. |
| `scheduledAt` | string | ISO 8601 time when the run was scheduled. |

Runs can be triggered by the **schedule**, **manually** from the UI/API, or as a **retry** (when an operator re-runs a job after a failure). Re-throw from the handler to mark the run as failed; the host records the failure. The host does not automatically retry—operators can trigger another run manually from the UI or API.

Example:

**Manifest** — include `jobs.schedule` and declare the job:

```ts
// In your manifest (e.g. manifest.ts):
const manifest = {
  // ...
  capabilities: ["jobs.schedule", "plugin.state.write"],
  jobs: [
    {
      jobKey: "heartbeat",
      displayName: "Heartbeat",
      description: "Runs every 5 minutes",
      schedule: "*/5 * * * *",
    },
  ],
  // ...
};
```

**Worker** — register the handler in `setup()`:

```ts
ctx.jobs.register("heartbeat", async (job) => {
  ctx.logger.info("Heartbeat run", { runId: job.runId, trigger: job.trigger });
  await ctx.state.set({ scopeKind: "instance", stateKey: "last-heartbeat" }, new Date().toISOString());
});
```

## UI slots and launchers

Slots are mount points for plugin React components. Launchers are host-rendered entry points (buttons, menu items) that open plugin UI. Declare slots in `manifest.ui.slots` with `type`, `id`, `displayName`, `exportName`; for context-sensitive slots add `entityTypes`. Declare launchers in `manifest.ui.launchers` (or legacy `manifest.launchers`).

### Slot types / launcher placement zones

Slot types describe where a component mounts. Most values also exist as launcher placement zones.

| Slot type / placement zone | Scope | Entity types (when context-sensitive) |
|----------------------------|-------|---------------------------------------|
| `page` | Global | — |
| `sidebar` | Global | — |
| `routeSidebar` | Global | — |
| `sidebarPanel` | Global | — |
| `settingsPage` | Global | — |
| `dashboardWidget` | Global | — |
| `globalToolbarButton` | Global | — |
| `detailTab` | Entity | `project`, `issue`, `agent`, `goal`, `run` |
| `taskDetailView` | Entity | (task/issue context) |
| `commentAnnotation` | Entity | `comment` |
| `commentContextMenuItem` | Entity | `comment` |
| `projectSidebarItem` | Entity | `project` |
| `toolbarButton` | Entity | varies by host surface |
| `contextMenuItem` | Entity | varies by host surface |

**Scope** describes whether the slot requires an entity to render. **Global** slots render without a specific entity but still receive the active `squadId` through `PluginHostContext` — use it to scope data fetches to the current squad. **Entity** slots additionally require `entityId` and `entityType` (e.g. a detail tab on a specific issue).

**Entity types** (for `entityTypes` on slots): `project` \| `issue` \| `agent` \| `goal` \| `run` \| `comment`. Full list: import `PLUGIN_UI_SLOT_TYPES` and `PLUGIN_UI_SLOT_ENTITY_TYPES` from `@slaw-ai/plugin-sdk`.

### Slot component descriptions

#### `page`

A full-page extension mounted at `/plugins/:pluginId` (global) or `/:squad/plugins/:pluginId` (squad-context route). Use this for rich, standalone plugin experiences such as dashboards, configuration wizards, or multi-step workflows. Receives `PluginPageProps` with `context.squadId` set to the active squad. Requires the `ui.page.register` capability.

#### `sidebar`

Adds a navigation-style entry to the main squad sidebar navigation area, rendered alongside the core nav items (Dashboard, Issues, Goals, etc.). Use this for lightweight, always-visible links or status indicators that feel native to the sidebar. Receives `PluginSidebarProps` with `context.squadId` set to the active squad. Requires the `ui.sidebar.register` capability.

#### `routeSidebar`

Replaces the normal squad sidebar while the current route is a plugin page route with the same `routePath`. Use this for full-page plugin workspaces that need their own local navigation while keeping the squad rail and account footer. Receives `PluginRouteSidebarProps` with `context.squadId` and `context.squadPrefix` set to the active squad. Requires the `ui.sidebar.register` capability.

#### `sidebarPanel`

Renders richer inline content in a dedicated panel area below the squad sidebar navigation sections. Use this for mini-widgets, summary cards, quick-action panels, or at-a-glance status views that need more vertical space than a nav link. Receives `context.squadId` set to the active squad via `useHostContext()`. Requires the `ui.sidebar.register` capability.

#### `settingsPage`

Replaces the auto-generated JSON Schema settings form with a custom React component. Use this when the default form is insufficient — for example, when your plugin needs multi-step configuration, OAuth flows, "Test Connection" buttons, or rich input controls. Receives `PluginSettingsPageProps` with `context.squadId` set to the active squad. The component is responsible for reading and writing config through the bridge (via `usePluginData` and `usePluginAction`).

#### `dashboardWidget`

A card or section rendered on the main dashboard. Use this for at-a-glance metrics, status indicators, or summary views that surface plugin data alongside core Slaw information. Receives `PluginWidgetProps` with `context.squadId` set to the active squad. Requires the `ui.dashboardWidget.register` capability.

#### `detailTab`

An additional tab on a project, issue, agent, goal, or run detail page. Rendered when the user navigates to that entity's detail view. Receives `PluginDetailTabProps` with `context.squadId` set to the active squad and `context.entityId` / `context.entityType` guaranteed to be non-null, so you can immediately scope data fetches to the relevant entity. Specify which entity types the tab applies to via the `entityTypes` array in the manifest slot declaration. Requires the `ui.detailTab.register` capability.

#### `taskDetailView`

A specialized slot rendered in the context of a task or issue detail view. Similar to `detailTab` but designed for inline content within the task detail layout rather than a separate tab. Receives `context.squadId`, `context.entityId`, and `context.entityType` like `detailTab`. Requires the `ui.detailTab.register` capability.

#### `projectSidebarItem`

A link or small component rendered **once per project** under that project's row in the sidebar Projects list. Use this to add project-scoped navigation entries (e.g. "Files", "Linear Sync") that deep-link into a plugin detail tab: `/:squad/projects/:projectRef?tab=plugin:<key>:<slotId>`. Receives `PluginProjectSidebarItemProps` with `context.squadId` set to the active squad, `context.entityId` set to the project id, and `context.entityType` set to `"project"`. Use the optional `order` field in the manifest slot to control sort position. Requires the `ui.sidebar.register` capability.

#### `globalToolbarButton`

A button rendered in the global top bar (breadcrumb bar) that appears on every page. Use this for squad-wide actions that are not scoped to a specific entity — for example, a universal search trigger, a global sync status indicator, or a floating action that applies across the whole workspace. Receives only `context.squadId` and `context.squadPrefix`; no entity context is available. Requires the `ui.action.register` capability.

#### `toolbarButton`

A button rendered in the toolbar of an entity page (e.g. project detail, issue detail). Use this for short-lived, contextual actions scoped to the current entity — like triggering a project sync, opening a picker, or running a quick command on that entity. The component can open a plugin-owned modal internally for confirmations or compact forms. Receives `context.squadId`, `context.entityId`, and `context.entityType`; declare `entityTypes` in the manifest to control which entity pages the button appears on. Requires the `ui.action.register` capability.

#### `contextMenuItem`

An entry added to a right-click or overflow context menu on a host surface. Use this for secondary actions that apply to the entity under the cursor (e.g. "Copy to Linear", "Re-run analysis"). Receives `context.squadId` set to the active squad; entity context varies by host surface. Requires the `ui.action.register` capability.

#### `commentAnnotation`

A per-comment annotation region rendered below each individual comment in the issue detail timeline. Use this to augment comments with parsed file links, sentiment badges, inline actions, or any per-comment metadata. Receives `PluginCommentAnnotationProps` with `context.entityId` set to the comment UUID, `context.entityType` set to `"comment"`, `context.parentEntityId` set to the parent issue UUID, `context.projectId` set to the issue's project (if any), and `context.squadPrefix` set to the active squad slug. Requires the `ui.commentAnnotation.register` capability.

#### `commentContextMenuItem`

A per-comment context menu item rendered in the "more" dropdown menu (⋮) on each comment in the issue detail timeline. Use this to add per-comment actions such as "Create sub-issue from comment", "Translate", "Flag for review", or custom plugin actions. Receives `PluginCommentContextMenuItemProps` with `context.entityId` set to the comment UUID, `context.entityType` set to `"comment"`, `context.parentEntityId` set to the parent issue UUID, `context.projectId` set to the issue's project (if any), and `context.squadPrefix` set to the active squad slug. Plugins can open drawers, modals, or popovers scoped to that comment. The ⋮ menu button only appears on comments where at least one plugin renders visible content. Requires the `ui.action.register` capability.

### Launcher actions and render options

| Launcher action | Description |
|-----------------|-------------|
| `navigate` | Navigate to a route (plugin or host). |
| `openModal` | Open a modal. |
| `openDrawer` | Open a drawer. |
| `openPopover` | Open a popover. |
| `performAction` | Run an action (e.g. call plugin). |
| `deepLink` | Deep link to plugin or external URL. |

| Render option | Values | Description |
|---------------|--------|-------------|
| `environment` | `hostInline`, `hostOverlay`, `hostRoute`, `external`, `iframe` | Container the launcher expects after activation. |
| `bounds` | `inline`, `compact`, `default`, `wide`, `full` | Size hint for overlays/drawers. |

### Capabilities

Declare in `manifest.capabilities`. Grouped by scope:

| Scope | Capability |
|-------|------------|
| **Squad** | `squads.read` |
| | `projects.read` |
| | `project.workspaces.read` |
| | `issues.read` |
| | `issue.comments.read` |
| | `issue.documents.read` |
| | `issue.relations.read` |
| | `issue.subtree.read` |
| | `agents.read` |
| | `goals.read` |
| | `goals.create` |
| | `goals.update` |
| | `activity.read` |
| | `costs.read` |
| | `issues.orchestration.read` |
| | `access.members.read` |
| | `access.invites.read` |
| | `authorization.grants.read` |
| | `authorization.policies.read` |
| | `authorization.audit.read` |
| | `database.namespace.read` |
| | `issues.create` |
| | `issues.update` |
| | `issues.checkout` |
| | `issues.wakeup` |
| | `issue.comments.create` |
| | `issue.documents.write` |
| | `issue.relations.write` |
| | `activity.log.write` |
| | `metrics.write` |
| | `telemetry.track` |
| | `database.namespace.migrate` |
| | `database.namespace.write` |
| **Instance** | `instance.settings.register` |
| | `plugin.state.read` |
| | `plugin.state.write` |
| **Runtime** | `events.subscribe` |
| | `events.emit` |
| | `jobs.schedule` |
| | `webhooks.receive` |
| | `api.routes.register` |
| | `http.outbound` |
| | `secrets.read-ref` |
| | `environment.drivers.register` |
| | `local.folders` |
| **Agent** | `agent.tools.register` |
| | `agents.invoke` |
| | `access.members.write` |
| | `access.invites.write` |
| | `authorization.grants.write` |
| | `authorization.policies.write` |
| | `agent.sessions.create` |
| | `agent.sessions.list` |
| | `agent.sessions.send` |
| | `agent.sessions.close` |
| **UI** | `ui.sidebar.register` |
| | `ui.page.register` |
| | `ui.detailTab.register` |
| | `ui.dashboardWidget.register` |
| | `ui.commentAnnotation.register` |
| | `ui.action.register` |

Full list in code: import `PLUGIN_CAPABILITIES` from `@slaw-ai/plugin-sdk`.

### Restricted Database Namespace

Trusted orchestration plugins can declare a host-owned PostgreSQL namespace:

```ts
database: {
  migrationsDir: "migrations",
  coreReadTables: ["issues"],
}
```

Declare `database.namespace.migrate` and `database.namespace.read`; add
`database.namespace.write` when the worker needs runtime writes. Migrations run
before worker startup, are checksum-recorded, and may create or alter objects
only inside the plugin namespace. Runtime `ctx.db.query()` allows `SELECT` from
`ctx.db.namespace` plus manifest-whitelisted `public` core tables. Runtime
`ctx.db.execute()` allows `INSERT`, `UPDATE`, and `DELETE` only against the
plugin namespace.

### Trusted Local Folders

Trusted local plugins can request operator-configured folders per squad:

```ts
export const manifest = {
  // ...
  capabilities: ["local.folders"],
  localFolders: [
    {
      folderKey: "content-root",
      displayName: "Content root",
      access: "readWrite",
      requiredDirectories: ["sources", "pages"],
      requiredFiles: ["schema.md"],
    },
  ],
};
```

The host stores the selected path in squad-scoped plugin settings and exposes
readiness through:

- `GET /api/plugins/:pluginId/squads/:squadId/local-folders`
- `GET /api/plugins/:pluginId/squads/:squadId/local-folders/:folderKey/status`
- `POST /api/plugins/:pluginId/squads/:squadId/local-folders/:folderKey/validate`
- `PUT /api/plugins/:pluginId/squads/:squadId/local-folders/:folderKey`

Worker code should access files through `ctx.localFolders.readText()` and
`ctx.localFolders.writeTextAtomic()`. Relative paths must stay inside the
configured root; symlinks that escape the root are rejected.

### Scoped API Routes

Manifest-declared `apiRoutes` expose JSON routes under
`/api/plugins/:pluginId/api/*` without letting a plugin claim core paths:

```ts
apiRoutes: [
  {
    routeKey: "initialize",
    method: "POST",
    path: "/issues/:issueId/smoke",
    auth: "operator-or-agent",
    capability: "api.routes.register",
    checkoutPolicy: "required-for-agent-in-progress",
    squadResolution: { from: "issue", param: "issueId" },
  },
]
```

Implement `onApiRequest(input)` in the worker to handle the route. The host
performs auth, squad access, capability, route matching, and checkout policy
before dispatch. The worker receives route params, query, parsed JSON body,
sanitized headers, actor context, and `squadId`; responses are JSON `{ status?,
headers?, body? }`.

## Issue Orchestration APIs

Workflow plugins can use `ctx.issues` for orchestration-grade issue operations without importing host server internals.

Expanded create/update fields include blockers, billing code, board or agent assignees, labels, namespaced plugin origins, request depth, and safe execution workspace fields:

```ts
const child = await ctx.issues.create({
  squadId,
  parentId: missionIssueId,
  inheritExecutionWorkspaceFromIssueId: missionIssueId,
  title: "Implement feature slice",
  status: "todo",
  assigneeAgentId: workerAgentId,
  billingCode: "mission:alpha",
  originKind: "plugin:slaw.missions:feature",
  originId: "mission-alpha:feature-1",
  blockedByIssueIds: [planningIssueId],
});
```

If `originKind` is omitted, the host stores `plugin:<pluginKey>`. Plugins may use sub-kinds such as `plugin:<pluginKey>:feature`, but the host rejects attempts to set another plugin's namespace.

Blocker relationships are also exposed as first-class helpers:

```ts
const relations = await ctx.issues.relations.get(child.id, squadId);
await ctx.issues.relations.setBlockedBy(child.id, [planningIssueId], squadId);
await ctx.issues.relations.addBlockers(child.id, [validationIssueId], squadId);
await ctx.issues.relations.removeBlockers(child.id, [planningIssueId], squadId);
```

Subtree reads can include just the issue tree, or compact related data for orchestration dashboards:

```ts
const subtree = await ctx.issues.getSubtree(missionIssueId, squadId, {
  includeRoot: true,
  includeRelations: true,
  includeDocuments: true,
  includeActiveRuns: true,
  includeAssignees: true,
});
```

Agent-run actions can assert checkout ownership before mutating in-progress work:

```ts
await ctx.issues.assertCheckoutOwner({
  issueId,
  squadId,
  actorAgentId: runCtx.agentId,
  actorRunId: runCtx.runId,
});
```

Plugins can request assignment wakeups through the host so budget stops, execution locks, blocker checks, and heartbeat policy still apply:

```ts
await ctx.issues.requestWakeup(child.id, squadId, {
  reason: "mission_advance",
  contextSource: "missions.advance",
});

await ctx.issues.requestWakeups([featureIssueId, validationIssueId], squadId, {
  reason: "mission_advance",
  contextSource: "missions.advance",
  idempotencyKeyPrefix: `mission:${missionIssueId}:advance`,
});
```

Use `ctx.issues.summaries.getOrchestration()` when a workflow needs compact reads across a root issue or subtree:

```ts
const summary = await ctx.issues.summaries.getOrchestration({
  issueId: missionIssueId,
  squadId,
  includeSubtree: true,
  billingCode: "mission:alpha",
});
```

Required capabilities:

| API | Capability |
|-----|------------|
| `ctx.issues.relations.get` | `issue.relations.read` |
| `ctx.issues.relations.setBlockedBy` / `addBlockers` / `removeBlockers` | `issue.relations.write` |
| `ctx.issues.getSubtree` | `issue.subtree.read` |
| `ctx.issues.assertCheckoutOwner` | `issues.checkout` |
| `ctx.issues.requestWakeup` / `requestWakeups` | `issues.wakeup` |
| `ctx.issues.summaries.getOrchestration` | `issues.orchestration.read` |

Plugin-originated mutations are logged with `actorType: "plugin"` and details fields `sourcePluginId`, `sourcePluginKey`, `initiatingActorType`, `initiatingActorId`, and `initiatingRunId` when a user or agent run initiated the plugin work.

## UI quick start

```tsx
import { usePluginData, usePluginAction } from "@slaw-ai/plugin-sdk/ui";

export function DashboardWidget() {
  const { data } = usePluginData<{ status: string }>("health");
  const ping = usePluginAction("ping");
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <strong>Health</strong>
      <div>{data?.status ?? "unknown"}</div>
      <button onClick={() => void ping()}>Ping</button>
    </div>
  );
}
```

### Hooks reference

#### `usePluginData<T>(key, params?)`

Fetches data from the worker's registered `getData` handler. Re-fetches when `params` changes. Returns `{ data, loading, error, refresh }`.

```tsx
import { usePluginData } from "@slaw-ai/plugin-sdk/ui";

interface SyncStatus {
  lastSyncAt: string;
  syncedCount: number;
  healthy: boolean;
}

export function SyncStatusWidget({ context }: PluginWidgetProps) {
  const { data, loading, error, refresh } = usePluginData<SyncStatus>("sync-status", {
    squadId: context.squadId,
  });

  if (loading) return <div>Loading…</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <p>Status: {data!.healthy ? "Healthy" : "Unhealthy"}</p>
      <p>Synced {data!.syncedCount} items</p>
      <p>Last sync: {data!.lastSyncAt}</p>
      <button onClick={refresh}>Refresh</button>
    </div>
  );
}
```

#### `usePluginAction(key)`

Returns an async function that calls the worker's `performAction` handler. Throws `PluginBridgeError` on failure.

```tsx
import { useState } from "react";
import { usePluginAction, type PluginBridgeError } from "@slaw-ai/plugin-sdk/ui";

export function ResyncButton({ context }: PluginWidgetProps) {
  const resync = usePluginAction("resync");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      await resync({ squadId: context.squadId });
    } catch (err) {
      setError((err as PluginBridgeError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={handleClick} disabled={busy}>
        {busy ? "Syncing..." : "Resync Now"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
```

#### `useHostContext()`

Reads the active squad, project, entity, and user context. Use this to scope data fetches and actions.

```tsx
import { useHostContext, usePluginData } from "@slaw-ai/plugin-sdk/ui";
import type { PluginDetailTabProps } from "@slaw-ai/plugin-sdk/ui";

export function IssueLinearLink({ context }: PluginDetailTabProps) {
  const { squadId, entityId, entityType } = context;
  const { data } = usePluginData<{ url: string }>("linear-link", {
    squadId,
    issueId: entityId,
  });

  if (!data?.url) return <p>No linked Linear issue.</p>;
  return <a href={data.url} target="_blank" rel="noopener">View in Linear</a>;
}
```

#### `useHostNavigation()`

Routes Slaw-internal plugin links through the host router without a full document reload. Use `linkProps()` for anchors so the browser still gets a real `href` for copy-link, modifier-click, middle-click, and open-in-new-tab behavior.

```tsx
import { useHostNavigation } from "@slaw-ai/plugin-sdk/ui";

export function WikiSidebarLink() {
  const hostNavigation = useHostNavigation();
  return <a {...hostNavigation.linkProps("/wiki")}>Wiki</a>;
}
```

`linkProps("/wiki")` resolves against the active squad prefix, so in squad `PAP` it renders `href="/PAP/wiki"`. Already-prefixed paths such as `/PAP/wiki` are not prefixed again. For button-style commands, call `hostNavigation.navigate("/issues/PAP-123")`.

Avoid raw same-origin `href`s or `window.location.assign()` for Slaw-internal navigation from plugin UI. Those bypass the host router and can reload the whole app. External links should keep normal anchors with `target="_blank"` and `rel="noopener noreferrer"` as appropriate.

#### `usePluginStream<T>(channel, options?)`

Subscribes to a real-time event stream pushed from the plugin worker via SSE. The worker pushes events using `ctx.streams.emit(channel, event)` and the hook receives them as they arrive. Returns `{ events, lastEvent, connecting, connected, error, close }`.

```tsx
import { usePluginStream } from "@slaw-ai/plugin-sdk/ui";

interface ChatToken {
  text: string;
}

export function ChatMessages({ context }: PluginWidgetProps) {
  const { events, connected, close } = usePluginStream<ChatToken>("chat-stream", {
    squadId: context.squadId ?? undefined,
  });

  return (
    <div>
      {events.map((e, i) => <span key={i}>{e.text}</span>)}
      {connected && <span className="pulse" />}
      <button onClick={close}>Stop</button>
    </div>
  );
}
```

The SSE connection targets `GET /api/plugins/:pluginId/bridge/stream/:channel?squadId=...`. The host bridge manages the EventSource lifecycle; `close()` terminates the connection.

### UI authoring note

The host provides selected shared UI components through `@slaw-ai/plugin-sdk/ui`.
Plugins can also use normal React components, their own CSS, or small design
primitives inside the plugin package.

Use the shared components when the plugin needs to look and behave like a native
Slaw surface:

| Component | Use when |
|---|---|
| `MarkdownBlock` | Rendering markdown from plugin or host data |
| `MarkdownEditor` | Editing markdown with the host editor treatment |
| `FileTree` | Showing serializable workspace/wiki/import paths |
| `IssuesList` | Embedding a squad-scoped native issue list |
| `AssigneePicker` | Selecting an agent or operator user with the same picker as the new issue pane |
| `ProjectPicker` | Selecting a project with the same picker as the new issue pane |
| `ManagedRoutinesList` | Showing plugin-managed routines in settings UI |

#### Shared Markdown Components

Plugin UI can render markdown and edit markdown using the same host components
used by Slaw issue comments and documents:

```tsx
import { MarkdownBlock, MarkdownEditor } from "@slaw-ai/plugin-sdk/ui";

export function WikiPageEditor() {
  const [body, setBody] = useState("# Wiki page");

  return (
    <>
      <MarkdownBlock content={body} />
      <MarkdownEditor value={body} onChange={setBody} bordered />
    </>
  );
}
```

`MarkdownBlock` can opt into Obsidian-style wikilinks when a plugin owns the
target URL shape:

```tsx
<MarkdownBlock
  content={"See [[wiki/entities/slaw|Slaw]]."}
  enableWikiLinks
  wikiLinkRoot="/wiki/page"
/>
```

#### Shared FileTree

Plugin UI can render the host file tree without importing host internals:

```tsx
import { FileTree, type FileTreeNode } from "@slaw-ai/plugin-sdk/ui";

const nodes: FileTreeNode[] = [
  { name: "AGENTS.md", path: "AGENTS.md", kind: "file", children: [] },
  {
    name: "wiki",
    path: "wiki",
    kind: "dir",
    children: [
      { name: "index.md", path: "wiki/index.md", kind: "file", children: [] },
    ],
  },
];

export function WikiFiles() {
  return (
    <FileTree
      nodes={nodes}
      expandedPaths={["wiki"]}
      selectedFile="wiki/index.md"
      onToggleDir={(path) => console.log("toggle", path)}
      onSelectFile={(path) => console.log("select", path)}
    />
  );
}
```

#### Shared Assignee and Project Pickers

Use `AssigneePicker` and `ProjectPicker` when a plugin needs to create, filter,
or configure work against Slaw entities. Both are controlled components and
load their options from the host for the provided squad.

```tsx
import { AssigneePicker, ProjectPicker } from "@slaw-ai/plugin-sdk/ui";

export function AssignmentControls({ squadId }: { squadId: string }) {
  const [assignee, setAssignee] = useState("");
  const [projectId, setProjectId] = useState("");

  return (
    <>
      <AssigneePicker
        squadId={squadId}
        value={assignee}
        onChange={(value, selection) => {
          setAssignee(value);
          console.log(selection.assigneeAgentId, selection.assigneeUserId);
        }}
      />
      <ProjectPicker
        squadId={squadId}
        value={projectId}
        onChange={setProjectId}
      />
    </>
  );
}
```

### Slot component props

Each slot type receives a typed props object with `context: PluginHostContext`. Import from `@slaw-ai/plugin-sdk/ui`.

| Slot type | Props interface | `context` extras |
|-----------|----------------|------------------|
| `page` | `PluginPageProps` | — |
| `sidebar` | `PluginSidebarProps` | — |
| `routeSidebar` | `PluginRouteSidebarProps` | — |
| `settingsPage` | `PluginSettingsPageProps` | — |
| `dashboardWidget` | `PluginWidgetProps` | — |
| `globalToolbarButton` | `PluginGlobalToolbarButtonProps` | — |
| `detailTab` | `PluginDetailTabProps` | `entityId: string`, `entityType: string` |
| `toolbarButton` | `PluginToolbarButtonProps` | `entityId: string`, `entityType: string` |
| `commentAnnotation` | `PluginCommentAnnotationProps` | `entityId: string`, `entityType: "comment"`, `parentEntityId: string`, `projectId`, `squadPrefix` |
| `commentContextMenuItem` | `PluginCommentContextMenuItemProps` | `entityId: string`, `entityType: "comment"`, `parentEntityId: string`, `projectId`, `squadPrefix` |
| `projectSidebarItem` | `PluginProjectSidebarItemProps` | `entityId: string`, `entityType: "project"` |

Example detail tab with entity context:

```tsx
import type { PluginDetailTabProps } from "@slaw-ai/plugin-sdk/ui";
import { usePluginData } from "@slaw-ai/plugin-sdk/ui";

export function AgentMetricsTab({ context }: PluginDetailTabProps) {
  const { data, loading } = usePluginData<Record<string, string>>("agent-metrics", {
    agentId: context.entityId,
    squadId: context.squadId,
  });

  if (loading) return <div>Loading…</div>;
  if (!data) return <p>No metrics available.</p>;

  return (
    <dl>
      {Object.entries(data).map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
```

## Launcher surfaces and modals

V1 does not provide a dedicated `modal` slot. Plugins can either:

- declare concrete UI mount points in `ui.slots`
- declare host-rendered entry points in `ui.launchers`

Supported launcher placement zones currently mirror the major host surfaces such as `projectSidebarItem`, `globalToolbarButton`, `toolbarButton`, `detailTab`, `settingsPage`, and `contextMenuItem`. Plugins may still open their own local modal from those entry points when needed.

Declarative launcher example:

```json
{
  "ui": {
    "launchers": [
      {
        "id": "sync-project",
        "displayName": "Sync",
        "placementZone": "toolbarButton",
        "entityTypes": ["project"],
        "action": {
          "type": "openDrawer",
          "target": "sync-project"
        },
        "render": {
          "environment": "hostOverlay",
          "bounds": "wide"
        }
      }
    ]
  }
}
```

The host returns launcher metadata from `GET /api/plugins/ui-contributions` alongside slot declarations.

When a launcher opens a host-owned overlay or page, `useHostContext()`,
`usePluginData()`, and `usePluginAction()` receive the current
`renderEnvironment` through the bridge. Use that to tailor compact modal UI vs.
full-page layouts without adding custom route parsing in the plugin.

## Project sidebar item

Plugins can add a link under each project in the sidebar via the `projectSidebarItem` slot. This is the recommended slot-based launcher pattern for project-scoped workflows because it can deep-link into a richer plugin tab. The component is rendered once per project with that project’s id in `context.entityId`. Declare the slot and capability in your manifest:

```json
{
  "ui": {
    "slots": [
      {
        "type": "projectSidebarItem",
        "id": "files",
        "displayName": "Files",
        "exportName": "FilesLink",
        "entityTypes": ["project"]
      }
    ]
  },
  "capabilities": ["ui.sidebar.register", "ui.detailTab.register"]
}
```

Minimal React component that links to the project’s plugin tab (see project detail tabs in the spec):

```tsx
import {
  useHostNavigation,
  type PluginProjectSidebarItemProps,
} from "@slaw-ai/plugin-sdk/ui";

export function FilesLink({ context }: PluginProjectSidebarItemProps) {
  const hostNavigation = useHostNavigation();
  const projectId = context.entityId;
  const projectRef = projectId; // or resolve from host; entityId is project id
  return (
    <a {...hostNavigation.linkProps(`/projects/${projectRef}?tab=plugin:your-plugin:files`)}>
      Files
    </a>
  );
}
```

Use optional `order` in the slot to sort among other project sidebar items. See §19.5.1 in the plugin spec and project detail plugin tabs (§19.3) for the full flow.

## Toolbar launcher with a local modal

Two toolbar slot types are available depending on where the button should appear:

- **`globalToolbarButton`** — renders in the top bar on every page, scoped to the squad. No entity context. Use for workspace-wide actions.
- **`toolbarButton`** — renders on entity detail pages (project, issue, etc.). Receives `entityId` and `entityType`. Declare `entityTypes` to control which pages the button appears on.

For short-lived actions, mount the appropriate slot type and open a plugin-owned modal inside the component. Use `useHostContext()` to scope the action to the current squad or entity.

Project-scoped example (appears only on project detail pages):

```json
{
  "ui": {
    "slots": [
      {
        "type": "toolbarButton",
        "id": "sync-toolbar-button",
        "displayName": "Sync",
        "exportName": "SyncToolbarButton",
        "entityTypes": ["project"]
      }
    ]
  },
  "capabilities": ["ui.action.register"]
}
```

```tsx
import { useState } from "react";
import {
  useHostContext,
  usePluginAction,
} from "@slaw-ai/plugin-sdk/ui";

export function SyncToolbarButton() {
  const context = useHostContext();
  const syncProject = usePluginAction("sync-project");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function confirm() {
    if (!context.projectId) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await syncProject({ projectId: context.projectId });
      setOpen(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Sync
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-background p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-base font-semibold">Sync this project?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Queue a sync for <code>{context.projectId}</code>.
            </p>
            {errorMessage ? (
              <p className="mt-2 text-sm text-destructive">{errorMessage}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" onClick={() => void confirm()} disabled={submitting}>
                {submitting ? "Running…" : "Run sync"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
```

Prefer deep-linkable tabs and pages for primary workflows. Reserve plugin-owned modals for confirmations, pickers, and compact editors.

## Real-time streaming (`ctx.streams`)

Plugins can push real-time events from the worker to the UI using server-sent events (SSE). This is useful for streaming LLM tokens, live sync progress, or any push-based data.

### Worker side

In `setup()`, use `ctx.streams` to open a channel, emit events, and close when done:

```ts
const plugin = definePlugin({
  async setup(ctx) {
    ctx.actions.register("chat", async (params) => {
      const squadId = params.squadId as string;
      ctx.streams.open("chat-stream", squadId);

      for await (const token of streamFromLLM(params.prompt as string)) {
        ctx.streams.emit("chat-stream", { text: token });
      }

      ctx.streams.close("chat-stream");
      return { ok: true };
    });
  },
});
```

**API:**

| Method | Description |
|--------|-------------|
| `ctx.streams.open(channel, squadId)` | Open a named stream channel and associate it with a squad. Sends a `streams.open` notification to the host. |
| `ctx.streams.emit(channel, event)` | Push an event to the channel. The `squadId` is automatically resolved from the prior `open()` call. |
| `ctx.streams.close(channel)` | Close the channel and clear the squad mapping. Sends a `streams.close` notification. |

Stream notifications are fire-and-forget JSON-RPC messages (no `id` field). They are sent via `notifyHost()` synchronously during handler execution.

### UI side

Use the `usePluginStream` hook (see [Hooks reference](#usepluginstreamtchannel-options) above) to subscribe to events from the UI.

### Host-side architecture

The host maintains an in-memory `PluginStreamBus` that fans out worker notifications to connected SSE clients:

1. Worker emits `streams.emit` notification via stdout
2. Host (`plugin-worker-manager`) receives the notification and publishes to `PluginStreamBus`
3. SSE endpoint (`GET /api/plugins/:pluginId/bridge/stream/:channel?squadId=...`) subscribes to the bus and writes events to the response

The bus is keyed by `pluginId:channel:squadId`, so multiple UI clients can subscribe to the same stream independently.

### Streaming agent responses to the UI

`ctx.streams` and `ctx.agents.sessions` are complementary. The worker sits between them, relaying agent events to the browser in real time:

```
UI ──usePluginAction──▶ Worker ──sessions.sendMessage──▶ Agent
UI ◀──usePluginStream── Worker ◀──onEvent callback────── Agent
```

The agent doesn't know about streams — the worker decides what to relay. Encode the agent ID in the channel name to scope streams per agent.

**Worker:**

```ts
ctx.actions.register("ask-agent", async (params) => {
  const { agentId, squadId, prompt } = params as {
    agentId: string; squadId: string; prompt: string;
  };

  const channel = `agent:${agentId}`;
  ctx.streams.open(channel, squadId);

  const session = await ctx.agents.sessions.create(agentId, squadId);

  await ctx.agents.sessions.sendMessage(session.sessionId, squadId, {
    prompt,
    onEvent: (event) => {
      ctx.streams.emit(channel, {
        type: event.eventType,       // "chunk" | "done" | "error"
        text: event.message ?? "",
      });
    },
  });

  ctx.streams.close(channel);
  return { sessionId: session.sessionId };
});
```

**UI:**

```tsx
import { useState } from "react";
import { usePluginAction, usePluginStream } from "@slaw-ai/plugin-sdk/ui";

interface AgentEvent {
  type: "chunk" | "done" | "error";
  text: string;
}

export function AgentChat({ agentId, squadId }: { agentId: string; squadId: string }) {
  const askAgent = usePluginAction("ask-agent");
  const { events, connected, close } = usePluginStream<AgentEvent>(`agent:${agentId}`, { squadId });
  const [prompt, setPrompt] = useState("");

  async function send() {
    setPrompt("");
    await askAgent({ agentId, squadId, prompt });
  }

  return (
    <div>
      <div>{events.filter(e => e.type === "chunk").map((e, i) => <span key={i}>{e.text}</span>)}</div>
      <input value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <button onClick={send}>Send</button>
      {connected && <button onClick={close}>Stop</button>}
    </div>
  );
}
```

## Agent sessions (two-way chat)

Plugins can hold multi-turn conversational sessions with agents:

```ts
// Create a session
const session = await ctx.agents.sessions.create(agentId, squadId);

// Send a message and stream the response
await ctx.agents.sessions.sendMessage(session.sessionId, squadId, {
  prompt: "Help me triage this issue",
  onEvent: (event) => {
    if (event.eventType === "chunk") console.log(event.message);
    if (event.eventType === "done") console.log("Stream complete");
  },
});

// List active sessions
const sessions = await ctx.agents.sessions.list(agentId, squadId);

// Close when done
await ctx.agents.sessions.close(session.sessionId, squadId);
```

Requires capabilities: `agent.sessions.create`, `agent.sessions.list`, `agent.sessions.send`, `agent.sessions.close`.

Exported types: `AgentSession`, `AgentSessionEvent`, `AgentSessionSendResult`, `PluginAgentSessionsClient`.

## Testing utilities

```ts
import { createTestHarness } from "@slaw-ai/plugin-sdk/testing";
import plugin from "../src/worker.js";
import manifest from "../src/manifest.js";

const harness = createTestHarness({ manifest });
await plugin.definition.setup(harness.ctx);
await harness.emit("issue.created", { issueId: "iss_1" }, { entityId: "iss_1", entityType: "issue" });
```

## Bundler presets

```ts
import { createPluginBundlerPresets } from "@slaw-ai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
// presets.esbuild.worker / presets.esbuild.manifest / presets.esbuild.ui
// presets.rollup.worker / presets.rollup.manifest / presets.rollup.ui
```

## Local dev server (hot-reload events)

```bash
slaw-plugin-dev-server --root . --ui-dir dist/ui --port 4177
```

Or programmatically:

```ts
import { startPluginDevServer } from "@slaw-ai/plugin-sdk/dev-server";
const server = await startPluginDevServer({ rootDir: process.cwd() });
```

Dev server endpoints:
- `GET /__slaw__/health` returns `{ ok, rootDir, uiDir }`
- `GET /__slaw__/events` streams `reload` SSE events on UI build changes
