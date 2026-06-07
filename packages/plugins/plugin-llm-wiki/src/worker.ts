import {
  definePlugin,
  runWorker,
  type PluginApiRequestInput,
  type PluginContext,
  type PluginManagedRoutineDeclaration,
  type PluginManagedRoutineResolution,
} from "@slaw/plugin-sdk";
import {
  SLAW_DISTILL_SKILL_KEY,
  WIKI_MAINTENANCE_ROUTINE_KEYS,
  WIKI_ROOT_FOLDER_KEY,
} from "./manifest.js";
import {
  bootstrapWikiRoot,
  bootstrapSpace,
  assembleSlawSourceBundle,
  archiveSpace,
  captureWikiSource,
  createSpace,
  createSlawDistillationRun,
  createSlawDistillationWorkItem,
  createOperationIssue,
  distillSlawProjectPage,
  enableActiveProjectDistillation,
  fileQueryAnswerAsPage,
  getDistillationOverview,
  getDistillationPageProvenance,
  getDistillationAutoApplyRestriction,
  getEventIngestionSettings,
  listSlawIngestionCandidates,
  getSlawIngestionProfile,
  getOverview,
  listSpaces,
  handleSlawEventIngestion,
  listWikiAgentOptions,
  listWikiProjectOptions,
  listOperations,
  listPages,
  listSources,
  readSquadIdFromParams,
  readTemplate,
  readWikiPage,
  recordSlawDistillationOutcome,
  reconcileWikiAgentResource,
  reconcileWikiProjectResource,
  reconcileWikiRoutineResources,
  reconcileWikiSkillResources,
  registerWikiTools,
  resetWikiSkillResources,
  resetWikiAgentResource,
  resetWikiProjectResource,
  selectWikiAgentResource,
  selectWikiProjectResource,
  startWikiQuerySession,
  spaceFolderStatus,
  updateEventIngestionSettings,
  updateSlawIngestionProfile,
  updateSpace,
  writeTemplate,
  writeWikiPage,
} from "./wiki.js";

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function routineKeyField(value: unknown): (typeof WIKI_MAINTENANCE_ROUTINE_KEYS)[number] {
  const routineKey = stringField(value);
  if (!routineKey) {
    throw new Error(`routineKey is required; valid values: ${WIKI_MAINTENANCE_ROUTINE_KEYS.join(", ")}`);
  }
  if (!WIKI_MAINTENANCE_ROUTINE_KEYS.includes(routineKey as (typeof WIKI_MAINTENANCE_ROUTINE_KEYS)[number])) {
    throw new Error(`Unknown managed routine: ${routineKey}`);
  }
  return routineKey as (typeof WIKI_MAINTENANCE_ROUTINE_KEYS)[number];
}

function routineOverridesFromParams(params: Record<string, unknown>) {
  const overrides: { assigneeAgentId?: string; projectId?: string } = {};
  const assigneeAgentId = stringField(params.assigneeAgentId);
  const projectId = stringField(params.projectId);
  if (assigneeAgentId) overrides.assigneeAgentId = assigneeAgentId;
  if (projectId) overrides.projectId = projectId;
  return overrides;
}

let activeContext: PluginContext | null = null;
const SLAW_EVENT_INGESTION_EVENTS = [
  "issue.created",
  "issue.updated",
  "issue.comment.created",
  "issue.document.created",
  "issue.document.updated",
] as const;

type ManagedRoutineDefaultDrift = {
  changedFields: string[];
  defaultTitle: string;
  defaultDescription: string | null;
};

type ManagedRoutineSettingsResolution = PluginManagedRoutineResolution & {
  defaultDrift: ManagedRoutineDefaultDrift | null;
};

function requireContext(): PluginContext {
  if (!activeContext) throw new Error("LLM Wiki plugin has not been set up");
  return activeContext;
}

function normalizeRoutineTemplateText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : null;
}

function manualDistillScopeLabel(input: { projectId?: string | null; rootIssueId?: string | null }) {
  if (input.rootIssueId) return "selected root issue";
  if (input.projectId) return "selected project";
  return "squad-wide stale cursor scan";
}

