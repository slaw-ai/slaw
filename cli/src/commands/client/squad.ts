import { Command } from "commander";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import type {
  Squad,
  FeedbackTrace,
  SquadPortabilityFileEntry,
  SquadPortabilityExportResult,
  SquadPortabilityInclude,
  SquadPortabilityPreviewResult,
  SquadPortabilityImportResult,
} from "@slaw/shared";
import { getTelemetryClient, trackSquadImported } from "../../telemetry.js";
import { ApiRequestError } from "../../client/http.js";
import { openUrl } from "../../client/board-auth.js";
import { binaryContentTypeByExtension, readZipArchive } from "./zip.js";
import {
  addCommonClientOptions,
  apiPath,
  formatInlineRecord,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";
import {
  buildFeedbackTraceQuery,
  normalizeFeedbackTraceExportFormat,
  serializeFeedbackTraces,
} from "./feedback.js";

interface SquadCommandOptions extends BaseClientOptions {}
interface SquadJsonOptions extends BaseClientOptions {
  squadId?: string;
  payloadJson?: string;
}
type SquadDeleteSelectorMode = "auto" | "id" | "prefix";
type SquadImportTargetMode = "new" | "existing";
type SquadCollisionMode = "rename" | "skip" | "replace";

interface SquadDeleteOptions extends BaseClientOptions {
  by?: SquadDeleteSelectorMode;
  yes?: boolean;
  confirm?: string;
}

interface SquadExportOptions extends BaseClientOptions {
  out?: string;
  include?: string;
  skills?: string;
  projects?: string;
  issues?: string;
  projectIssues?: string;
  expandReferencedSkills?: boolean;
}

interface SquadFeedbackOptions extends BaseClientOptions {
  targetType?: string;
  vote?: string;
  status?: string;
  projectId?: string;
  issueId?: string;
  from?: string;
  to?: string;
  sharedOnly?: boolean;
  includePayload?: boolean;
  out?: string;
  format?: string;
}

interface SquadImportOptions extends BaseClientOptions {
  include?: string;
  target?: SquadImportTargetMode;
  squadId?: string;
  newSquadName?: string;
  agents?: string;
  collision?: SquadCollisionMode;
  ref?: string;
  slawUrl?: string;
  yes?: boolean;
  dryRun?: boolean;
}

const DEFAULT_EXPORT_INCLUDE: SquadPortabilityInclude = {
  squad: true,
  agents: true,
  projects: false,
  issues: false,
  skills: false,
};

const DEFAULT_IMPORT_INCLUDE: SquadPortabilityInclude = {
  squad: true,
  agents: true,
  projects: true,
  issues: true,
  skills: true,
};

const IMPORT_INCLUDE_OPTIONS: Array<{
  value: keyof SquadPortabilityInclude;
  label: string;
  hint: string;
}> = [
  { value: "squad", label: "Squad", hint: "name, branding, and squad settings" },
  { value: "projects", label: "Projects", hint: "projects and workspace metadata" },
  { value: "issues", label: "Tasks", hint: "tasks and recurring routines" },
  { value: "agents", label: "Agents", hint: "agent records and org structure" },
  { value: "skills", label: "Skills", hint: "squad skill packages and references" },
];

const IMPORT_PREVIEW_SAMPLE_LIMIT = 6;

type ImportSelectableGroup = "projects" | "issues" | "agents" | "skills";

type ImportSelectionCatalog = {
  squad: {
    includedByDefault: boolean;
    files: string[];
  };
  projects: Array<{ key: string; label: string; hint?: string; files: string[] }>;
  issues: Array<{ key: string; label: string; hint?: string; files: string[] }>;
  agents: Array<{ key: string; label: string; hint?: string; files: string[] }>;
  skills: Array<{ key: string; label: string; hint?: string; files: string[] }>;
  extensionPath: string | null;
};

type ImportSelectionState = {
  squad: boolean;
  projects: Set<string>;
  issues: Set<string>;
  agents: Set<string>;
  skills: Set<string>;
};

function readPortableFileEntry(filePath: string, contents: Buffer): SquadPortabilityFileEntry {
  const contentType = binaryContentTypeByExtension[path.extname(filePath).toLowerCase()];
  if (!contentType) return contents.toString("utf8");
  return {
    encoding: "base64",
    data: contents.toString("base64"),
    contentType,
  };
}

function portableFileEntryToWriteValue(entry: SquadPortabilityFileEntry): string | Uint8Array {
  if (typeof entry === "string") return entry;
  return Buffer.from(entry.data, "base64");
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeSelector(input: string): string {
  return input.trim();
}

function parseInclude(
  input: string | undefined,
  fallback: SquadPortabilityInclude = DEFAULT_EXPORT_INCLUDE,
): SquadPortabilityInclude {
  if (!input || !input.trim()) return { ...fallback };
  const values = input.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  const include = {
    squad: values.includes("squad"),
    agents: values.includes("agents"),
    projects: values.includes("projects"),
    issues: values.includes("issues") || values.includes("tasks"),
    skills: values.includes("skills"),
  };
  if (!include.squad && !include.agents && !include.projects && !include.issues && !include.skills) {
    throw new Error("Invalid --include value. Use one or more of: squad,agents,projects,issues,tasks,skills");
  }
  return include;
}

function parseAgents(input: string | undefined): "all" | string[] {
  if (!input || !input.trim()) return "all";
  const normalized = input.trim().toLowerCase();
  if (normalized === "all") return "all";
  const values = input.split(",").map((part) => part.trim()).filter(Boolean);
  if (values.length === 0) return "all";
  return Array.from(new Set(values));
}

function parseCsvValues(input: string | undefined): string[] {
  if (!input || !input.trim()) return [];
  return Array.from(new Set(input.split(",").map((part) => part.trim()).filter(Boolean)));
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function resolveImportInclude(input: string | undefined): SquadPortabilityInclude {
  return parseInclude(input, DEFAULT_IMPORT_INCLUDE);
}

function normalizePortablePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function shouldIncludePortableFile(filePath: string): boolean {
  const baseName = path.basename(filePath);
  const isMarkdown = baseName.endsWith(".md");
  const isSlawYaml = baseName === ".slaw.yaml" || baseName === ".slaw.yml";
  const contentType = binaryContentTypeByExtension[path.extname(baseName).toLowerCase()];
  return isMarkdown || isSlawYaml || Boolean(contentType);
}

function findPortableExtensionPath(files: Record<string, SquadPortabilityFileEntry>): string | null {
  if (files[".slaw.yaml"] !== undefined) return ".slaw.yaml";
  if (files[".slaw.yml"] !== undefined) return ".slaw.yml";
  return Object.keys(files).find((entry) => entry.endsWith("/.slaw.yaml") || entry.endsWith("/.slaw.yml")) ?? null;
}

function collectFilesUnderDirectory(
  files: Record<string, SquadPortabilityFileEntry>,
  directory: string,
  opts?: { excludePrefixes?: string[] },
): string[] {
  const normalizedDirectory = normalizePortablePath(directory).replace(/\/+$/, "");
  if (!normalizedDirectory) return [];
  const prefix = `${normalizedDirectory}/`;
  const excluded = (opts?.excludePrefixes ?? []).map((entry) => normalizePortablePath(entry).replace(/\/+$/, "")).filter(Boolean);
  return Object.keys(files)
    .map(normalizePortablePath)
    .filter((filePath) => filePath.startsWith(prefix))
    .filter((filePath) => !excluded.some((excludePrefix) => filePath.startsWith(`${excludePrefix}/`)))
    .sort((left, right) => left.localeCompare(right));
}

function collectEntityFiles(
  files: Record<string, SquadPortabilityFileEntry>,
  entryPath: string,
  opts?: { excludePrefixes?: string[] },
): string[] {
  const normalizedPath = normalizePortablePath(entryPath);
  const directory = normalizedPath.includes("/") ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/")) : "";
  const selected = new Set<string>([normalizedPath]);
  if (directory) {
    for (const filePath of collectFilesUnderDirectory(files, directory, opts)) {
      selected.add(filePath);
    }
  }
  return Array.from(selected).sort((left, right) => left.localeCompare(right));
}

export function buildImportSelectionCatalog(preview: SquadPortabilityPreviewResult): ImportSelectionCatalog {
  const selectedAgentSlugs = new Set(preview.selectedAgentSlugs);
  const squadFiles = new Set<string>();
  const squadPath = preview.manifest.squad?.path ? normalizePortablePath(preview.manifest.squad.path) : null;
  if (squadPath) {
    squadFiles.add(squadPath);
  }
  const readmePath = Object.keys(preview.files).find((entry) => normalizePortablePath(entry) === "README.md");
  if (readmePath) {
    squadFiles.add(normalizePortablePath(readmePath));
  }
  const logoPath = preview.manifest.squad?.logoPath ? normalizePortablePath(preview.manifest.squad.logoPath) : null;
  if (logoPath && preview.files[logoPath] !== undefined) {
    squadFiles.add(logoPath);
  }

  return {
    squad: {
      includedByDefault: preview.include.squad && preview.manifest.squad !== null,
      files: Array.from(squadFiles).sort((left, right) => left.localeCompare(right)),
    },
    projects: preview.manifest.projects.map((project) => {
      const projectPath = normalizePortablePath(project.path);
      const projectDir = projectPath.includes("/") ? projectPath.slice(0, projectPath.lastIndexOf("/")) : "";
      return {
        key: project.slug,
        label: project.name,
        hint: project.slug,
        files: collectEntityFiles(preview.files, projectPath, {
          excludePrefixes: projectDir ? [`${projectDir}/issues`] : [],
        }),
      };
    }),
    issues: preview.manifest.issues.map((issue) => ({
      key: issue.slug,
      label: issue.title,
      hint: issue.identifier ?? issue.slug,
      files: collectEntityFiles(preview.files, normalizePortablePath(issue.path)),
    })),
    agents: preview.manifest.agents
      .filter((agent) => selectedAgentSlugs.size === 0 || selectedAgentSlugs.has(agent.slug))
      .map((agent) => ({
        key: agent.slug,
        label: agent.name,
        hint: agent.slug,
        files: collectEntityFiles(preview.files, normalizePortablePath(agent.path)),
      })),
    skills: preview.manifest.skills.map((skill) => ({
      key: skill.slug,
      label: skill.name,
      hint: skill.slug,
      files: collectEntityFiles(preview.files, normalizePortablePath(skill.path)),
    })),
    extensionPath: findPortableExtensionPath(preview.files),
  };
}

function toKeySet(items: Array<{ key: string }>): Set<string> {
  return new Set(items.map((item) => item.key));
}

export function buildDefaultImportSelectionState(catalog: ImportSelectionCatalog): ImportSelectionState {
  return {
    squad: catalog.squad.includedByDefault,
    projects: toKeySet(catalog.projects),
    issues: toKeySet(catalog.issues),
    agents: toKeySet(catalog.agents),
    skills: toKeySet(catalog.skills),
  };
}

function countSelected(state: ImportSelectionState, group: ImportSelectableGroup): number {
  return state[group].size;
}

function countTotal(catalog: ImportSelectionCatalog, group: ImportSelectableGroup): number {
  return catalog[group].length;
}

function summarizeGroupSelection(catalog: ImportSelectionCatalog, state: ImportSelectionState, group: ImportSelectableGroup): string {
  return `${countSelected(state, group)}/${countTotal(catalog, group)} selected`;
}

function getGroupLabel(group: ImportSelectableGroup): string {
  switch (group) {
    case "projects":
      return "Projects";
    case "issues":
      return "Tasks";
    case "agents":
      return "Agents";
    case "skills":
      return "Skills";
  }
}

export function buildSelectedFilesFromImportSelection(
  catalog: ImportSelectionCatalog,
  state: ImportSelectionState,
): string[] {
  const selected = new Set<string>();

  if (state.squad) {
    for (const filePath of catalog.squad.files) {
      selected.add(normalizePortablePath(filePath));
    }
  }

  for (const group of ["projects", "issues", "agents", "skills"] as const) {
    const selectedKeys = state[group];
    for (const item of catalog[group]) {
      if (!selectedKeys.has(item.key)) continue;
      for (const filePath of item.files) {
        selected.add(normalizePortablePath(filePath));
      }
    }
  }

  if (selected.size > 0 && catalog.extensionPath) {
    selected.add(normalizePortablePath(catalog.extensionPath));
  }

  return Array.from(selected).sort((left, right) => left.localeCompare(right));
}

export function buildDefaultImportAdapterOverrides(
  preview: Pick<SquadPortabilityPreviewResult, "manifest" | "selectedAgentSlugs">,
): Record<string, { adapterType: string }> | undefined {
  const selectedAgentSlugs = new Set(preview.selectedAgentSlugs);
  const overrides = Object.fromEntries(
    preview.manifest.agents
      .filter((agent) => selectedAgentSlugs.size === 0 || selectedAgentSlugs.has(agent.slug))
      .filter((agent) => agent.adapterType === "process")
      .map((agent) => [
        agent.slug,
        {
          // TODO: replace this temporary claude_local fallback with adapter selection in the import TUI.
          adapterType: "claude_local",
        },
      ]),
  );
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function buildDefaultImportAdapterMessages(
  overrides: Record<string, { adapterType: string }> | undefined,
): string[] {
  if (!overrides) return [];
  const adapterTypes = Array.from(new Set(Object.values(overrides).map((override) => override.adapterType)))
    .map((adapterType) => adapterType.replace(/_/g, "-"));
  const agentCount = Object.keys(overrides).length;
  return [
    `Using ${adapterTypes.join(", ")} adapter${adapterTypes.length === 1 ? "" : "s"} for ${agentCount} imported ${pluralize(agentCount, "agent")} without an explicit adapter.`,
  ];
}

async function promptForImportSelection(preview: SquadPortabilityPreviewResult): Promise<string[]> {
  const catalog = buildImportSelectionCatalog(preview);
  const state = buildDefaultImportSelectionState(catalog);

  while (true) {
    const choice = await p.select<ImportSelectableGroup | "squad" | "confirm">({
      message: "Select what Slaw should import",
      options: [
        {
          value: "squad",
          label: state.squad ? "Squad: included" : "Squad: skipped",
          hint: catalog.squad.files.length > 0 ? "toggle squad metadata" : "no squad metadata in package",
        },
        {
          value: "projects",
          label: "Select Projects",
          hint: summarizeGroupSelection(catalog, state, "projects"),
        },
        {
          value: "issues",
          label: "Select Tasks",
          hint: summarizeGroupSelection(catalog, state, "issues"),
        },
        {
          value: "agents",
          label: "Select Agents",
          hint: summarizeGroupSelection(catalog, state, "agents"),
        },
        {
          value: "skills",
          label: "Select Skills",
          hint: summarizeGroupSelection(catalog, state, "skills"),
        },
        {
          value: "confirm",
          label: "Confirm",
          hint: `${buildSelectedFilesFromImportSelection(catalog, state).length} files selected`,
        },
      ],
      initialValue: "confirm",
    });

    if (p.isCancel(choice)) {
      p.cancel("Import cancelled.");
      process.exit(0);
    }

    if (choice === "confirm") {
      const selectedFiles = buildSelectedFilesFromImportSelection(catalog, state);
      if (selectedFiles.length === 0) {
        p.note("Select at least one import target before confirming.", "Nothing selected");
        continue;
      }
      return selectedFiles;
    }

    if (choice === "squad") {
      if (catalog.squad.files.length === 0) {
        p.note("This package does not include squad metadata to toggle.", "No squad metadata");
        continue;
      }
      state.squad = !state.squad;
      continue;
    }

    const group = choice;
    const groupItems = catalog[group];
    if (groupItems.length === 0) {
      p.note(`This package does not include any ${getGroupLabel(group).toLowerCase()}.`, `No ${getGroupLabel(group)}`);
      continue;
    }

    const selection = await p.multiselect<string>({
      message: `${getGroupLabel(group)} to import. Space toggles, enter returns to the main menu.`,
      options: groupItems.map((item) => ({
        value: item.key,
        label: item.label,
        hint: item.hint,
      })),
      initialValues: Array.from(state[group]),
    });

    if (p.isCancel(selection)) {
      p.cancel("Import cancelled.");
      process.exit(0);
    }

    state[group] = new Set(selection);
  }
}

function summarizeInclude(include: SquadPortabilityInclude): string {
  const labels = IMPORT_INCLUDE_OPTIONS
    .filter((option) => include[option.value])
    .map((option) => option.label.toLowerCase());
  return labels.length > 0 ? labels.join(", ") : "nothing selected";
}

function formatSourceLabel(source: { type: "inline"; rootPath?: string | null } | { type: "github"; url: string }): string {
  if (source.type === "github") {
    return `GitHub: ${source.url}`;
  }
  return `Local package: ${source.rootPath?.trim() || "(current folder)"}`;
}

function formatTargetLabel(
  target: { mode: "existing_squad"; squadId?: string | null } | { mode: "new_squad"; newSquadName?: string | null },
  preview?: SquadPortabilityPreviewResult,
): string {
  if (target.mode === "existing_squad") {
    const targetName = preview?.targetSquadName?.trim();
    const targetId = preview?.targetSquadId?.trim() || target.squadId?.trim() || "unknown-squad";
    return targetName ? `${targetName} (${targetId})` : targetId;
  }
  return target.newSquadName?.trim() || preview?.manifest.squad?.name || "new squad";
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function summarizePlanCounts(
  plans: Array<{ action: "create" | "update" | "skip" }>,
  noun: string,
): string {
  if (plans.length === 0) return `0 ${pluralize(0, noun)} selected`;
  const createCount = plans.filter((plan) => plan.action === "create").length;
  const updateCount = plans.filter((plan) => plan.action === "update").length;
  const skipCount = plans.filter((plan) => plan.action === "skip").length;
  const parts: string[] = [];
  if (createCount > 0) parts.push(`${createCount} create`);
  if (updateCount > 0) parts.push(`${updateCount} update`);
  if (skipCount > 0) parts.push(`${skipCount} skip`);
  return `${plans.length} ${pluralize(plans.length, noun)} total (${parts.join(", ")})`;
}

function summarizeImportAgentResults(agents: SquadPortabilityImportResult["agents"]): string {
  if (agents.length === 0) return "0 agents changed";
  const created = agents.filter((agent) => agent.action === "created").length;
  const updated = agents.filter((agent) => agent.action === "updated").length;
  const skipped = agents.filter((agent) => agent.action === "skipped").length;
  const parts: string[] = [];
  if (created > 0) parts.push(`${created} created`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return `${agents.length} ${pluralize(agents.length, "agent")} total (${parts.join(", ")})`;
}

function summarizeImportProjectResults(projects: SquadPortabilityImportResult["projects"]): string {
  if (projects.length === 0) return "0 projects changed";
  const created = projects.filter((project) => project.action === "created").length;
  const updated = projects.filter((project) => project.action === "updated").length;
  const skipped = projects.filter((project) => project.action === "skipped").length;
  const parts: string[] = [];
  if (created > 0) parts.push(`${created} created`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return `${projects.length} ${pluralize(projects.length, "project")} total (${parts.join(", ")})`;
}

function actionChip(action: string): string {
  switch (action) {
    case "create":
    case "created":
      return pc.green(action);
    case "update":
    case "updated":
      return pc.yellow(action);
    case "skip":
    case "skipped":
    case "none":
    case "unchanged":
      return pc.dim(action);
    default:
      return action;
  }
}

function appendPreviewExamples(
  lines: string[],
  title: string,
  entries: Array<{ action: string; label: string; reason?: string | null }>,
): void {
  if (entries.length === 0) return;
  lines.push("");
  lines.push(pc.bold(title));
  const shown = entries.slice(0, IMPORT_PREVIEW_SAMPLE_LIMIT);
  for (const entry of shown) {
    const reason = entry.reason?.trim() ? pc.dim(` (${entry.reason.trim()})`) : "";
    lines.push(`- ${actionChip(entry.action)} ${entry.label}${reason}`);
  }
  if (entries.length > shown.length) {
    lines.push(pc.dim(`- +${entries.length - shown.length} more`));
  }
}

function appendMessageBlock(lines: string[], title: string, messages: string[]): void {
  if (messages.length === 0) return;
  lines.push("");
  lines.push(pc.bold(title));
  for (const message of messages) {
    lines.push(`- ${message}`);
  }
}

export function renderSquadImportPreview(
  preview: SquadPortabilityPreviewResult,
  meta: {
    sourceLabel: string;
    targetLabel: string;
    infoMessages?: string[];
  },
): string {
  const lines: string[] = [
    `${pc.bold("Source")}  ${meta.sourceLabel}`,
    `${pc.bold("Target")}  ${meta.targetLabel}`,
    `${pc.bold("Include")} ${summarizeInclude(preview.include)}`,
    `${pc.bold("Mode")}    ${preview.collisionStrategy} collisions`,
    "",
    pc.bold("Package"),
    `- squad: ${preview.manifest.squad?.name ?? preview.manifest.source?.squadName ?? "not included"}`,
    `- agents: ${preview.manifest.agents.length}`,
    `- projects: ${preview.manifest.projects.length}`,
    `- tasks: ${preview.manifest.issues.length}`,
    `- skills: ${preview.manifest.skills.length}`,
  ];

  if (preview.envInputs.length > 0) {
    const requiredCount = preview.envInputs.filter((item) => item.requirement === "required").length;
    lines.push(`- env inputs: ${preview.envInputs.length} (${requiredCount} required)`);
  }

  lines.push("");
  lines.push(pc.bold("Plan"));
  lines.push(`- squad: ${actionChip(preview.plan.squadAction === "none" ? "unchanged" : preview.plan.squadAction)}`);
  lines.push(`- agents: ${summarizePlanCounts(preview.plan.agentPlans, "agent")}`);
  lines.push(`- projects: ${summarizePlanCounts(preview.plan.projectPlans, "project")}`);
  lines.push(`- tasks: ${summarizePlanCounts(preview.plan.issuePlans, "task")}`);
  if (preview.include.skills) {
    lines.push(`- skills: ${preview.manifest.skills.length} ${pluralize(preview.manifest.skills.length, "skill")} packaged`);
  }

  appendPreviewExamples(
    lines,
    "Agent examples",
    preview.plan.agentPlans.map((plan) => ({
      action: plan.action,
      label: `${plan.slug} -> ${plan.plannedName}`,
      reason: plan.reason,
    })),
  );
  appendPreviewExamples(
    lines,
    "Project examples",
    preview.plan.projectPlans.map((plan) => ({
      action: plan.action,
      label: `${plan.slug} -> ${plan.plannedName}`,
      reason: plan.reason,
    })),
  );
  appendPreviewExamples(
    lines,
    "Task examples",
    preview.plan.issuePlans.map((plan) => ({
      action: plan.action,
      label: `${plan.slug} -> ${plan.plannedTitle}`,
      reason: plan.reason,
    })),
  );

  appendMessageBlock(lines, pc.cyan("Info"), meta.infoMessages ?? []);
  appendMessageBlock(lines, pc.yellow("Warnings"), preview.warnings);
  appendMessageBlock(lines, pc.red("Errors"), preview.errors);

  return lines.join("\n");
}

export function renderSquadImportResult(
  result: SquadPortabilityImportResult,
  meta: { targetLabel: string; squadUrl?: string; infoMessages?: string[] },
): string {
  const lines: string[] = [
    `${pc.bold("Target")}  ${meta.targetLabel}`,
    `${pc.bold("Squad")} ${result.squad.name} (${actionChip(result.squad.action)})`,
    `${pc.bold("Agents")}  ${summarizeImportAgentResults(result.agents)}`,
    `${pc.bold("Projects")} ${summarizeImportProjectResults(result.projects)}`,
  ];

  if (meta.squadUrl) {
    lines.splice(1, 0, `${pc.bold("URL")}     ${meta.squadUrl}`);
  }

  appendPreviewExamples(
    lines,
    "Agent results",
    result.agents.map((agent) => ({
      action: agent.action,
      label: `${agent.slug} -> ${agent.name}`,
      reason: agent.reason,
    })),
  );
  appendPreviewExamples(
    lines,
    "Project results",
    result.projects.map((project) => ({
      action: project.action,
      label: `${project.slug} -> ${project.name}`,
      reason: project.reason,
    })),
  );

  if (result.envInputs.length > 0) {
    lines.push("");
    lines.push(pc.bold("Env inputs"));
    lines.push(
      `- ${result.envInputs.length} ${pluralize(result.envInputs.length, "input")} may need values after import`,
    );
  }

  appendMessageBlock(lines, pc.cyan("Info"), meta.infoMessages ?? []);
  appendMessageBlock(lines, pc.yellow("Warnings"), result.warnings);

  return lines.join("\n");
}

function printSquadImportView(title: string, body: string, opts?: { interactive?: boolean }): void {
  if (opts?.interactive) {
    p.note(body, title);
    return;
  }
  console.log(pc.bold(title));
  console.log(body);
}

export function resolveSquadImportApiPath(input: {
  dryRun: boolean;
  targetMode: "new_squad" | "existing_squad";
  squadId?: string | null;
}): string {
  if (input.targetMode === "existing_squad") {
    const squadId = input.squadId?.trim();
    if (!squadId) {
      throw new Error("Existing-squad imports require a squadId to resolve the API route.");
    }
    return input.dryRun
      ? apiPath`/api/squads/${squadId}/imports/preview`
      : apiPath`/api/squads/${squadId}/imports/apply`;
  }

  return input.dryRun ? "/api/squads/import/preview" : "/api/squads/import";
}

export function buildSquadDashboardUrl(apiBase: string, issuePrefix: string): string {
  const url = new URL(apiBase);
  const normalizedPrefix = issuePrefix.trim().replace(/^\/+|\/+$/g, "");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${normalizedPrefix}/dashboard`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function resolveSquadImportApplyConfirmationMode(input: {
  yes?: boolean;
  interactive: boolean;
  json: boolean;
}): "skip" | "prompt" {
  if (input.yes) {
    return "skip";
  }
  if (input.json) {
    throw new Error(
      "Applying a squad import with --json requires --yes. Use --dry-run first to inspect the preview.",
    );
  }
  if (!input.interactive) {
    throw new Error(
      "Applying a squad import from a non-interactive terminal requires --yes. Use --dry-run first to inspect the preview.",
    );
  }
  return "prompt";
}

export function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

export function looksLikeRepoUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:") return false;
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.length >= 2;
  } catch {
    return false;
  }
}

function isGithubSegment(input: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(input);
}

export function isGithubShorthand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || isHttpUrl(trimmed)) return false;
  if (
    trimmed.startsWith(".") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~") ||
    trimmed.includes("\\") ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    return false;
  }

  const segments = trimmed.split("/").filter(Boolean);
  return segments.length >= 2 && segments.every(isGithubSegment);
}

function normalizeGithubImportPath(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/^\/+|\/+$/g, "");
  return trimmed || null;
}

function buildGithubImportUrl(input: {
  hostname?: string;
  owner: string;
  repo: string;
  ref?: string | null;
  path?: string | null;
  squadPath?: string | null;
}): string {
  const host = input.hostname || "github.com";
  const url = new URL(`https://${host}/${input.owner}/${input.repo.replace(/\.git$/i, "")}`);
  const ref = input.ref?.trim();
  if (ref) {
    url.searchParams.set("ref", ref);
  }
  const squadPath = normalizeGithubImportPath(input.squadPath);
  if (squadPath) {
    url.searchParams.set("squadPath", squadPath);
    return url.toString();
  }
  const sourcePath = normalizeGithubImportPath(input.path);
  if (sourcePath) {
    url.searchParams.set("path", sourcePath);
  }
  return url.toString();
}

export function normalizeGithubImportSource(input: string, refOverride?: string): string {
  const trimmed = input.trim();
  const ref = refOverride?.trim();

  if (isGithubShorthand(trimmed)) {
    const [owner, repo, ...repoPath] = trimmed.split("/").filter(Boolean);
    return buildGithubImportUrl({
      owner: owner!,
      repo: repo!,
      ref: ref || "main",
      path: repoPath.join("/"),
    });
  }

  if (!looksLikeRepoUrl(trimmed)) {
    throw new Error("GitHub source must be a GitHub or GitHub Enterprise URL, or owner/repo[/path] shorthand.");
  }
  if (!ref) {
    return trimmed;
  }

  const url = new URL(trimmed);
  const hostname = url.hostname;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Invalid GitHub URL.");
  }

  const owner = parts[0]!;
  const repo = parts[1]!;
  const existingPath = normalizeGithubImportPath(url.searchParams.get("path"));
  const existingSquadPath = normalizeGithubImportPath(url.searchParams.get("squadPath"));
  if (existingSquadPath) {
    return buildGithubImportUrl({ hostname, owner, repo, ref, squadPath: existingSquadPath });
  }
  if (existingPath) {
    return buildGithubImportUrl({ hostname, owner, repo, ref, path: existingPath });
  }
  if (parts[2] === "tree") {
    return buildGithubImportUrl({ hostname, owner, repo, ref, path: parts.slice(4).join("/") });
  }
  if (parts[2] === "blob") {
    return buildGithubImportUrl({ hostname, owner, repo, ref, squadPath: parts.slice(4).join("/") });
  }
  return buildGithubImportUrl({ hostname, owner, repo, ref });
}

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await stat(path.resolve(inputPath));
    return true;
  } catch {
    return false;
  }
}

async function collectPackageFiles(
  root: string,
  current: string,
  files: Record<string, SquadPortabilityFileEntry>,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".git")) continue;
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectPackageFiles(root, absolutePath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
    if (!shouldIncludePortableFile(relativePath)) continue;
    files[relativePath] = readPortableFileEntry(relativePath, await readFile(absolutePath));
  }
}

export async function resolveInlineSourceFromPath(inputPath: string): Promise<{
  rootPath: string;
  files: Record<string, SquadPortabilityFileEntry>;
}> {
  const resolved = path.resolve(inputPath);
  const resolvedStat = await stat(resolved);
  if (resolvedStat.isFile() && path.extname(resolved).toLowerCase() === ".zip") {
    const archive = await readZipArchive(await readFile(resolved));
    const filteredFiles = Object.fromEntries(
      Object.entries(archive.files).filter(([relativePath]) => shouldIncludePortableFile(relativePath)),
    );
    return {
      rootPath: archive.rootPath ?? path.basename(resolved, ".zip"),
      files: filteredFiles,
    };
  }

  const rootDir = resolvedStat.isDirectory() ? resolved : path.dirname(resolved);
  const files: Record<string, SquadPortabilityFileEntry> = {};
  await collectPackageFiles(rootDir, rootDir, files);
  return {
    rootPath: path.basename(rootDir),
    files,
  };
}

export async function writeExportToFolder(outDir: string, exported: SquadPortabilityExportResult): Promise<void> {
  const root = path.resolve(outDir);
  await mkdir(root, { recursive: true });
  for (const [relativePath, content] of Object.entries(exported.files)) {
    const normalized = relativePath.replace(/\\/g, "/");
    const filePath = resolveExportOutputPath(root, normalized);
    await mkdir(path.dirname(filePath), { recursive: true });
    const writeValue = portableFileEntryToWriteValue(content);
    if (typeof writeValue === "string") {
      await writeFile(filePath, writeValue, "utf8");
    } else {
      await writeFile(filePath, writeValue);
    }
  }
}

export function resolveExportOutputPath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, relativePath);
  const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (filePath !== resolvedRoot && !filePath.startsWith(rootPrefix)) {
    throw new Error(`Refusing to write export file outside output directory: ${relativePath}`);
  }
  return filePath;
}