function buildManualDistillPrompt(input: { squadId: string; projectId?: string | null; rootIssueId?: string | null }) {
  const scopeLabel = manualDistillScopeLabel(input);
  return [
    "Manual LLM Wiki distillation requested outside recurring cadence.",
    "",
    "Prompt source: LLM Wiki plugin action `distill-slaw-now` (`packages/plugins/plugin-llm-wiki/src/worker.ts`).",
    `Required skill: use the installed \`${SLAW_DISTILL_SKILL_KEY}\` skill before changing wiki files.`,
    "",
    "Scope:",
    `- Squad ID: ${input.squadId}`,
    `- Requested scope: ${scopeLabel}`,
    input.projectId ? `- Source project ID: ${input.projectId}` : null,
    input.rootIssueId ? `- Source root issue ID: ${input.rootIssueId}` : null,
    !input.projectId && !input.rootIssueId
      ? "- Do not hardcode a single project. Find non-plugin Slaw issues/comments/documents that changed in any project after the last processed cursor and are old enough for the stale/debounce threshold."
      : null,
    "",
    "Process:",
    "1. Read the wiki root AGENTS.md, wiki/index.md, and recent wiki/log.md entries.",
    "2. Assemble bounded Slaw source bundles for every eligible project or root issue, excluding LLM Wiki plugin-operation issues.",
    "3. Turn durable signal into project standups, wiki-insightful project pages, decisions, history, index, and log updates per the slaw-distill skill.",
    "4. Surface clipped, low-signal, stale-hash, or source-window warnings instead of hiding them.",
  ].filter((line): line is string => line !== null).join("\n");
}

function withManagedRoutineDefaultDrift(
  routine: PluginManagedRoutineResolution,
  declaration: PluginManagedRoutineDeclaration | undefined,
): ManagedRoutineSettingsResolution {
  if (!routine.routine || !declaration) {
    return { ...routine, defaultDrift: null };
  }

  const changedFields: string[] = [];
  if (normalizeRoutineTemplateText(routine.routine.title) !== normalizeRoutineTemplateText(declaration.title)) {
    changedFields.push("title");
  }
  if (normalizeRoutineTemplateText(routine.routine.description) !== normalizeRoutineTemplateText(declaration.description ?? null)) {
    changedFields.push("description");
  }
  if (routine.routine.priority !== (declaration.priority ?? "medium")) {
    changedFields.push("priority");
  }
  if (routine.routine.concurrencyPolicy !== (declaration.concurrencyPolicy ?? "coalesce_if_active")) {
    changedFields.push("concurrency policy");
  }
  if (routine.routine.catchUpPolicy !== (declaration.catchUpPolicy ?? "skip_missed")) {
    changedFields.push("catch-up policy");
  }

  return {
    ...routine,
    defaultDrift: changedFields.length > 0
      ? {
          changedFields,
          defaultTitle: declaration.title,
          defaultDescription: declaration.description ?? null,
        }
      : null,
  };
}