async function confirmOverwriteExportDirectory(outDir: string): Promise<void> {
  const root = path.resolve(outDir);
  const stats = await stat(root).catch(() => null);
  if (!stats) return;
  if (!stats.isDirectory()) {
    throw new Error(`Export output path ${root} exists and is not a directory.`);
  }

  const entries = await readdir(root);
  if (entries.length === 0) return;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Export output directory ${root} already contains files. Re-run interactively or choose an empty directory.`);
  }

  const confirmed = await p.confirm({
    message: `Overwrite existing files in ${root}?`,
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    throw new Error("Export cancelled.");
  }
}

function matchesPrefix(squad: Squad, selector: string): boolean {
  return squad.issuePrefix.toUpperCase() === selector.toUpperCase();
}

export function resolveSquadForDeletion(
  squads: Squad[],
  selectorRaw: string,
  by: SquadDeleteSelectorMode = "auto",
): Squad {
  const selector = normalizeSelector(selectorRaw);
  if (!selector) {
    throw new Error("Squad selector is required.");
  }

  const idMatch = squads.find((squad) => squad.id === selector);
  const prefixMatch = squads.find((squad) => matchesPrefix(squad, selector));

  if (by === "id") {
    if (!idMatch) {
      throw new Error(`No squad found by ID '${selector}'.`);
    }
    return idMatch;
  }

  if (by === "prefix") {
    if (!prefixMatch) {
      throw new Error(`No squad found by shortname/prefix '${selector}'.`);
    }
    return prefixMatch;
  }

  if (idMatch && prefixMatch && idMatch.id !== prefixMatch.id) {
    throw new Error(
      `Selector '${selector}' is ambiguous (matches both an ID and a shortname). Re-run with --by id or --by prefix.`,
    );
  }

  if (idMatch) return idMatch;
  if (prefixMatch) return prefixMatch;

  throw new Error(
    `No squad found for selector '${selector}'. Use squad ID or issue prefix (for example PAP).`,
  );
}

export function assertDeleteConfirmation(squad: Squad, opts: SquadDeleteOptions): void {
  if (!opts.yes) {
    throw new Error("Deletion requires --yes.");
  }

  const confirm = opts.confirm?.trim();
  if (!confirm) {
    throw new Error(
      "Deletion requires --confirm <value> where value matches the squad ID or issue prefix.",
    );
  }

  const confirmsById = confirm === squad.id;
  const confirmsByPrefix = confirm.toUpperCase() === squad.issuePrefix.toUpperCase();
  if (!confirmsById && !confirmsByPrefix) {
    throw new Error(
      `Confirmation '${confirm}' does not match target squad. Expected ID '${squad.id}' or prefix '${squad.issuePrefix}'.`,
    );
  }
}

function assertDeleteFlags(opts: SquadDeleteOptions): void {
  if (!opts.yes) {
    throw new Error("Deletion requires --yes.");
  }
  if (!opts.confirm?.trim()) {
    throw new Error(
      "Deletion requires --confirm <value> where value matches the squad ID or issue prefix.",
    );
  }
}

export function registerSquadCommands(program: Command): void {
  const squad = program.command("squad").description("Squad operations");

  addCommonClientOptions(
    squad
      .command("list")
      .description("List squads")
      .action(async (opts: SquadCommandOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const rows = (await ctx.api.get<Squad[]>("/api/squads")) ?? [];
          if (ctx.json) {
            printOutput(rows, { json: true });
            return;
          }

          if (rows.length === 0) {
            printOutput([], { json: false });
            return;
          }

          const formatted = rows.map((row) => ({
            id: row.id,
            name: row.name,
            status: row.status,
            budgetMonthlyCents: row.budgetMonthlyCents,
            spentMonthlyCents: row.spentMonthlyCents,
            requireBoardApprovalForNewAgents: row.requireBoardApprovalForNewAgents,
          }));
          for (const row of formatted) {
            console.log(formatInlineRecord(row));
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    squad
      .command("get")
      .description("Get one squad")
      .argument("<squadId>", "Squad ID")
      .action(async (squadId: string, opts: SquadCommandOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const row = await ctx.api.get<Squad>(apiPath`/api/squads/${squadId}`);
          printOutput(row, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    squad
      .command("stats")
      .description("Get squad stats")
      .action(async (opts: SquadCommandOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get("/api/squads/stats"), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    squad
      .command("create")
      .description("Create a squad")
      .requiredOption("--payload-json <json>", "CreateSquad JSON payload")
      .action(async (opts: SquadJsonOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post("/api/squads", parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    squad
      .command("update")
      .description("Update a squad")
      .argument("<squadId>", "Squad ID")
      .requiredOption("--payload-json <json>", "UpdateSquad JSON payload")
      .action(async (squadId: string, opts: SquadJsonOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.patch(apiPath`/api/squads/${squadId}`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    squad
      .command("branding:update")
      .description("Update squad branding")
      .argument("<squadId>", "Squad ID")
      .requiredOption("--payload-json <json>", "UpdateSquadBranding JSON payload")
      .action(async (squadId: string, opts: SquadJsonOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.patch(apiPath`/api/squads/${squadId}/branding`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    squad
      .command("archive")
      .description("Archive a squad")
      .argument("<squadId>", "Squad ID")
      .action(async (squadId: string, opts: SquadCommandOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post(apiPath`/api/squads/${squadId}/archive`, {}), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addSquadJsonPost(squad, "export:preview", "Preview a portable squad export", "exports/preview");
  addSquadJsonPost(squad, "export:api", "Export a squad through the raw API route", "exports");
  addSquadJsonPost(squad, "import:preview", "Preview a safe squad import through the raw API route", "imports/preview");
  addSquadJsonPost(squad, "import:apply", "Apply a safe squad import through the raw API route", "imports/apply");

  addCommonClientOptions(
    squad
      .command("feedback:list")
      .description("List feedback traces for a squad")
      .requiredOption("-C, --squad-id <id>", "Squad ID")
      .option("--target-type <type>", "Filter by target type")
      .option("--vote <vote>", "Filter by vote value")
      .option("--status <status>", "Filter by trace status")
      .option("--project-id <id>", "Filter by project ID")
      .option("--issue-id <id>", "Filter by issue ID")
      .option("--from <iso8601>", "Only include traces created at or after this timestamp")
      .option("--to <iso8601>", "Only include traces created at or before this timestamp")
      .option("--shared-only", "Only include traces eligible for sharing/export")
      .option("--include-payload", "Include stored payload snapshots in the response")
      .action(async (opts: SquadFeedbackOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const traces = (await ctx.api.get<FeedbackTrace[]>(
            `${apiPath`/api/squads/${ctx.squadId}/feedback-traces`}${buildFeedbackTraceQuery(opts)}`,
          )) ?? [];
          if (ctx.json) {
            printOutput(traces, { json: true });
            return;
          }
          printOutput(
            traces.map((trace) => ({
              id: trace.id,
              issue: trace.issueIdentifier ?? trace.issueId,
              vote: trace.vote,
              status: trace.status,
              targetType: trace.targetType,
              target: trace.targetSummary.label,
            })),
            { json: false },
          );
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  addCommonClientOptions(
    squad
      .command("feedback:export")
      .description("Export feedback traces for a squad")
      .requiredOption("-C, --squad-id <id>", "Squad ID")
      .option("--target-type <type>", "Filter by target type")
      .option("--vote <vote>", "Filter by vote value")
      .option("--status <status>", "Filter by trace status")
      .option("--project-id <id>", "Filter by project ID")
      .option("--issue-id <id>", "Filter by issue ID")
      .option("--from <iso8601>", "Only include traces created at or after this timestamp")
      .option("--to <iso8601>", "Only include traces created at or before this timestamp")
      .option("--shared-only", "Only include traces eligible for sharing/export")
      .option("--include-payload", "Include stored payload snapshots in the export")
      .option("--out <path>", "Write export to a file path instead of stdout")
      .option("--format <format>", "Export format: json or ndjson", "ndjson")
      .action(async (opts: SquadFeedbackOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const traces = (await ctx.api.get<FeedbackTrace[]>(
            `${apiPath`/api/squads/${ctx.squadId}/feedback-traces`}${buildFeedbackTraceQuery(opts, opts.includePayload ?? true)}`,
          )) ?? [];
          const serialized = serializeFeedbackTraces(traces, opts.format);
          if (opts.out?.trim()) {
            await writeFile(opts.out, serialized, "utf8");
            if (ctx.json) {
              printOutput(
                { out: opts.out, count: traces.length, format: normalizeFeedbackTraceExportFormat(opts.format) },
                { json: true },
              );
              return;
            }
            console.log(`Wrote ${traces.length} feedback trace(s) to ${opts.out}`);
            return;
          }
          process.stdout.write(`${serialized}${serialized.endsWith("\n") ? "" : "\n"}`);
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  addCommonClientOptions(
    squad
      .command("export")
      .description("Export a squad into a portable markdown package")
      .argument("<squadId>", "Squad ID")
      .requiredOption("--out <path>", "Output directory")
      .option("--include <values>", "Comma-separated include set: squad,agents,projects,issues,tasks,skills", "squad,agents")
      .option("--skills <values>", "Comma-separated skill slugs/keys to export")
      .option("--projects <values>", "Comma-separated project shortnames/ids to export")
      .option("--issues <values>", "Comma-separated issue identifiers/ids to export")
      .option("--project-issues <values>", "Comma-separated project shortnames/ids whose issues should be exported")
      .option("--expand-referenced-skills", "Vendor skill contents instead of exporting upstream references", false)
      .action(async (squadId: string, opts: SquadExportOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const include = parseInclude(opts.include);
          const exported = await ctx.api.post<SquadPortabilityExportResult>(
            apiPath`/api/squads/${squadId}/export`,
            {
              include,
              skills: parseCsvValues(opts.skills),
              projects: parseCsvValues(opts.projects),
              issues: parseCsvValues(opts.issues),
              projectIssues: parseCsvValues(opts.projectIssues),
              expandReferencedSkills: Boolean(opts.expandReferencedSkills),
            },
          );
          if (!exported) {
            throw new Error("Export request returned no data");
          }
          await confirmOverwriteExportDirectory(opts.out!);
          await writeExportToFolder(opts.out!, exported);
          printOutput(
            {
              ok: true,
              out: path.resolve(opts.out!),
              rootPath: exported.rootPath,
              filesWritten: Object.keys(exported.files).length,
              slawExtensionPath: exported.slawExtensionPath,
              warningCount: exported.warnings.length,
            },
            { json: ctx.json },
          );
          if (!ctx.json && exported.warnings.length > 0) {
            for (const warning of exported.warnings) {
              console.log(`warning=${warning}`);
            }
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    squad
      .command("import")
      .description("Import a portable markdown squad package from local path, URL, or GitHub")
      .argument("<fromPathOrUrl>", "Source path or URL")
      .option("--include <values>", "Comma-separated include set: squad,agents,projects,issues,tasks,skills")
      .option("--target <mode>", "Target mode: new | existing")
      .option("-C, --squad-id <id>", "Existing target squad ID")
      .option("--new-squad-name <name>", "Name override for --target new")
      .option("--agents <list>", "Comma-separated agent slugs to import, or all", "all")
      .option("--collision <mode>", "Collision strategy: rename | skip | replace", "rename")
      .option("--ref <value>", "Git ref to use for GitHub imports (branch, tag, or commit)")
      .option("--slaw-url <url>", "Alias for --api-base on this command")
      .option("--yes", "Accept default selection and skip the pre-import confirmation prompt", false)
      .option("--dry-run", "Run preview only without applying", false)
      .action(async (fromPathOrUrl: string, opts: SquadImportOptions) => {
        try {
          if (!opts.apiBase?.trim() && opts.slawUrl?.trim()) {
            opts.apiBase = opts.slawUrl.trim();
          }
          const ctx = resolveCommandContext(opts);
          const interactiveView = isInteractiveTerminal() && !ctx.json;
          const from = fromPathOrUrl.trim();
          if (!from) {
            throw new Error("Source path or URL is required.");
          }

          const include = resolveImportInclude(opts.include);
          const agents = parseAgents(opts.agents);
          const collision = (opts.collision ?? "rename").toLowerCase() as SquadCollisionMode;
          if (!["rename", "skip", "replace"].includes(collision)) {
            throw new Error("Invalid --collision value. Use: rename, skip, replace");
          }

          const inferredTarget = opts.target ?? (opts.squadId || ctx.squadId ? "existing" : "new");
          const target = inferredTarget.toLowerCase() as SquadImportTargetMode;
          if (!["new", "existing"].includes(target)) {
            throw new Error("Invalid --target value. Use: new | existing");
          }

          const existingTargetSquadId = opts.squadId?.trim() || ctx.squadId;
          const targetPayload =
            target === "existing"
              ? {
                  mode: "existing_squad" as const,
                  squadId: existingTargetSquadId,
                }
              : {
                  mode: "new_squad" as const,
                  newSquadName: opts.newSquadName?.trim() || null,
                };

          if (targetPayload.mode === "existing_squad" && !targetPayload.squadId) {
            throw new Error("Target existing squad requires --squad-id (or context default squadId).");
          }

          let sourcePayload:
            | { type: "inline"; rootPath?: string | null; files: Record<string, SquadPortabilityFileEntry> }
            | { type: "github"; url: string };

          const treatAsLocalPath = !isHttpUrl(from) && await pathExists(from);
          const isGithubSource = looksLikeRepoUrl(from) || (isGithubShorthand(from) && !treatAsLocalPath);

          if (isHttpUrl(from) || isGithubSource) {
            if (!looksLikeRepoUrl(from) && !isGithubShorthand(from)) {
              throw new Error(
                "Only GitHub URLs and local paths are supported for import. " +
                "Generic HTTP URLs are not supported. Use a GitHub or GitHub Enterprise URL (https://github.com/... or https://ghe.example.com/...) or a local directory path.",
              );
            }
            sourcePayload = { type: "github", url: normalizeGithubImportSource(from, opts.ref) };
          } else {
            if (opts.ref?.trim()) {
              throw new Error("--ref is only supported for GitHub import sources.");
            }
            const inline = await resolveInlineSourceFromPath(from);
            sourcePayload = {
              type: "inline",
              rootPath: inline.rootPath,
              files: inline.files,
            };
          }

          const sourceLabel = formatSourceLabel(sourcePayload);
          const targetLabel = formatTargetLabel(targetPayload);
          const previewApiPath = resolveSquadImportApiPath({
            dryRun: true,
            targetMode: targetPayload.mode,
            squadId: targetPayload.mode === "existing_squad" ? targetPayload.squadId : null,
          });

          let selectedFiles: string[] | undefined;
          if (interactiveView && !opts.yes && !opts.include?.trim()) {
            const initialPreview = await ctx.api.post<SquadPortabilityPreviewResult>(previewApiPath, {
              source: sourcePayload,
              include,
              target: targetPayload,
              agents,
              collisionStrategy: collision,
            });
            if (!initialPreview) {
              throw new Error("Import preview returned no data.");
            }
            selectedFiles = await promptForImportSelection(initialPreview);
          }

          const previewPayload = {
            source: sourcePayload,
            include,
            target: targetPayload,
            agents,
            collisionStrategy: collision,
            selectedFiles,
          };
          const preview = await ctx.api.post<SquadPortabilityPreviewResult>(previewApiPath, previewPayload);
          if (!preview) {
            throw new Error("Import preview returned no data.");
          }
          const adapterOverrides = buildDefaultImportAdapterOverrides(preview);
          const adapterMessages = buildDefaultImportAdapterMessages(adapterOverrides);

          if (opts.dryRun) {
            if (ctx.json) {
              printOutput(preview, { json: true });
            } else {
              printSquadImportView(
                "Import Preview",
                renderSquadImportPreview(preview, {
                  sourceLabel,
                  targetLabel: formatTargetLabel(targetPayload, preview),
                  infoMessages: adapterMessages,
                }),
                { interactive: interactiveView },
              );
            }
            return;
          }

          if (!ctx.json) {
            printSquadImportView(
              "Import Preview",
              renderSquadImportPreview(preview, {
                sourceLabel,
                targetLabel: formatTargetLabel(targetPayload, preview),
                infoMessages: adapterMessages,
              }),
              { interactive: interactiveView },
            );
          }

          const confirmationMode = resolveSquadImportApplyConfirmationMode({
            yes: opts.yes,
            interactive: interactiveView,
            json: ctx.json,
          });
          if (confirmationMode === "prompt") {
            const confirmed = await p.confirm({
              message: "Apply this import? (y/N)",
              initialValue: false,
            });
            if (p.isCancel(confirmed) || !confirmed) {
              p.log.warn("Import cancelled.");
              return;
            }
          }

          const importApiPath = resolveSquadImportApiPath({
            dryRun: false,
            targetMode: targetPayload.mode,
            squadId: targetPayload.mode === "existing_squad" ? targetPayload.squadId : null,
          });
          const imported = await ctx.api.post<SquadPortabilityImportResult>(importApiPath, {
            ...previewPayload,
            adapterOverrides,
          });
          if (!imported) {
            throw new Error("Import request returned no data.");
          }
          const tc = getTelemetryClient();
          if (tc) {
            const isPrivate = sourcePayload.type !== "github";
            const sourceRef = sourcePayload.type === "github" ? sourcePayload.url : from;
            trackSquadImported(tc, { sourceType: sourcePayload.type, sourceRef, isPrivate });
          }
          let squadUrl: string | undefined;
          if (!ctx.json) {
            try {
              const importedSquad = await ctx.api.get<Squad>(apiPath`/api/squads/${imported.squad.id}`);
              const issuePrefix = importedSquad?.issuePrefix?.trim();
              if (issuePrefix) {
                squadUrl = buildSquadDashboardUrl(ctx.api.apiBase, issuePrefix);
              }
            } catch {
              squadUrl = undefined;
            }
          }
          if (ctx.json) {
            printOutput(imported, { json: true });
          } else {
            printSquadImportView(
              "Import Result",
              renderSquadImportResult(imported, {
                targetLabel,
                squadUrl,
                infoMessages: adapterMessages,
              }),
              { interactive: interactiveView },
            );
            if (interactiveView && squadUrl) {
              const openImportedSquad = await p.confirm({
                message: "Open the imported squad in your browser?",
                initialValue: true,
              });
              if (!p.isCancel(openImportedSquad) && openImportedSquad) {
                if (openUrl(squadUrl)) {
                  p.log.info(`Opened ${squadUrl}`);
                } else {
                  p.log.warn(`Could not open your browser automatically. Open this URL manually:\n${squadUrl}`);
                }
              }
            }
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    squad
      .command("delete")
      .description("Delete a squad by ID or shortname/prefix (destructive)")
      .argument("<selector>", "Squad ID or issue prefix (for example PAP)")
      .option(
        "--by <mode>",
        "Selector mode: auto | id | prefix",
        "auto",
      )
      .option("--yes", "Required safety flag to confirm destructive action", false)
      .option(
        "--confirm <value>",
        "Required safety value: target squad ID or shortname/prefix",
      )
      .action(async (selector: string, opts: SquadDeleteOptions) => {
        try {
          const by = (opts.by ?? "auto").trim().toLowerCase() as SquadDeleteSelectorMode;
          if (!["auto", "id", "prefix"].includes(by)) {
            throw new Error(`Invalid --by mode '${opts.by}'. Expected one of: auto, id, prefix.`);
          }

          const ctx = resolveCommandContext(opts);
          const normalizedSelector = normalizeSelector(selector);
          assertDeleteFlags(opts);

          let target: Squad | null = null;
          const shouldTryIdLookup = by === "id" || (by === "auto" && isUuidLike(normalizedSelector));
          if (shouldTryIdLookup) {
            const byId = await ctx.api.get<Squad>(apiPath`/api/squads/${normalizedSelector}`, { ignoreNotFound: true });
            if (byId) {
              target = byId;
            } else if (by === "id") {
              throw new Error(`No squad found by ID '${normalizedSelector}'.`);
            }
          }

          if (!target && ctx.squadId) {
            const scoped = await ctx.api.get<Squad>(apiPath`/api/squads/${ctx.squadId}`, { ignoreNotFound: true });
            if (scoped) {
              try {
                target = resolveSquadForDeletion([scoped], normalizedSelector, by);
              } catch {
                // Fallback to board-wide lookup below.
              }
            }
          }

          if (!target) {
            try {
              const squads = (await ctx.api.get<Squad[]>("/api/squads")) ?? [];
              target = resolveSquadForDeletion(squads, normalizedSelector, by);
            } catch (error) {
              if (error instanceof ApiRequestError && error.status === 403 && error.message.includes("Board access required")) {
                throw new Error(
                  "Board access is required to resolve squads across the instance. Use a squad ID/prefix for your current squad, or run with board authentication.",
                );
              }
              throw error;
            }
          }

          if (!target) {
            throw new Error(`No squad found for selector '${normalizedSelector}'.`);
          }

          assertDeleteConfirmation(target, opts);

          await ctx.api.delete<{ ok: true }>(apiPath`/api/squads/${target.id}`);

          printOutput(
            {
              ok: true,
              deletedSquadId: target.id,
              deletedSquadName: target.name,
              deletedSquadPrefix: target.issuePrefix,
            },
            { json: ctx.json },
          );
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}

function addSquadJsonPost(parent: Command, name: string, description: string, pathSuffix: string): void {
  addCommonClientOptions(
    parent
      .command(name)
      .description(description)
      .argument("<squadId>", "Squad ID")
      .requiredOption("--payload-json <json>", "JSON payload")
      .action(async (squadId: string, opts: SquadJsonOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post(`${apiPath`/api/squads/${squadId}`}/${pathSuffix}`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