const plugin = definePlugin({
  async setup(ctx) {
    activeContext = ctx;
    await registerWikiTools(ctx);

    for (const eventName of SLAW_EVENT_INGESTION_EVENTS) {
      ctx.events.on(eventName, async (event) => {
        const result = await handleSlawEventIngestion(ctx, event);
        if (result.status === "recorded") {
          ctx.logger.info("LLM Wiki recorded Slaw event for cursor discovery", {
            eventType: event.eventType,
            squadId: event.squadId,
            sourceKind: result.sourceKind,
            sourceId: result.sourceId,
            cursorId: result.cursorId,
          });
        }
      });
    }

    ctx.data.register("overview", async (params) => {
      const squadId = readSquadIdFromParams(params);
      return getOverview(ctx, squadId);
    });

    ctx.data.register("health", async (params) => {
      const squadId = stringField(params.squadId);
      return squadId
        ? getOverview(ctx, squadId)
        : { status: "ok", checkedAt: new Date().toISOString(), message: "LLM Wiki worker is running" };
    });

    ctx.actions.register("bootstrap-root", async (params) => {
      return bootstrapWikiRoot(ctx, {
        squadId: readSquadIdFromParams(params),
        path: stringField(params.path),
      });
    });

    ctx.data.register("spaces", async (params) => {
      return listSpaces(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
      });
    });

    ctx.data.register("space", async (params) => {
      return spaceFolderStatus(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
      });
    });

    ctx.actions.register("create-space", async (params) => {
      return createSpace(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        slug: stringField(params.slug),
        displayName: stringField(params.displayName),
        folderMode: stringField(params.folderMode) as "managed_subfolder" | "existing_local_folder" | null,
        accessScope: stringField(params.accessScope) as "shared" | "personal" | "team" | null,
        settings: typeof params.settings === "object" && params.settings != null ? params.settings as Record<string, unknown> : null,
      });
    });

    ctx.actions.register("update-space", async (params) => {
      return updateSpace(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        displayName: stringField(params.displayName),
        status: stringField(params.status) as "active" | "archived" | null,
        settings: typeof params.settings === "object" && params.settings != null ? params.settings as Record<string, unknown> : null,
      });
    });

    ctx.actions.register("bootstrap-space", async (params) => {
      return bootstrapSpace(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
      });
    });

    ctx.actions.register("archive-space", async (params) => {
      return archiveSpace(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
      });
    });

    ctx.actions.register("create-operation", async (params) => {
      const operationType = stringField(params.operationType);
      if (
        operationType !== "ingest" &&
        operationType !== "query" &&
        operationType !== "lint" &&
        operationType !== "file-as-page" &&
        operationType !== "index" &&
        operationType !== "distill" &&
        operationType !== "backfill"
      ) {
        throw new Error("operationType must be ingest, query, lint, file-as-page, index, distill, or backfill");
      }
      return createOperationIssue(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        operationType,
        title: stringField(params.title),
        prompt: stringField(params.prompt),
        useCheapModelProfile: params.useCheapModelProfile === true,
      });
    });

    ctx.actions.register("capture-source", async (params) => {
      return captureWikiSource(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        sourceType: stringField(params.sourceType),
        title: stringField(params.title),
        url: stringField(params.url),
        contents: typeof params.contents === "string" ? params.contents : "",
        rawPath: stringField(params.rawPath),
        metadata: typeof params.metadata === "object" && params.metadata != null ? params.metadata as Record<string, unknown> : null,
      });
    });

    ctx.actions.register("write-page", async (params) => {
      return writeWikiPage(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        path: stringField(params.path) ?? "",
        contents: typeof params.contents === "string" ? params.contents : "",
        expectedHash: stringField(params.expectedHash),
        summary: stringField(params.summary),
        sourceRefs: params.sourceRefs,
        writer: "operator_ui",
      });
    });

    ctx.actions.register("write-template", async (params) => {
      return writeTemplate(ctx, {
        squadId: readSquadIdFromParams(params),
        path: stringField(params.path) ?? "",
        contents: typeof params.contents === "string" ? params.contents : "",
      });
    });

    ctx.actions.register("update-event-ingestion-settings", async (params) => {
      const requestedSources = typeof params.sources === "object" && params.sources != null && !Array.isArray(params.sources)
        ? params.sources as Record<string, unknown>
        : null;
      const sources: { issues?: boolean; comments?: boolean; documents?: boolean } = {};
      if (requestedSources && Object.prototype.hasOwnProperty.call(requestedSources, "issues")) {
        sources.issues = requestedSources.issues === true;
      }
      if (requestedSources && Object.prototype.hasOwnProperty.call(requestedSources, "comments")) {
        sources.comments = requestedSources.comments === true;
      }
      if (requestedSources && Object.prototype.hasOwnProperty.call(requestedSources, "documents")) {
        sources.documents = requestedSources.documents === true;
      }
      const settings: {
        enabled?: boolean;
        wikiId?: string;
        maxCharacters?: number;
        sources?: typeof sources;
      } = {
        wikiId: stringField(params.wikiId) ?? undefined,
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : undefined,
      };
      if (typeof params.enabled === "boolean") {
        settings.enabled = params.enabled;
      }
      if (Object.keys(sources).length > 0) {
        settings.sources = sources;
      }
      return updateEventIngestionSettings(ctx, {
        squadId: readSquadIdFromParams(params),
        settings,
      });
    });

    ctx.data.register("slaw-ingestion-profile", async (params) => {
      return getSlawIngestionProfile(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
      });
    });

    ctx.data.register("slaw-ingestion-candidates", async (params) => {
      return listSlawIngestionCandidates(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        query: stringField(params.query),
      });
    });

    ctx.actions.register("update-slaw-ingestion-profile", async (params) => {
      return updateSlawIngestionProfile(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        profile: params.profile,
      });
    });

    ctx.actions.register("queue-slaw-ingestion-backfill", async (params) => {
      const squadId = readSquadIdFromParams(params);
      const sourceScope = typeof params.sourceScope === "object" && params.sourceScope != null && !Array.isArray(params.sourceScope)
        ? params.sourceScope as Record<string, unknown>
        : {};
      const sourceScopeKind = stringField(sourceScope.kind);
      const projectIds = Array.isArray(sourceScope.projectIds) ? sourceScope.projectIds.map(stringField).filter((id): id is string => Boolean(id)) : [];
      const issueIds = Array.isArray(sourceScope.issueIds) ? sourceScope.issueIds.map(stringField).filter((id): id is string => Boolean(id)) : [];
      const scopes = sourceScopeKind === "selected_projects"
        ? projectIds.map((projectId) => ({ projectId, rootIssueId: null as string | null }))
        : sourceScopeKind === "root_issues"
          ? issueIds.map((rootIssueId) => ({ projectId: null as string | null, rootIssueId }))
          : [];
      if (scopes.length === 0) {
        return {
          status: "refused_policy",
          wikiId: stringField(params.wikiId) ?? "default",
          spaceSlug: stringField(params.spaceSlug) ?? "default",
          warnings: ["Backfill requires a selected project or root issue scope in Phase 4."],
        };
      }
      const backfillStartAt = stringField(params.backfillStartAt);
      const backfillEndAt = stringField(params.backfillEndAt);
      const wikiId = stringField(params.wikiId);
      const spaceSlug = stringField(params.spaceSlug);
      const requestedByIssueId = stringField(params.requestedByIssueId);
      const idempotencyKey = stringField(params.idempotencyKey);
      const queued: Array<{ workItemId: string; issueId: string; projectId: string | null; rootIssueId: string | null }> = [];
      for (const scope of scopes) {
        const idempotencyScope = scope.rootIssueId ? `root:${scope.rootIssueId}` : `project:${scope.projectId}`;
        const workItem = await createSlawDistillationWorkItem(ctx, {
          squadId,
          wikiId,
          spaceSlug,
          kind: "backfill",
          projectId: scope.projectId,
          rootIssueId: scope.rootIssueId,
          requestedByIssueId,
          priority: "low",
          idempotencyKey: idempotencyKey && scopes.length === 1
            ? idempotencyKey
            : `${idempotencyKey ?? "profile-backfill"}:${idempotencyScope}:${backfillStartAt ?? "begin"}:${backfillEndAt ?? "now"}`,
          metadata: { backfillStartAt, backfillEndAt, requestedFrom: "queue-slaw-ingestion-backfill" },
        });
        const operation = await createOperationIssue(ctx, {
          squadId,
          wikiId,
          spaceSlug,
          operationType: "backfill",
          title: scope.rootIssueId ? "Backfill Slaw root issue wiki history" : "Backfill Slaw project wiki history",
          useCheapModelProfile: params.useCheapModelProfile === true,
          prompt: [
            "Backfill LLM Wiki distillation was queued from a per-space Slaw ingestion profile.",
            scope.projectId ? `Project ID: ${scope.projectId}` : null,
            scope.rootIssueId ? `Root issue ID: ${scope.rootIssueId}` : null,
            backfillStartAt ? `Start: ${backfillStartAt}` : null,
            backfillEndAt ? `End: ${backfillEndAt}` : null,
            "Process this bounded window through the profile destination space only.",
          ].filter(Boolean).join("\n"),
        });
        queued.push({
          workItemId: workItem.workItemId,
          issueId: operation.issue.id,
          projectId: scope.projectId,
          rootIssueId: scope.rootIssueId,
        });
      }
      const primary = queued[0];
      return {
        status: "queued",
        wikiId: stringField(params.wikiId) ?? "default",
        spaceSlug: stringField(params.spaceSlug) ?? "default",
        workItemId: primary?.workItemId ?? null,
        issueId: primary?.issueId ?? null,
        workItems: queued,
        warnings: [],
      };
    });

    ctx.actions.register("ingest-source", async (params) => {
      const squadId = readSquadIdFromParams(params);
      const wikiId = stringField(params.wikiId);
      const spaceSlug = stringField(params.spaceSlug);
      const sourceType = stringField(params.sourceType) ?? "text";
      const title = stringField(params.title) ?? sourceType.toUpperCase();
      const contents = typeof params.contents === "string" ? params.contents : "";
      const url = stringField(params.url);
      const captured = await captureWikiSource(ctx, {
        squadId,
        wikiId,
        spaceSlug,
        sourceType,
        title,
        url,
        contents,
        rawPath: stringField(params.rawPath),
        metadata: typeof params.metadata === "object" && params.metadata != null ? params.metadata as Record<string, unknown> : null,
      });
      const op = await createOperationIssue(ctx, {
        squadId,
        wikiId,
        spaceSlug,
        operationType: "ingest",
        title: `Ingest ${sourceType}: ${title}`,
        prompt: [
          `Ingest a captured source from raw/${captured.rawPath.replace(/^raw\//, "")}.`,
          url ? `Source URL: ${url}` : null,
          "Follow the installed wiki-ingest skill: read the raw file end to end, summarise into wiki/sources/<slug>.md, update related entity/concept/synthesis pages, refresh wiki/index.md, and append wiki/log.md.",
        ].filter(Boolean).join("\n"),
      });
      return { status: "ok", source: captured, operation: op };
    });

    ctx.actions.register("assemble-slaw-source-bundle", async (params) => {
      return assembleSlawSourceBundle(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt: stringField(params.backfillStartAt),
        backfillEndAt: stringField(params.backfillEndAt),
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
      });
    });

    ctx.actions.register("create-slaw-distillation-run", async (params) => {
      return createSlawDistillationRun(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt: stringField(params.backfillStartAt),
        backfillEndAt: stringField(params.backfillEndAt),
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
        workItemId: stringField(params.workItemId),
        operationIssueId: stringField(params.operationIssueId),
      });
    });

    ctx.actions.register("record-slaw-distillation-outcome", async (params) => {
      const status = stringField(params.status);
      if (status !== "succeeded" && status !== "failed" && status !== "review_required") {
        throw new Error("status must be succeeded, failed, or review_required");
      }
      const runId = stringField(params.runId);
      if (!runId) throw new Error("runId is required");
      return recordSlawDistillationOutcome(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        runId,
        cursorId: stringField(params.cursorId),
        status,
        sourceHash: stringField(params.sourceHash),
        sourceWindowEnd: stringField(params.sourceWindowEnd),
        warning: stringField(params.warning),
        costCents: typeof params.costCents === "number" ? params.costCents : null,
        retryCount: typeof params.retryCount === "number" ? params.retryCount : null,
      });
    });

    ctx.actions.register("distill-slaw-project-page", async (params) => {
      return distillSlawProjectPage(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt: stringField(params.backfillStartAt),
        backfillEndAt: stringField(params.backfillEndAt),
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
        workItemId: stringField(params.workItemId),
        operationIssueId: stringField(params.operationIssueId),
        autoApply: params.autoApply === true ? true : params.autoApply === false ? false : undefined,
        expectedProjectPageHash: stringField(params.expectedProjectPageHash),
        includeSupportingPages: params.includeSupportingPages !== false,
      });
    });

    ctx.actions.register("distill-slaw-now", async (params) => {
      const squadId = readSquadIdFromParams(params);
      const spaceSlug = stringField(params.spaceSlug);
      const projectId = stringField(params.projectId);
      const rootIssueId = stringField(params.rootIssueId);
      const idempotencyScope = rootIssueId ? `root:${rootIssueId}` : projectId ? `project:${projectId}` : "squad";
      const workItem = await createSlawDistillationWorkItem(ctx, {
        squadId,
        wikiId: stringField(params.wikiId),
        spaceSlug,
        kind: "manual",
        projectId,
        rootIssueId,
        requestedByIssueId: stringField(params.requestedByIssueId),
        priority: "medium",
        idempotencyKey: stringField(params.idempotencyKey) ?? `manual:${idempotencyScope}`,
        metadata: { requestedFrom: "distill-slaw-now" },
      });
      const operation = await createOperationIssue(ctx, {
        squadId,
        wikiId: stringField(params.wikiId),
        spaceSlug,
        operationType: "distill",
        title: rootIssueId
          ? "Distill Slaw root issue into wiki"
          : projectId
            ? "Distill Slaw project into wiki"
            : "Distill Slaw changes into wiki",
        useCheapModelProfile: params.useCheapModelProfile === true,
        prompt: buildManualDistillPrompt({ squadId, projectId, rootIssueId }),
      });
      return { status: "queued", workItem, operation };
    });

    ctx.actions.register("enable-slaw-distillation-active-projects", async (params) => {
      return enableActiveProjectDistillation(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.actions.register("backfill-slaw-distillation", async (params) => {
      const squadId = readSquadIdFromParams(params);
      const spaceSlug = stringField(params.spaceSlug);
      const projectId = stringField(params.projectId);
      const rootIssueId = stringField(params.rootIssueId);
      if (!projectId && !rootIssueId) throw new Error("projectId or rootIssueId is required");
      const backfillStartAt = stringField(params.backfillStartAt);
      const backfillEndAt = stringField(params.backfillEndAt);
      const idempotencyScope = rootIssueId ? `root:${rootIssueId}` : `project:${projectId}`;
      const workItem = await createSlawDistillationWorkItem(ctx, {
        squadId,
        wikiId: stringField(params.wikiId),
        spaceSlug,
        kind: "backfill",
        projectId,
        rootIssueId,
        requestedByIssueId: stringField(params.requestedByIssueId),
        priority: "low",
        idempotencyKey: stringField(params.idempotencyKey) ?? `backfill:${idempotencyScope}:${backfillStartAt ?? "begin"}:${backfillEndAt ?? "now"}`,
        metadata: { backfillStartAt, backfillEndAt, requestedFrom: "backfill-slaw-distillation" },
      });
      const operation = await createOperationIssue(ctx, {
        squadId,
        wikiId: stringField(params.wikiId),
        spaceSlug,
        operationType: "backfill",
        title: rootIssueId ? "Backfill Slaw root issue wiki history" : "Backfill Slaw project wiki history",
        useCheapModelProfile: params.useCheapModelProfile === true,
        prompt: [
          "Backfill LLM Wiki distillation requested for a bounded Slaw source window.",
          projectId ? `Project ID: ${projectId}` : null,
          rootIssueId ? `Root issue ID: ${rootIssueId}` : null,
          backfillStartAt ? `Start: ${backfillStartAt}` : null,
          backfillEndAt ? `End: ${backfillEndAt}` : null,
          "Do not process whole-squad history; stay within the selected project/root issue and date window.",
        ].filter(Boolean).join("\n"),
      });
      const result = await distillSlawProjectPage(ctx, {
        squadId,
        wikiId: stringField(params.wikiId),
        spaceSlug,
        projectId,
        rootIssueId,
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt,
        backfillEndAt,
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
        autoApply: params.autoApply === true ? true : params.autoApply === false ? false : undefined,
        expectedProjectPageHash: stringField(params.expectedProjectPageHash),
        includeSupportingPages: params.includeSupportingPages !== false,
        workItemId: workItem.workItemId,
        operationIssueId: operation.issue.id,
      });
      return { ...result, workItem, operation };
    });

    ctx.actions.register("create-slaw-distillation-work-item", async (params) => {
      const kind = stringField(params.kind);
      if (
        kind !== "manual" &&
        kind !== "retry" &&
        kind !== "backfill" &&
        kind !== "priority_override" &&
        kind !== "review_patch"
      ) {
        throw new Error("kind must be manual, retry, backfill, priority_override, or review_patch");
      }
      const priority = stringField(params.priority);
      if (priority && priority !== "critical" && priority !== "high" && priority !== "medium" && priority !== "low") {
        throw new Error("priority must be critical, high, medium, or low");
      }
      return createSlawDistillationWorkItem(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        kind,
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        requestedByIssueId: stringField(params.requestedByIssueId),
        priority: priority as "critical" | "high" | "medium" | "low" | null,
        idempotencyKey: stringField(params.idempotencyKey),
        metadata: typeof params.metadata === "object" && params.metadata != null ? params.metadata as Record<string, unknown> : null,
      });
    });

    ctx.actions.register("file-as-page", async (params) => {
      return fileQueryAnswerAsPage(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        querySessionId: stringField(params.querySessionId),
        question: stringField(params.question),
        answer: stringField(params.answer),
        path: stringField(params.path) ?? "",
        title: stringField(params.title),
        contents: stringField(params.contents),
        expectedHash: stringField(params.expectedHash),
      });
    });

    ctx.actions.register("start-query", async (params) => {
      return startWikiQuerySession(ctx, {
        squadId: readSquadIdFromParams(params),
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        question: stringField(params.question) ?? "",
        title: stringField(params.title),
      });
    });

    ctx.actions.register("reset-managed-agent", async (params) => {
      return resetWikiAgentResource(ctx, readSquadIdFromParams(params));
    });

    ctx.actions.register("reset-managed-project", async (params) => {
      return resetWikiProjectResource(ctx, readSquadIdFromParams(params));
    });

    ctx.actions.register("reconcile-managed-agent", async (params) => {
      return reconcileWikiAgentResource(ctx, readSquadIdFromParams(params));
    });

    ctx.actions.register("reconcile-managed-project", async (params) => {
      return reconcileWikiProjectResource(ctx, readSquadIdFromParams(params));
    });

    ctx.actions.register("reconcile-managed-skills", async (params) => {
      return { managedSkills: await reconcileWikiSkillResources(ctx, readSquadIdFromParams(params)) };
    });

    ctx.actions.register("reset-managed-skills", async (params) => {
      return { managedSkills: await resetWikiSkillResources(ctx, readSquadIdFromParams(params)) };
    });

    ctx.actions.register("select-managed-agent", async (params) => {
      const agentId = stringField(params.agentId);
      if (!agentId) throw new Error("agentId is required");
      return selectWikiAgentResource(ctx, {
        squadId: readSquadIdFromParams(params),
        agentId,
      });
    });

    ctx.actions.register("select-managed-project", async (params) => {
      const projectId = stringField(params.projectId);
      if (!projectId) throw new Error("projectId is required");
      return selectWikiProjectResource(ctx, {
        squadId: readSquadIdFromParams(params),
        projectId,
      });
    });

    ctx.actions.register("reset-managed-routine", async (params) => {
      return ctx.routines.managed.reset(
        routineKeyField(params.routineKey),
        readSquadIdFromParams(params),
        routineOverridesFromParams(params),
      );
    });

    ctx.actions.register("reconcile-managed-routine", async (params) => {
      return ctx.routines.managed.reconcile(
        routineKeyField(params.routineKey),
        readSquadIdFromParams(params),
        routineOverridesFromParams(params),
      );
    });

    ctx.actions.register("reconcile-managed-routines", async (params) => {
      return reconcileWikiRoutineResources(ctx, readSquadIdFromParams(params));
    });

    ctx.actions.register("update-managed-routine-status", async (params) => {
      const status = stringField(params.status);
      if (!status) throw new Error("status is required");
      return ctx.routines.managed.update(routineKeyField(params.routineKey), readSquadIdFromParams(params), {
        status,
      });
    });

    ctx.actions.register("run-managed-routine", async (params) => {
      return ctx.routines.managed.run(
        routineKeyField(params.routineKey),
        readSquadIdFromParams(params),
        routineOverridesFromParams(params),
      );
    });

    ctx.data.register("pages", async (params) => {
      const squadId = readSquadIdFromParams(params);
      return listPages(ctx, {
        squadId,
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        pageType: stringField(params.pageType),
        includeRaw: params.includeRaw === true || params.includeRaw === "true",
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.data.register("sources", async (params) => {
      const squadId = readSquadIdFromParams(params);
      return listSources(ctx, { squadId, wikiId: stringField(params.wikiId), spaceSlug: stringField(params.spaceSlug), limit: typeof params.limit === "number" ? params.limit : null });
    });

    ctx.data.register("page-content", async (params) => {
      const squadId = readSquadIdFromParams(params);
      const path = stringField(params.path);
      if (!path) throw new Error("path is required");
      return readWikiPage(ctx, { squadId, wikiId: stringField(params.wikiId), spaceSlug: stringField(params.spaceSlug), path });
    });

    ctx.data.register("template", async (params) => {
      const squadId = readSquadIdFromParams(params);
      const path = stringField(params.path) ?? "AGENTS.md";
      return readTemplate(ctx, { squadId, path });
    });

    ctx.data.register("operations", async (params) => {
      const squadId = readSquadIdFromParams(params);
      return listOperations(ctx, {
        squadId,
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        operationType: stringField(params.operationType),
        status: stringField(params.status),
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.data.register("distillation-overview", async (params) => {
      const squadId = readSquadIdFromParams(params);
      return getDistillationOverview(ctx, {
        squadId,
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.data.register("distillation-page-provenance", async (params) => {
      const squadId = readSquadIdFromParams(params);
      const pagePath = stringField(params.pagePath);
      if (!pagePath) {
        return { binding: null, runs: [], snapshot: null, cursor: null };
      }
      return getDistillationPageProvenance(ctx, {
        squadId,
        wikiId: stringField(params.wikiId),
        spaceSlug: stringField(params.spaceSlug),
        pagePath,
      });
    });

    ctx.data.register("settings", async (params) => {
      const squadId = readSquadIdFromParams(params);
      const folder = await ctx.localFolders.status(squadId, WIKI_ROOT_FOLDER_KEY);
      const overview = await getOverview(ctx, squadId);
      const managedRoutines = await Promise.all(
        WIKI_MAINTENANCE_ROUTINE_KEYS.map((routineKey) => ctx.routines.managed.get(routineKey, squadId)),
      );
      const managedRoutinesWithDefaultDrift = managedRoutines.map((routine) =>
        withManagedRoutineDefaultDrift(
          routine,
          ctx.manifest.routines?.find((declaration) => declaration.routineKey === routine.resourceKey),
        ),
      );
      return {
        folder,
        spaces: await listSpaces(ctx, { squadId }),
        managedAgent: overview.managedAgent,
        managedProject: overview.managedProject,
        managedSkills: overview.managedSkills,
        managedRoutine: managedRoutinesWithDefaultDrift[0],
        managedRoutines: managedRoutinesWithDefaultDrift,
        distillationPolicy: getDistillationAutoApplyRestriction(),
        eventIngestion: await getEventIngestionSettings(ctx, squadId),
        agentOptions: await listWikiAgentOptions(ctx, squadId),
        projectOptions: await listWikiProjectOptions(ctx, squadId),
        capabilities: ctx.manifest.capabilities,
      };
    });
  },

  async onApiRequest(input: PluginApiRequestInput) {
    const ctx = requireContext();
    if (input.routeKey === "overview") {
      return { body: await getOverview(ctx, input.squadId) };
    }

    if (input.routeKey === "bootstrap") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await bootstrapWikiRoot(ctx, {
          squadId: input.squadId,
          path: stringField(body?.path),
        }),
      };
    }

    if (input.routeKey === "spaces") {
      return {
        body: await listSpaces(ctx, {
          squadId: input.squadId,
          wikiId: stringField(input.query.wikiId),
        }),
      };
    }

    if (input.routeKey === "create-space") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await createSpace(ctx, {
          squadId: input.squadId,
          wikiId: stringField(body?.wikiId),
          slug: stringField(body?.slug),
          displayName: stringField(body?.displayName),
          folderMode: stringField(body?.folderMode) as "managed_subfolder" | "existing_local_folder" | null,
          accessScope: stringField(body?.accessScope) as "shared" | "personal" | "team" | null,
          settings: typeof body?.settings === "object" && body.settings != null ? body.settings as Record<string, unknown> : null,
        }),
      };
    }

    if (input.routeKey === "update-space") {
      const body = input.body as Record<string, unknown> | null;
      return {
        body: await updateSpace(ctx, {
          squadId: input.squadId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: input.params.spaceSlug,
          displayName: stringField(body?.displayName),
          status: stringField(body?.status) as "active" | "archived" | null,
          settings: typeof body?.settings === "object" && body.settings != null ? body.settings as Record<string, unknown> : null,
        }),
      };
    }

    if (input.routeKey === "bootstrap-space") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await bootstrapSpace(ctx, {
          squadId: input.squadId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: input.params.spaceSlug,
        }),
      };
    }

    if (input.routeKey === "archive-space") {
      const body = input.body as Record<string, unknown> | null;
      return {
        body: await archiveSpace(ctx, {
          squadId: input.squadId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: input.params.spaceSlug,
        }),
      };
    }

    if (input.routeKey === "capture-source") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await captureWikiSource(ctx, {
          squadId: input.squadId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: stringField(body?.spaceSlug),
          sourceType: stringField(body?.sourceType),
          title: stringField(body?.title),
          url: stringField(body?.url),
          contents: typeof body?.contents === "string" ? body.contents : "",
          rawPath: stringField(body?.rawPath),
          metadata: typeof body?.metadata === "object" && body.metadata != null ? body.metadata as Record<string, unknown> : null,
        }),
      };
    }

    if (input.routeKey === "operations") {
      return {
        body: await listOperations(ctx, {
          squadId: input.squadId,
          wikiId: stringField(input.query.wikiId),
          spaceSlug: stringField(input.query.spaceSlug),
          operationType: stringField(input.query.operationType),
          status: stringField(input.query.status),
          limit: typeof input.query.limit === "string" ? Number(input.query.limit) : null,
        }),
      };
    }

    if (input.routeKey === "start-query") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await startWikiQuerySession(ctx, {
          squadId: input.squadId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: stringField(body?.spaceSlug),
          question: stringField(body?.question) ?? "",
          title: stringField(body?.title),
        }),
      };
    }

    if (input.routeKey === "file-as-page") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await fileQueryAnswerAsPage(ctx, {
          squadId: input.squadId,
          wikiId: stringField(body?.wikiId),
          spaceSlug: stringField(body?.spaceSlug),
          querySessionId: stringField(body?.querySessionId),
          question: stringField(body?.question),
          answer: stringField(body?.answer),
          path: stringField(body?.path) ?? "",
          title: stringField(body?.title),
          contents: stringField(body?.contents),
          expectedHash: stringField(body?.expectedHash),
        }),
      };
    }

    return { status: 404, body: { error: `Unknown LLM Wiki route: ${input.routeKey}` } };
  },

  async onHealth() {
    return {
      status: "ok",
      message: "LLM Wiki plugin worker is running",
      details: {
        surfaces: ["page", "sidebar", "settings", "tools", "database", "local-folder"],
      },
    };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
