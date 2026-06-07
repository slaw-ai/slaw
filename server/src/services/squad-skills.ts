import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@slaw/db";
import { squads, squadSkills } from "@slaw/db";
import { readSlawSkillSyncPreference } from "@slaw/adapter-utils/server-utils";
import type { SlawSkillEntry } from "@slaw/adapter-utils/server-utils";
import type {
  CatalogSkill,
  SquadSkill,
  SquadSkillAuditFinding,
  SquadSkillAuditResult,
  SquadSkillAuditVerdict,
  SquadSkillCreateRequest,
  SquadSkillCompatibility,
  SquadSkillDetail,
  SquadSkillFileDetail,
  SquadSkillFileInventoryEntry,
  SquadSkillImportResult,
  SquadSkillInstallCatalogRequest,
  SquadSkillInstallCatalogResult,
  SquadSkillListItem,
  SquadSkillProjectScanConflict,
  SquadSkillProjectScanRequest,
  SquadSkillProjectScanResult,
  SquadSkillProjectScanSkipped,
  SquadSkillSourceBadge,
  SquadSkillSourceType,
  SquadSkillTrustLevel,
  SquadSkillUpdateStatus,
  SquadSkillUpdateHoldReason,
  SquadSkillUsageAgent,
} from "@slaw/shared";
import { normalizeAgentUrlKey } from "@slaw/shared";
import { resolveSlawInstanceRoot } from "../home-paths.js";
import { conflict, notFound, unprocessable } from "../errors.js";
import { ghFetch, gitHubApiBase, resolveRawGitHubUrl } from "./github-fetch.js";
import { agentService } from "./agents.js";
import { projectService } from "./projects.js";
import { normalizePortablePath } from "./portable-path.js";
import {
  copyCatalogSkillFile,
  getCatalogPackageMetadata,
  getCatalogSkillOrThrow,
  readCatalogSkillFile,
  resolveCatalogSkillReference,
} from "./skills-catalog.js";
import {
  PORTABLE_CATALOG_PROVENANCE_STRING_KEYS,
  readCatalogStringList,
  readPortableCatalogProvenance,
} from "./catalog-provenance.js";

type SquadSkillRow = typeof squadSkills.$inferSelect;
type SquadSkillListDbRow = Pick<
  SquadSkillRow,
  | "id"
  | "squadId"
  | "key"
  | "slug"
  | "name"
  | "description"
  | "sourceType"
  | "sourceLocator"
  | "sourceRef"
  | "trustLevel"
  | "compatibility"
  | "fileInventory"
  | "metadata"
  | "createdAt"
  | "updatedAt"
>;
type SquadSkillListRow = Pick<
  SquadSkill,
  | "id"
  | "squadId"
  | "key"
  | "slug"
  | "name"
  | "description"
  | "sourceType"
  | "sourceLocator"
  | "sourceRef"
  | "trustLevel"
  | "compatibility"
  | "fileInventory"
  | "metadata"
  | "createdAt"
  | "updatedAt"
>;
type SquadSkillReferenceRow = Pick<
  SquadSkillRow,
  | "id"
  | "key"
  | "slug"
>;
type SkillReferenceTarget = Pick<SquadSkill, "id" | "key" | "slug">;
type SkillSourceInfoTarget = Pick<
  SquadSkill,
  | "squadId"
  | "sourceType"
  | "sourceLocator"
  | "metadata"
  | "towerSkillVersion"
>;

type ImportedSkill = {
  key: string;
  slug: string;
  name: string;
  description: string | null;
  markdown: string;
  packageDir?: string | null;
  sourceType: SquadSkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: SquadSkillTrustLevel;
  compatibility: SquadSkillCompatibility;
  fileInventory: SquadSkillFileInventoryEntry[];
  metadata: Record<string, unknown> | null;
};

type PackageSkillConflictStrategy = "replace" | "rename" | "skip";

export type ImportPackageSkillResult = {
  skill: SquadSkill;
  action: "created" | "updated" | "skipped";
  originalKey: string;
  originalSlug: string;
  requestedRefs: string[];
  reason: string | null;
};

type ParsedSkillImportSource = {
  resolvedSource: string;
  requestedSkillSlug: string | null;
  originalSkillsShUrl: string | null;
  warnings: string[];
};

type SkillSourceMeta = {
  skillKey?: string;
  sourceKind?: string;
  missingSource?: SkillMissingSourceMarker;
  hostname?: string;
  owner?: string;
  repo?: string;
  ref?: string;
  trackingRef?: string;
  repoSkillDir?: string;
  projectId?: string;
  projectName?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceCwd?: string;
  catalogId?: string;
  catalogKind?: string;
  originHash?: string;
  packageName?: string;
  packageVersion?: string;
  originVersion?: string;
  originSnapshotLocator?: string;
  installedHash?: string;
  userModifiedAt?: string | null;
  updateHoldReason?: SquadSkillUpdateHoldReason | null;
  auditVerdict?: SquadSkillAuditVerdict;
  auditCodes?: string[];
  auditScannedAt?: string;
  auditScanVersion?: string;
};

type SkillMissingSourceMarker = {
  reason: "local_source_missing";
  sourceType: "local_path";
  sourceLocator: string | null;
  sourcePath: string | null;
  detectedAt: string;
};

export type LocalSkillInventoryMode = "full" | "project_root";

export type ProjectSkillScanTarget = {
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceCwd: string;
};

type RuntimeSkillEntryOptions = {
  materializeMissing?: boolean;
};

type RuntimeSkillSourceResolution =
  | { status: "available"; source: string }
  | { status: "missing"; source: string; detail: string };

const skillInventoryRefreshPromises = new Map<string, Promise<void>>();

function selectSquadSkillColumns() {
  return {
    id: squadSkills.id,
    squadId: squadSkills.squadId,
    key: squadSkills.key,
    slug: squadSkills.slug,
    name: squadSkills.name,
    description: squadSkills.description,
    markdown: squadSkills.markdown,
    sourceType: squadSkills.sourceType,
    sourceLocator: squadSkills.sourceLocator,
    sourceRef: squadSkills.sourceRef,
    trustLevel: squadSkills.trustLevel,
    compatibility: squadSkills.compatibility,
    fileInventory: squadSkills.fileInventory,
    metadata: squadSkills.metadata,
    isTowerManaged: squadSkills.isTowerManaged,
    towerSkillKey: squadSkills.towerSkillKey,
    towerSkillVersion: squadSkills.towerSkillVersion,
    createdAt: squadSkills.createdAt,
    updatedAt: squadSkills.updatedAt,
  };
}

const PROJECT_SCAN_DIRECTORY_ROOTS = [
  "skills",
  "skills/.curated",
  "skills/.experimental",
  "skills/.system",
  ".agents/skills",
  ".agent/skills",
  ".augment/skills",
  ".claude/skills",
  ".codebuddy/skills",
  ".commandcode/skills",
  ".continue/skills",
  ".cortex/skills",
  ".crush/skills",
  ".factory/skills",
  ".goose/skills",
  ".junie/skills",
  ".iflow/skills",
  ".kilocode/skills",
  ".kiro/skills",
  ".kode/skills",
  ".mcpjam/skills",
  ".vibe/skills",
  ".mux/skills",
  ".openhands/skills",
  ".pi/skills",
  ".qoder/skills",
  ".qwen/skills",
  ".roo/skills",
  ".trae/skills",
  ".windsurf/skills",
  ".zencoder/skills",
  ".neovate/skills",
  ".pochi/skills",
  ".adal/skills",
] as const;

const PROJECT_ROOT_SKILL_SUBDIRECTORIES = [
  "references",
  "scripts",
  "assets",
] as const;

const SKILL_AUDIT_SCAN_VERSION = "skills-audit-v1";
const MAX_CATALOG_FILE_BYTES = 1024 * 1024;

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePackageFileMap(files: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [rawPath, content] of Object.entries(files)) {
    const nextPath = normalizePortablePath(rawPath);
    if (!nextPath) continue;
    out[nextPath] = content;
  }
  return out;
}

function normalizeSkillSlug(value: string | null | undefined) {
  return value ? normalizeAgentUrlKey(value) ?? null : null;
}

function normalizeSkillKey(value: string | null | undefined) {
  if (!value) return null;
  const segments = value
    .split("/")
    .map((segment) => normalizeSkillSlug(segment))
    .filter((segment): segment is string => Boolean(segment));
  return segments.length > 0 ? segments.join("/") : null;
}

export function normalizeGitHubSkillDirectory(
  value: string | null | undefined,
  fallback: string,
) {
  const normalized = normalizePortablePath(value ?? "");
  if (!normalized) return normalizePortablePath(fallback);
  if (path.posix.basename(normalized).toLowerCase() === "skill.md") {
    return normalizePortablePath(path.posix.dirname(normalized));
  }
  return normalized;
}

function hashSkillValue(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function sha256Buffer(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildInventoryContentHash(entries: Array<{ path: string; sha256: string }>) {
  const hashInput = entries
    .map((entry) => ({ path: normalizePortablePath(entry.path), sha256: entry.sha256 }))
    .sort((left, right) => {
      if (left.path === "SKILL.md") return -1;
      if (right.path === "SKILL.md") return 1;
      return left.path.localeCompare(right.path);
    });
  return `sha256:${sha256Buffer(Buffer.from(JSON.stringify(hashInput)))}`;
}

function uniqueSkillSlug(baseSlug: string, usedSlugs: Set<string>) {
  if (!usedSlugs.has(baseSlug)) return baseSlug;
  let attempt = 2;
  let candidate = `${baseSlug}-${attempt}`;
  while (usedSlugs.has(candidate)) {
    attempt += 1;
    candidate = `${baseSlug}-${attempt}`;
  }
  return candidate;
}

function uniqueImportedSkillKey(squadId: string, baseSlug: string, usedKeys: Set<string>) {
  const initial = `squad/${squadId}/${baseSlug}`;
  if (!usedKeys.has(initial)) return initial;
  let attempt = 2;
  let candidate = `squad/${squadId}/${baseSlug}-${attempt}`;
  while (usedKeys.has(candidate)) {
    attempt += 1;
    candidate = `squad/${squadId}/${baseSlug}-${attempt}`;
  }
  return candidate;
}

function buildSkillRuntimeName(key: string, slug: string) {
  if (key.startsWith("slaw/slaw/")) return slug;
  return `${slug}--${hashSkillValue(key)}`;
}

function readCanonicalSkillKey(frontmatter: Record<string, unknown>, metadata: Record<string, unknown> | null) {
  const direct = normalizeSkillKey(
    asString(frontmatter.key)
    ?? asString(frontmatter.skillKey)
    ?? asString(metadata?.skillKey)
    ?? asString(metadata?.canonicalKey)
    ?? asString(metadata?.slawSkillKey),
  );
  if (direct) return direct;
  const slaw = isPlainRecord(metadata?.slaw) ? metadata?.slaw as Record<string, unknown> : null;
  return normalizeSkillKey(
    asString(slaw?.skillKey)
    ?? asString(slaw?.key),
  );
}

function deriveCanonicalSkillKey(
  squadId: string,
  input: Pick<ImportedSkill, "slug" | "sourceType" | "sourceLocator" | "metadata">,
) {
  const slug = normalizeSkillSlug(input.slug) ?? "skill";
  const metadata = isPlainRecord(input.metadata) ? input.metadata : null;
  const explicitKey = readCanonicalSkillKey({}, metadata);
  if (explicitKey) return explicitKey;

  const sourceKind = asString(metadata?.sourceKind);
  if (sourceKind === "slaw_bundled") {
    return `slaw/slaw/${slug}`;
  }

  const owner = normalizeSkillSlug(asString(metadata?.owner));
  const repo = normalizeSkillSlug(asString(metadata?.repo));
  if ((input.sourceType === "github" || input.sourceType === "skills_sh" || sourceKind === "github" || sourceKind === "skills_sh") && owner && repo) {
    return `${owner}/${repo}/${slug}`;
  }

  if (input.sourceType === "url" || sourceKind === "url") {
    const locator = asString(input.sourceLocator);
    if (locator) {
      try {
        const url = new URL(locator);
        const host = normalizeSkillSlug(url.host) ?? "url";
        return `url/${host}/${hashSkillValue(locator)}/${slug}`;
      } catch {
        return `url/unknown/${hashSkillValue(locator)}/${slug}`;
      }
    }
  }

  if (input.sourceType === "local_path") {
    if (sourceKind === "managed_local") {
      return `squad/${squadId}/${slug}`;
    }
    const locator = asString(input.sourceLocator);
    if (locator) {
      return `local/${hashSkillValue(path.resolve(locator))}/${slug}`;
    }
  }

  return `squad/${squadId}/${slug}`;
}

function classifyInventoryKind(relativePath: string): SquadSkillFileInventoryEntry["kind"] {
  const normalized = normalizePortablePath(relativePath).toLowerCase();
  if (normalized.endsWith("/skill.md") || normalized === "skill.md") return "skill";
  if (normalized.startsWith("references/")) return "reference";
  if (normalized.startsWith("scripts/")) return "script";
  if (normalized.startsWith("assets/")) return "asset";
  if (normalized.endsWith(".md")) return "markdown";
  const fileName = path.posix.basename(normalized);
  if (
    fileName.endsWith(".sh")
    || fileName.endsWith(".js")
    || fileName.endsWith(".mjs")
    || fileName.endsWith(".cjs")
    || fileName.endsWith(".ts")
    || fileName.endsWith(".py")
    || fileName.endsWith(".rb")
    || fileName.endsWith(".bash")
  ) {
    return "script";
  }
  if (
    fileName.endsWith(".png")
    || fileName.endsWith(".jpg")
    || fileName.endsWith(".jpeg")
    || fileName.endsWith(".gif")
    || fileName.endsWith(".svg")
    || fileName.endsWith(".webp")
    || fileName.endsWith(".pdf")
  ) {
    return "asset";
  }
  return "other";
}

function deriveTrustLevel(fileInventory: SquadSkillFileInventoryEntry[]): SquadSkillTrustLevel {
  if (fileInventory.some((entry) => entry.kind === "script")) return "scripts_executables";
  if (fileInventory.some((entry) => entry.kind === "asset" || entry.kind === "other")) return "assets";
  return "markdown_only";
}

function prepareYamlLines(raw: string) {
  return raw
    .split("\n")
    .map((line) => ({
      indent: line.match(/^ */)?.[0].length ?? 0,
      content: line.trim(),
    }))
    .filter((line) => line.content.length > 0 && !line.content.startsWith("#"));
}

function parseYamlScalar(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (trimmed === "") return "";
  if (trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "[]") return [];
  if (trimmed === "{}") return {};
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("\"") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function parseYamlBlock(
  lines: Array<{ indent: number; content: string }>,
  startIndex: number,
  indentLevel: number,
): { value: unknown; nextIndex: number } {
  let index = startIndex;
  while (index < lines.length && lines[index]!.content.length === 0) index += 1;
  if (index >= lines.length || lines[index]!.indent < indentLevel) {
    return { value: {}, nextIndex: index };
  }

  const isArray = lines[index]!.indent === indentLevel && lines[index]!.content.startsWith("-");
  if (isArray) {
    const values: unknown[] = [];
    while (index < lines.length) {
      const line = lines[index]!;
      if (line.indent < indentLevel) break;
      if (line.indent !== indentLevel || !line.content.startsWith("-")) break;
      const remainder = line.content.slice(1).trim();
      index += 1;
      if (!remainder) {
        const nested = parseYamlBlock(lines, index, indentLevel + 2);
        values.push(nested.value);
        index = nested.nextIndex;
        continue;
      }
      const inlineObjectSeparator = remainder.indexOf(":");
      if (
        inlineObjectSeparator > 0 &&
        !remainder.startsWith("\"") &&
        !remainder.startsWith("{") &&
        !remainder.startsWith("[")
      ) {
        const key = remainder.slice(0, inlineObjectSeparator).trim();
        const rawValue = remainder.slice(inlineObjectSeparator + 1).trim();
        const nextObject: Record<string, unknown> = {
          [key]: parseYamlScalar(rawValue),
        };
        if (index < lines.length && lines[index]!.indent > indentLevel) {
          const nested = parseYamlBlock(lines, index, indentLevel + 2);
          if (isPlainRecord(nested.value)) {
            Object.assign(nextObject, nested.value);
          }
          index = nested.nextIndex;
        }
        values.push(nextObject);
        continue;
      }
      values.push(parseYamlScalar(remainder));
    }
    return { value: values, nextIndex: index };
  }

  const record: Record<string, unknown> = {};
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indentLevel) break;
    if (line.indent !== indentLevel) {
      index += 1;
      continue;
    }
    const separatorIndex = line.content.indexOf(":");
    if (separatorIndex <= 0) {
      index += 1;
      continue;
    }
    const key = line.content.slice(0, separatorIndex).trim();
    const remainder = line.content.slice(separatorIndex + 1).trim();
    index += 1;
    if (!remainder) {
      const nested = parseYamlBlock(lines, index, indentLevel + 2);
      record[key] = nested.value;
      index = nested.nextIndex;
      continue;
    }
    record[key] = parseYamlScalar(remainder);
  }
  return { value: record, nextIndex: index };
}

function parseYamlFrontmatter(raw: string): Record<string, unknown> {
  const prepared = prepareYamlLines(raw);
  if (prepared.length === 0) return {};
  const parsed = parseYamlBlock(prepared, 0, prepared[0]!.indent);
  return isPlainRecord(parsed.value) ? parsed.value : {};
}

function parseFrontmatterMarkdown(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized.trim() };
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) {
    return { frontmatter: {}, body: normalized.trim() };
  }
  const frontmatterRaw = normalized.slice(4, closing).trim();
  const body = normalized.slice(closing + 5).trim();
  return {
    frontmatter: parseYamlFrontmatter(frontmatterRaw),
    body,
  };
}

async function fetchText(url: string) {
  const response = await ghFetch(url);
  if (!response.ok) {
    throw unprocessable(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await ghFetch(url, {
    headers: {
      accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    throw unprocessable(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}


async function resolveGitHubDefaultBranch(owner: string, repo: string, apiBase: string) {
  const response = await fetchJson<{ default_branch?: string }>(
    `${apiBase}/repos/${owner}/${repo}`,
  );
  return asString(response.default_branch) ?? "main";
}

async function resolveGitHubCommitSha(owner: string, repo: string, ref: string, apiBase: string) {
  const response = await fetchJson<{ sha?: string }>(
    `${apiBase}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
  );
  const sha = asString(response.sha);
  if (!sha) {
    throw unprocessable(`Failed to resolve GitHub ref ${ref}`);
  }
  return sha;
}

function parseGitHubSourceUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw unprocessable("GitHub source URL must use HTTPS");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw unprocessable("Invalid GitHub URL");
  }
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/i, "");
  let ref = "main";
  let basePath = "";
  let filePath: string | null = null;
  let explicitRef = false;
  if (parts[2] === "tree") {
    ref = parts[3] ?? "main";
    basePath = parts.slice(4).join("/");
    explicitRef = true;
  } else if (parts[2] === "blob") {
    ref = parts[3] ?? "main";
    filePath = parts.slice(4).join("/");
    basePath = filePath ? path.posix.dirname(filePath) : "";
    explicitRef = true;
  }
  return { hostname: url.hostname, owner, repo, ref, basePath, filePath, explicitRef };
}

async function resolveGitHubPinnedRef(parsed: ReturnType<typeof parseGitHubSourceUrl>) {
  const apiBase = gitHubApiBase(parsed.hostname);
  if (/^[0-9a-f]{40}$/i.test(parsed.ref.trim())) {
    return {
      pinnedRef: parsed.ref,
      trackingRef: parsed.explicitRef ? parsed.ref : null,
    };
  }

  const trackingRef = parsed.explicitRef
    ? parsed.ref
    : await resolveGitHubDefaultBranch(parsed.owner, parsed.repo, apiBase);
  const pinnedRef = await resolveGitHubCommitSha(parsed.owner, parsed.repo, trackingRef, apiBase);
  return { pinnedRef, trackingRef };
}


function extractCommandTokens(raw: string) {
  const matches = raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

export function parseSkillImportSourceInput(rawInput: string): ParsedSkillImportSource {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw unprocessable("Skill source is required.");
  }

  const warnings: string[] = [];
  let source = trimmed;
  let requestedSkillSlug: string | null = null;

  if (/^npx\s+skills\s+add\s+/i.test(trimmed)) {
    const tokens = extractCommandTokens(trimmed);
    const addIndex = tokens.findIndex(
      (token, index) =>
        token === "add"
        && index > 0
        && tokens[index - 1]?.toLowerCase() === "skills",
    );
    if (addIndex >= 0) {
      source = tokens[addIndex + 1] ?? "";
      for (let index = addIndex + 2; index < tokens.length; index += 1) {
        const token = tokens[index]!;
        if (token === "--skill") {
          requestedSkillSlug = normalizeSkillSlug(tokens[index + 1] ?? null);
          index += 1;
          continue;
        }
        if (token.startsWith("--skill=")) {
          requestedSkillSlug = normalizeSkillSlug(token.slice("--skill=".length));
        }
      }
    }
  }

  const normalizedSource = source.trim();
  if (!normalizedSource) {
    throw unprocessable("Skill source is required.");
  }

  // Key-style imports (org/repo/skill) originate from the skills.sh registry
  if (!/^https?:\/\//i.test(normalizedSource) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizedSource)) {
    const [owner, repo, skillSlugRaw] = normalizedSource.split("/");
    return {
      resolvedSource: `https://github.com/${owner}/${repo}`,
      requestedSkillSlug: normalizeSkillSlug(skillSlugRaw),
      originalSkillsShUrl: `https://skills.sh/${owner}/${repo}/${skillSlugRaw}`,
      warnings,
    };
  }

  if (!/^https?:\/\//i.test(normalizedSource) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizedSource)) {
    return {
      resolvedSource: `https://github.com/${normalizedSource}`,
      requestedSkillSlug,
      originalSkillsShUrl: null,
      warnings,
    };
  }

  // Detect skills.sh URLs and resolve to GitHub: https://skills.sh/org/repo/skill → org/repo/skill key
  const skillsShMatch = normalizedSource.match(/^https?:\/\/(?:www\.)?skills\.sh\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_.-]+))?(?:[?#].*)?$/i);
  if (skillsShMatch) {
    const [, owner, repo, skillSlugRaw] = skillsShMatch;
    return {
      resolvedSource: `https://github.com/${owner}/${repo}`,
      requestedSkillSlug: skillSlugRaw ? normalizeSkillSlug(skillSlugRaw) : requestedSkillSlug,
      originalSkillsShUrl: normalizedSource,
      warnings,
    };
  }

  return {
    resolvedSource: normalizedSource,
    requestedSkillSlug,
    originalSkillsShUrl: null,
    warnings,
  };
}

function resolveBundledSkillsRoot() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(moduleDir, "../../skills"),
    path.resolve(process.cwd(), "skills"),
    path.resolve(moduleDir, "../../../skills"),
  ];
}

function matchesRequestedSkill(relativeSkillPath: string, requestedSkillSlug: string | null) {
  if (!requestedSkillSlug) return true;
  const skillDir = path.posix.dirname(relativeSkillPath);
  return normalizeSkillSlug(path.posix.basename(skillDir)) === requestedSkillSlug;
}

function deriveImportedSkillSlug(frontmatter: Record<string, unknown>, fallback: string) {
  return normalizeSkillSlug(asString(frontmatter.slug))
    ?? normalizeSkillSlug(asString(frontmatter.name))
    ?? normalizeAgentUrlKey(fallback)
    ?? "skill";
}

function deriveImportedSkillSource(
  frontmatter: Record<string, unknown>,
  fallbackSlug: string,
): Pick<ImportedSkill, "sourceType" | "sourceLocator" | "sourceRef" | "metadata"> {
  const metadata = isPlainRecord(frontmatter.metadata) ? frontmatter.metadata : null;
  const canonicalKey = readCanonicalSkillKey(frontmatter, metadata);
  const rawSources = metadata && Array.isArray(metadata.sources) ? metadata.sources : [];
  const sourceEntry = rawSources.find((entry) => isPlainRecord(entry)) as Record<string, unknown> | undefined;
  const kind = asString(sourceEntry?.kind);

  if (kind === "github-dir" || kind === "github-file") {
    const repo = asString(sourceEntry?.repo);
    const repoPath = asString(sourceEntry?.path);
    const commit = asString(sourceEntry?.commit);
    const trackingRef = asString(sourceEntry?.trackingRef);
    const sourceHostname = asString(sourceEntry?.hostname) || "github.com";
    const url = asString(sourceEntry?.url)
      ?? (repo
        ? `https://${sourceHostname}/${repo}${repoPath ? `/tree/${trackingRef ?? commit ?? "main"}/${repoPath}` : ""}`
        : null);
    const [owner, repoName] = (repo ?? "").split("/");
    if (repo && owner && repoName) {
      return {
        sourceType: "github",
        sourceLocator: url,
        sourceRef: commit,
        metadata: {
          ...(canonicalKey ? { skillKey: canonicalKey } : {}),
          sourceKind: "github",
          ...(sourceHostname !== "github.com" ? { hostname: sourceHostname } : {}),
          owner,
          repo: repoName,
          ref: commit,
          trackingRef,
          repoSkillDir: repoPath ?? `skills/${fallbackSlug}`,
        },
      };
    }
  }

  if (kind === "url") {
    const url = asString(sourceEntry?.url) ?? asString(sourceEntry?.rawUrl);
    if (url) {
      return {
        sourceType: "url",
        sourceLocator: url,
        sourceRef: null,
        metadata: {
          ...(canonicalKey ? { skillKey: canonicalKey } : {}),
          sourceKind: "url",
        },
      };
    }
  }

  const catalogProvenance = readPortableCatalogProvenance(metadata, canonicalKey);
  if (catalogProvenance) {
    return {
      sourceType: "catalog",
      sourceLocator: null,
      sourceRef: catalogProvenance.sourceRef,
      metadata: catalogProvenance.metadata,
    };
  }

  return {
    sourceType: "catalog",
    sourceLocator: null,
    sourceRef: null,
    metadata: {
      ...(canonicalKey ? { skillKey: canonicalKey } : {}),
      sourceKind: "catalog",
    },
  };
}

function readInlineSkillImports(squadId: string, files: Record<string, string>): ImportedSkill[] {
  const normalizedFiles = normalizePackageFileMap(files);
  const skillPaths = Object.keys(normalizedFiles).filter(
    (entry) => path.posix.basename(entry).toLowerCase() === "skill.md",
  );
  const imports: ImportedSkill[] = [];

  for (const skillPath of skillPaths) {
    const dir = path.posix.dirname(skillPath);
    const skillDir = dir === "." ? "" : dir;
    const slugFallback = path.posix.basename(skillDir || path.posix.dirname(skillPath));
    const markdown = normalizedFiles[skillPath]!;
    const parsed = parseFrontmatterMarkdown(markdown);
    const slug = deriveImportedSkillSlug(parsed.frontmatter, slugFallback);
    const source = deriveImportedSkillSource(parsed.frontmatter, slug);
    const inventory = Object.keys(normalizedFiles)
      .filter((entry) => entry === skillPath || (skillDir ? entry.startsWith(`${skillDir}/`) : false))
      .map((entry) => {
        const relative = entry === skillPath ? "SKILL.md" : entry.slice(skillDir.length + 1);
        return {
          path: normalizePortablePath(relative),
          kind: classifyInventoryKind(relative),
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path));

    imports.push({
      key: "",
      slug,
      name: asString(parsed.frontmatter.name) ?? slug,
      description: asString(parsed.frontmatter.description),
      markdown,
      packageDir: skillDir,
      sourceType: source.sourceType,
      sourceLocator: source.sourceLocator,
      sourceRef: source.sourceRef,
      trustLevel: deriveTrustLevel(inventory),
      compatibility: "compatible",
      fileInventory: inventory,
      metadata: source.metadata,
    });
    imports[imports.length - 1]!.key = deriveCanonicalSkillKey(squadId, imports[imports.length - 1]!);
  }

  return imports;
}

async function walkLocalFiles(root: string, current: string, out: string[]) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkLocalFiles(root, absolutePath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(normalizePortablePath(path.relative(root, absolutePath)));
  }
}

async function statPath(targetPath: string) {
  return fs.stat(targetPath).catch(() => null);
}

async function collectLocalSkillInventory(
  skillDir: string,
  mode: LocalSkillInventoryMode = "full",
): Promise<SquadSkillFileInventoryEntry[]> {
  const skillFilePath = path.join(skillDir, "SKILL.md");
  const skillFileStat = await statPath(skillFilePath);
  if (!skillFileStat?.isFile()) {
    throw unprocessable(`No SKILL.md file was found in ${skillDir}.`);
  }

  const allFiles = new Set<string>(["SKILL.md"]);
  if (mode === "full") {
    const discoveredFiles: string[] = [];
    await walkLocalFiles(skillDir, skillDir, discoveredFiles);
    for (const relativePath of discoveredFiles) {
      allFiles.add(relativePath);
    }
  } else {
    for (const relativeDir of PROJECT_ROOT_SKILL_SUBDIRECTORIES) {
      const absoluteDir = path.join(skillDir, relativeDir);
      const dirStat = await statPath(absoluteDir);
      if (!dirStat?.isDirectory()) continue;
      const discoveredFiles: string[] = [];
      await walkLocalFiles(skillDir, absoluteDir, discoveredFiles);
      for (const relativePath of discoveredFiles) {
        allFiles.add(relativePath);
      }
    }
  }

  return Array.from(allFiles)
    .map((relativePath) => ({
      path: normalizePortablePath(relativePath),
      kind: classifyInventoryKind(relativePath),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function readLocalSkillImportFromDirectory(
  squadId: string,
  skillDir: string,
  options?: {
    inventoryMode?: LocalSkillInventoryMode;
    metadata?: Record<string, unknown> | null;
  },
): Promise<ImportedSkill> {
  const resolvedSkillDir = path.resolve(skillDir);
  const skillFilePath = path.join(resolvedSkillDir, "SKILL.md");
  const markdown = await fs.readFile(skillFilePath, "utf8");
  const parsed = parseFrontmatterMarkdown(markdown);
  const slug = deriveImportedSkillSlug(parsed.frontmatter, path.basename(resolvedSkillDir));
  const parsedMetadata = isPlainRecord(parsed.frontmatter.metadata) ? parsed.frontmatter.metadata : null;
  const skillKey = readCanonicalSkillKey(parsed.frontmatter, parsedMetadata);
  const metadata = {
    ...(skillKey ? { skillKey } : {}),
    ...(parsedMetadata ?? {}),
    sourceKind: "local_path",
    ...(options?.metadata ?? {}),
  };
  const inventory = await collectLocalSkillInventory(resolvedSkillDir, options?.inventoryMode ?? "full");

  return {
    key: deriveCanonicalSkillKey(squadId, {
      slug,
      sourceType: "local_path",
      sourceLocator: resolvedSkillDir,
      metadata,
    }),
    slug,
    name: asString(parsed.frontmatter.name) ?? slug,
    description: asString(parsed.frontmatter.description),
    markdown,
    packageDir: resolvedSkillDir,
    sourceType: "local_path",
    sourceLocator: resolvedSkillDir,
    sourceRef: null,
    trustLevel: deriveTrustLevel(inventory),
    compatibility: "compatible",
    fileInventory: inventory,
    metadata,
  };
}

export async function discoverProjectWorkspaceSkillDirectories(target: ProjectSkillScanTarget): Promise<Array<{
  skillDir: string;
  inventoryMode: LocalSkillInventoryMode;
}>> {
  const discovered = new Map<string, LocalSkillInventoryMode>();
  const rootSkillPath = path.join(target.workspaceCwd, "SKILL.md");
  if ((await statPath(rootSkillPath))?.isFile()) {
    discovered.set(path.resolve(target.workspaceCwd), "project_root");
  }

  for (const relativeRoot of PROJECT_SCAN_DIRECTORY_ROOTS) {
    const absoluteRoot = path.join(target.workspaceCwd, relativeRoot);
    const rootStat = await statPath(absoluteRoot);
    if (!rootStat?.isDirectory()) continue;

    const entries = await fs.readdir(absoluteRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const absoluteSkillDir = path.resolve(absoluteRoot, entry.name);
      if (!(await statPath(path.join(absoluteSkillDir, "SKILL.md")))?.isFile()) continue;
      discovered.set(absoluteSkillDir, "full");
    }
  }

  return Array.from(discovered.entries())
    .map(([skillDir, inventoryMode]) => ({ skillDir, inventoryMode }))
    .sort((left, right) => left.skillDir.localeCompare(right.skillDir));
}

async function readLocalSkillImports(squadId: string, sourcePath: string): Promise<ImportedSkill[]> {
  const resolvedPath = path.resolve(sourcePath);
  const stat = await fs.stat(resolvedPath).catch(() => null);
  if (!stat) {
    throw unprocessable(`Skill source path does not exist: ${sourcePath}`);
  }

  if (stat.isFile()) {
    const markdown = await fs.readFile(resolvedPath, "utf8");
    const parsed = parseFrontmatterMarkdown(markdown);
    const slug = deriveImportedSkillSlug(parsed.frontmatter, path.basename(path.dirname(resolvedPath)));
    const parsedMetadata = isPlainRecord(parsed.frontmatter.metadata) ? parsed.frontmatter.metadata : null;
    const skillKey = readCanonicalSkillKey(parsed.frontmatter, parsedMetadata);
    const metadata = {
      ...(skillKey ? { skillKey } : {}),
      ...(parsedMetadata ?? {}),
      sourceKind: "local_path",
    };
    const inventory: SquadSkillFileInventoryEntry[] = [
      { path: "SKILL.md", kind: "skill" },
    ];
    return [{
      key: deriveCanonicalSkillKey(squadId, {
        slug,
        sourceType: "local_path",
        sourceLocator: path.dirname(resolvedPath),
        metadata,
      }),
      slug,
      name: asString(parsed.frontmatter.name) ?? slug,
      description: asString(parsed.frontmatter.description),
      markdown,
      packageDir: path.dirname(resolvedPath),
      sourceType: "local_path",
      sourceLocator: path.dirname(resolvedPath),
      sourceRef: null,
      trustLevel: deriveTrustLevel(inventory),
      compatibility: "compatible",
      fileInventory: inventory,
      metadata,
    }];
  }

  const root = resolvedPath;
  const allFiles: string[] = [];
  await walkLocalFiles(root, root, allFiles);
  const skillPaths = allFiles.filter((entry) => path.posix.basename(entry).toLowerCase() === "skill.md");
  if (skillPaths.length === 0) {
    throw unprocessable("No SKILL.md files were found in the provided path.");
  }

  const imports: ImportedSkill[] = [];
  for (const skillPath of skillPaths) {
    const skillDir = path.posix.dirname(skillPath);
    const inventory = allFiles
      .filter((entry) => entry === skillPath || entry.startsWith(`${skillDir}/`))
      .map((entry) => {
        const relative = entry === skillPath ? "SKILL.md" : entry.slice(skillDir.length + 1);
        return {
          path: normalizePortablePath(relative),
          kind: classifyInventoryKind(relative),
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path));
    const imported = await readLocalSkillImportFromDirectory(squadId, path.join(root, skillDir));
    imported.fileInventory = inventory;
    imported.trustLevel = deriveTrustLevel(inventory);
    imports.push(imported);
  }

  return imports;
}

async function readUrlSkillImports(
  squadId: string,
  sourceUrl: string,
  requestedSkillSlug: string | null = null,
): Promise<{ skills: ImportedSkill[]; warnings: string[] }> {
  const url = sourceUrl.trim();
  const warnings: string[] = [];
  const looksLikeRepoUrl = (() => { try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const h = parsed.hostname.toLowerCase();
    if (h.endsWith(".githubusercontent.com") || h === "gist.github.com") return false;
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.length >= 2 && !parsed.pathname.endsWith(".md");
  } catch { return false; } })();
  if (looksLikeRepoUrl) {
    const parsed = parseGitHubSourceUrl(url);
    const apiBase = gitHubApiBase(parsed.hostname);
    const { pinnedRef, trackingRef } = await resolveGitHubPinnedRef(parsed);
    let ref = pinnedRef;
    const tree = await fetchJson<{ tree?: Array<{ path: string; type: string }> }>(
      `${apiBase}/repos/${parsed.owner}/${parsed.repo}/git/trees/${ref}?recursive=1`,
    ).catch(() => {
      throw unprocessable(`Failed to read GitHub tree for ${url}`);
    });
    const allPaths = (tree.tree ?? [])
      .filter((entry) => entry.type === "blob")
      .map((entry) => entry.path)
      .filter((entry): entry is string => typeof entry === "string");
    const basePrefix = parsed.basePath ? `${parsed.basePath.replace(/^\/+|\/+$/g, "")}/` : "";
    const scopedPaths = basePrefix
      ? allPaths.filter((entry) => entry.startsWith(basePrefix))
      : allPaths;
    const relativePaths = scopedPaths.map((entry) => basePrefix ? entry.slice(basePrefix.length) : entry);
    const filteredPaths = parsed.filePath
      ? relativePaths.filter((entry) => entry === path.posix.relative(parsed.basePath || ".", parsed.filePath!))
      : relativePaths;
    const skillPaths = filteredPaths.filter(
      (entry) => path.posix.basename(entry).toLowerCase() === "skill.md",
    );
    if (skillPaths.length === 0) {
      throw unprocessable(
        "No SKILL.md files were found in the provided GitHub source.",
      );
    }
    const skills: ImportedSkill[] = [];
    for (const relativeSkillPath of skillPaths) {
      const repoSkillPath = basePrefix ? `${basePrefix}${relativeSkillPath}` : relativeSkillPath;
      const markdown = await fetchText(resolveRawGitHubUrl(parsed.hostname, parsed.owner, parsed.repo, ref, repoSkillPath));
      const parsedMarkdown = parseFrontmatterMarkdown(markdown);
      const skillDir = path.posix.dirname(relativeSkillPath);
      const slug = deriveImportedSkillSlug(parsedMarkdown.frontmatter, path.posix.basename(skillDir));
      const skillKey = readCanonicalSkillKey(
        parsedMarkdown.frontmatter,
        isPlainRecord(parsedMarkdown.frontmatter.metadata) ? parsedMarkdown.frontmatter.metadata : null,
      );
      if (requestedSkillSlug && !matchesRequestedSkill(relativeSkillPath, requestedSkillSlug) && slug !== requestedSkillSlug) {
        continue;
      }
      const metadata = {
        ...(skillKey ? { skillKey } : {}),
        sourceKind: "github",
        ...(parsed.hostname !== "github.com" ? { hostname: parsed.hostname } : {}),
        owner: parsed.owner,
        repo: parsed.repo,
        ref,
        trackingRef,
        repoSkillDir: normalizeGitHubSkillDirectory(
          basePrefix ? `${basePrefix}${skillDir}` : skillDir,
          slug,
        ),
      };
      const inventory = filteredPaths
        .filter((entry) => entry === relativeSkillPath || entry.startsWith(`${skillDir}/`))
        .map((entry) => ({
          path: entry === relativeSkillPath ? "SKILL.md" : entry.slice(skillDir.length + 1),
          kind: classifyInventoryKind(entry === relativeSkillPath ? "SKILL.md" : entry.slice(skillDir.length + 1)),
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
      skills.push({
        key: deriveCanonicalSkillKey(squadId, {
          slug,
          sourceType: "github",
          sourceLocator: sourceUrl,
          metadata,
        }),
        slug,
        name: asString(parsedMarkdown.frontmatter.name) ?? slug,
        description: asString(parsedMarkdown.frontmatter.description),
        markdown,
        sourceType: "github",
        sourceLocator: sourceUrl,
        sourceRef: ref,
        trustLevel: deriveTrustLevel(inventory),
        compatibility: "compatible",
        fileInventory: inventory,
        metadata,
      });
    }
    if (skills.length === 0) {
      throw unprocessable(
        requestedSkillSlug
          ? `Skill ${requestedSkillSlug} was not found in the provided GitHub source.`
          : "No SKILL.md files were found in the provided GitHub source.",
      );
    }
    return { skills, warnings };
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    const markdown = await fetchText(url);
    const parsedMarkdown = parseFrontmatterMarkdown(markdown);
    const urlObj = new URL(url);
    const fileName = path.posix.basename(urlObj.pathname);
    const slug = deriveImportedSkillSlug(parsedMarkdown.frontmatter, fileName.replace(/\.md$/i, ""));
    const skillKey = readCanonicalSkillKey(
      parsedMarkdown.frontmatter,
      isPlainRecord(parsedMarkdown.frontmatter.metadata) ? parsedMarkdown.frontmatter.metadata : null,
    );
    const metadata = {
      ...(skillKey ? { skillKey } : {}),
      sourceKind: "url",
    };
    const inventory: SquadSkillFileInventoryEntry[] = [{ path: "SKILL.md", kind: "skill" }];
    return {
      skills: [{
        key: deriveCanonicalSkillKey(squadId, {
          slug,
          sourceType: "url",
          sourceLocator: url,
          metadata,
        }),
        slug,
        name: asString(parsedMarkdown.frontmatter.name) ?? slug,
        description: asString(parsedMarkdown.frontmatter.description),
        markdown,
        sourceType: "url",
        sourceLocator: url,
        sourceRef: null,
        trustLevel: deriveTrustLevel(inventory),
        compatibility: "compatible",
        fileInventory: inventory,
        metadata,
      }],
      warnings,
    };
  }

  throw unprocessable("Unsupported skill source. Use a local path or URL.");
}

function toSquadSkill(row: SquadSkillRow): SquadSkill {
  return {
    ...row,
    description: row.description ?? null,
    sourceType: row.sourceType as SquadSkillSourceType,
    sourceLocator: row.sourceLocator ?? null,
    sourceRef: row.sourceRef ?? null,
    trustLevel: row.trustLevel as SquadSkillTrustLevel,
    compatibility: row.compatibility as SquadSkillCompatibility,
    fileInventory: Array.isArray(row.fileInventory)
      ? row.fileInventory.flatMap((entry) => {
        if (!isPlainRecord(entry)) return [];
        return [{
          path: String(entry.path ?? ""),
          kind: (String(entry.kind ?? "other") as SquadSkillFileInventoryEntry["kind"]),
        }];
      })
      : [],
    metadata: isPlainRecord(row.metadata) ? row.metadata : null,
    isTowerManaged: row.isTowerManaged ?? false,
    towerSkillKey: row.towerSkillKey ?? null,
    towerSkillVersion: row.towerSkillVersion ?? null,
  };
}

function toSquadSkillListRow(row: SquadSkillListDbRow): SquadSkillListRow {
  return {
    ...row,
    description: row.description ?? null,
    sourceType: row.sourceType as SquadSkillSourceType,
    sourceLocator: row.sourceLocator ?? null,
    sourceRef: row.sourceRef ?? null,
    trustLevel: row.trustLevel as SquadSkillTrustLevel,
    compatibility: row.compatibility as SquadSkillCompatibility,
    fileInventory: Array.isArray(row.fileInventory)
      ? row.fileInventory.flatMap((entry) => {
        if (!isPlainRecord(entry)) return [];
        return [{
          path: String(entry.path ?? ""),
          kind: (String(entry.kind ?? "other") as SquadSkillFileInventoryEntry["kind"]),
        }];
      })
      : [],
    metadata: isPlainRecord(row.metadata) ? row.metadata : null,
  };
}

function serializeFileInventory(
  fileInventory: SquadSkillFileInventoryEntry[],
): Array<Record<string, unknown>> {
  return fileInventory.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
  }));
}

function getSkillMeta(skill: Pick<SquadSkill, "metadata">): SkillSourceMeta {
  return isPlainRecord(skill.metadata) ? skill.metadata as SkillSourceMeta : {};
}

function resolveCatalogSkillIfPresent(reference: string): CatalogSkill | null {
  const result = resolveCatalogSkillReference(reference);
  if (result.ambiguous) {
    throw conflict(`Catalog skill slug "${reference}" is ambiguous. Use an id or key.`);
  }
  return result.skill;
}

function getMissingSourceMarker(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!isPlainRecord(metadata)) return null;
  return isPlainRecord(metadata.missingSource) ? metadata.missingSource : null;
}

function buildMissingLocalSourceMarker(
  skill: Pick<SquadSkill, "sourceLocator" | "metadata">,
): SkillMissingSourceMarker {
  const existing = getMissingSourceMarker(skill.metadata);
  return {
    reason: "local_source_missing",
    sourceType: "local_path",
    sourceLocator: skill.sourceLocator ?? null,
    sourcePath: normalizeSourceLocatorDirectory(skill.sourceLocator),
    detectedAt: asString(existing?.detectedAt) ?? new Date().toISOString(),
  };
}

function withMissingSourceMarker(
  metadata: Record<string, unknown> | null,
  marker: SkillMissingSourceMarker,
) {
  return {
    ...(isPlainRecord(metadata) ? metadata : {}),
    missingSource: marker,
  };
}

function withoutMissingSourceMarker(metadata: Record<string, unknown> | null) {
  if (!isPlainRecord(metadata) || !isPlainRecord(metadata.missingSource)) return metadata;
  const next = { ...metadata };
  delete next.missingSource;
  return next;
}

function resolveSkillReference(
  skills: SkillReferenceTarget[],
  reference: string,
): { skill: SkillReferenceTarget | null; ambiguous: boolean } {
  const trimmed = reference.trim();
  if (!trimmed) {
    return { skill: null, ambiguous: false };
  }

  const byId = skills.find((skill) => skill.id === trimmed);
  if (byId) {
    return { skill: byId, ambiguous: false };
  }

  const normalizedKey = normalizeSkillKey(trimmed);
  if (normalizedKey) {
    const byKey = skills.find((skill) => skill.key === normalizedKey);
    if (byKey) {
      return { skill: byKey, ambiguous: false };
    }
  }

  const normalizedSlug = normalizeSkillSlug(trimmed);
  if (!normalizedSlug) {
    return { skill: null, ambiguous: false };
  }

  const bySlug = skills.filter((skill) => skill.slug === normalizedSlug);
  if (bySlug.length === 1) {
    return { skill: bySlug[0] ?? null, ambiguous: false };
  }
  if (bySlug.length > 1) {
    return { skill: null, ambiguous: true };
  }

  return { skill: null, ambiguous: false };
}

function resolveRequestedSkillKeysOrThrow(
  skills: SquadSkill[],
  requestedReferences: string[],
) {
  const missing = new Set<string>();
  const ambiguous = new Set<string>();
  const resolved = new Set<string>();

  for (const reference of requestedReferences) {
    const trimmed = reference.trim();
    if (!trimmed) continue;

    const match = resolveSkillReference(skills, trimmed);
    if (match.skill) {
      resolved.add(match.skill.key);
      continue;
    }

    if (match.ambiguous) {
      ambiguous.add(trimmed);
      continue;
    }

    missing.add(trimmed);
  }

  if (ambiguous.size > 0 || missing.size > 0) {
    const problems: string[] = [];
    if (ambiguous.size > 0) {
      problems.push(`ambiguous references: ${Array.from(ambiguous).sort().join(", ")}`);
    }
    if (missing.size > 0) {
      problems.push(`unknown references: ${Array.from(missing).sort().join(", ")}`);
    }
    throw unprocessable(`Invalid squad skill selection (${problems.join("; ")}).`);
  }

  return Array.from(resolved);
}

function resolveDesiredSkillKeys(
  skills: SkillReferenceTarget[],
  config: Record<string, unknown>,
) {
  const preference = readSlawSkillSyncPreference(config);
  return Array.from(new Set(
    preference.desiredSkills
      .map((reference) => resolveSkillReference(skills, reference).skill?.key ?? normalizeSkillKey(reference))
      .filter((value): value is string => Boolean(value)),
  ));
}

function normalizeSkillDirectory(skill: SkillSourceInfoTarget) {
  if ((skill.sourceType !== "local_path" && skill.sourceType !== "catalog") || !skill.sourceLocator) return null;
  const resolved = path.resolve(skill.sourceLocator);
  if (path.basename(resolved).toLowerCase() === "skill.md") {
    return path.dirname(resolved);
  }
  return resolved;
}

function normalizeSourceLocatorDirectory(sourceLocator: string | null) {
  if (!sourceLocator) return null;
  const resolved = path.resolve(sourceLocator);
  return path.basename(resolved).toLowerCase() === "skill.md" ? path.dirname(resolved) : resolved;
}

async function resolveExistingSkillDirectory(skillDir: string | null) {
  if (!skillDir) return null;
  const dirStat = await statPath(skillDir);
  const skillFileStat = await statPath(path.join(skillDir, "SKILL.md"));
  return dirStat?.isDirectory() && skillFileStat?.isFile() ? skillDir : null;
}

function buildMissingRuntimeSourceDetail(skill: Pick<SquadSkill, "name" | "sourceLocator" | "metadata">) {
  const marker = getMissingSourceMarker(skill.metadata);
  const sourcePath = asString(marker?.sourcePath) ?? normalizeSourceLocatorDirectory(skill.sourceLocator);
  if (sourcePath) {
    return `Squad skill "${skill.name}" is in the library, but Slaw cannot find its local source at ${sourcePath}.`;
  }
  return `Squad skill "${skill.name}" is in the library, but Slaw cannot find a valid local runtime source for it.`;
}

export async function findMissingLocalSkillIds(
  skills: Array<Pick<SquadSkill, "id" | "sourceType" | "sourceLocator">>,
) {
  const missingIds: string[] = [];

  for (const skill of skills) {
    if (skill.sourceType !== "local_path") continue;
    const skillDir = normalizeSourceLocatorDirectory(skill.sourceLocator);
    if (!skillDir) {
      missingIds.push(skill.id);
      continue;
    }

    const skillDirStat = await statPath(skillDir);
    const skillFileStat = await statPath(path.join(skillDir, "SKILL.md"));
    if (!skillDirStat?.isDirectory() || !skillFileStat?.isFile()) {
      missingIds.push(skill.id);
    }
  }

  return missingIds;
}

function resolveManagedSkillsRoot(squadId: string) {
  return path.resolve(resolveSlawInstanceRoot(), "skills", squadId);
}

function resolveLocalSkillFilePath(skill: SquadSkill, relativePath: string) {
  const normalized = normalizePortablePath(relativePath);
  const skillDir = normalizeSkillDirectory(skill);
  if (skillDir) {
    return path.resolve(skillDir, normalized);
  }

  if (!skill.sourceLocator) return null;
  const fallbackRoot = path.resolve(skill.sourceLocator);
  const directPath = path.resolve(fallbackRoot, normalized);
  return directPath;
}

async function collectSkillFileBytes(skillDir: string): Promise<{
  files: Array<{ path: string; bytes: Buffer; sizeBytes: number; kind: SquadSkillFileInventoryEntry["kind"] }>;
  findings: SquadSkillAuditFinding[];
}> {
  const files: Array<{ path: string; bytes: Buffer; sizeBytes: number; kind: SquadSkillFileInventoryEntry["kind"] }> = [];
  const findings: SquadSkillAuditFinding[] = [];
  const root = path.resolve(skillDir);

  async function visit(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.resolve(current, entry.name);
      const relativePath = normalizePortablePath(path.relative(root, absolutePath));
      if (!relativePath || relativePath.split("/").includes("..") || path.isAbsolute(relativePath)) {
        findings.push({
          code: "path_out_of_tree",
          severity: "error",
          message: "Resolved file path is outside the skill directory.",
          path: relativePath || null,
        });
        continue;
      }

      const lstat = await fs.lstat(absolutePath).catch(() => null);
      if (!lstat) continue;
      if (lstat.isSymbolicLink()) {
        findings.push({
          code: "symlink",
          severity: "error",
          message: "Skill files must not be symlinks.",
          path: relativePath,
        });
        continue;
      }
      if (lstat.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!lstat.isFile()) continue;
      const bytes = await fs.readFile(absolutePath);
      files.push({
        path: relativePath,
        bytes,
        sizeBytes: lstat.size,
        kind: classifyInventoryKind(relativePath),
      });
    }
  }

  await visit(root);
  files.sort((left, right) => {
    if (left.path === "SKILL.md") return -1;
    if (right.path === "SKILL.md") return 1;
    return left.path.localeCompare(right.path);
  });
  return { files, findings };
}

function contentLooksBinary(bytes: Buffer) {
  if (bytes.includes(0)) return true;
  const text = bytes.toString("utf8");
  return text.includes("\uFFFD");
}

function extractMarkdownLinks(markdown: string) {
  const links: string[] = [];
  const regex = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const link = match[1]?.trim();
    if (link) links.push(link);
  }
  return links;
}

function pushFinding(
  findings: SquadSkillAuditFinding[],
  code: string,
  severity: SquadSkillAuditFinding["severity"],
  message: string,
  filePath: string | null,
) {
  findings.push({ code, severity, message, path: filePath });
}

async function auditInstalledSkillBytes(skill: SquadSkill): Promise<SquadSkillAuditResult> {
  const skillDir = normalizeSkillDirectory(skill);
  const scannedAt = new Date().toISOString();
  const originHash = asString(getSkillMeta(skill).originHash);
  if (!skillDir) {
    return {
      skillId: skill.id,
      installedHash: null,
      originHash,
      verdict: "fail",
      codes: ["origin_unavailable"],
      findings: [{
        code: "origin_unavailable",
        severity: "error",
        message: "Skill files are not available on disk for audit.",
        path: null,
      }],
      scannedAt,
      scanVersion: SKILL_AUDIT_SCAN_VERSION,
    };
  }

  const { files, findings } = await collectSkillFileBytes(skillDir);
  const actualPaths = files.map((file) => file.path).sort((left, right) => left.localeCompare(right));
  const expectedPaths = skill.fileInventory.map((entry) => normalizePortablePath(entry.path)).sort((left, right) => left.localeCompare(right));
  const installedHash = buildInventoryContentHash(files.map((file) => ({
    path: file.path,
    sha256: sha256Buffer(file.bytes),
  })));

  if (!actualPaths.includes("SKILL.md")) {
    pushFinding(findings, "missing_skill_md", "error", "Skill inventory does not contain SKILL.md.", "SKILL.md");
  }

  const actualSet = new Set(actualPaths);
  const expectedSet = new Set(expectedPaths);
  for (const expected of expectedPaths) {
    if (!actualSet.has(expected)) {
      if (expected === "SKILL.md") continue;
      pushFinding(findings, "inventory_mismatch", "error", "Expected inventory file is missing on disk.", expected);
    }
  }
  for (const actual of actualPaths) {
    if (!expectedSet.has(actual)) {
      pushFinding(findings, "inventory_mismatch", "error", "Installed file is not present in recorded inventory.", actual);
    }
  }

  const fileMap = new Map(files.map((file) => [file.path, file]));
  const skillFile = fileMap.get("SKILL.md");
  if (skillFile) {
    const markdown = skillFile.bytes.toString("utf8");
    const parsed = parseFrontmatterMarkdown(markdown);
    if (!markdown.startsWith("---\n") || !asString(parsed.frontmatter.name)) {
      pushFinding(findings, "invalid_frontmatter", "error", "SKILL.md must contain valid frontmatter with a name.", "SKILL.md");
    }
  }

  const remoteExecPattern = /\b(?:curl|wget)\b[\s\S]{0,160}\|\s*(?:sh|bash)|\b(?:bash|sh)\s+-c\b|\beval\b|\bpython\s+-c\b|\bnode\s+-e\b/i;
  const secretExfilPattern = /\b(?:cat|printenv|env|grep)\b[\s\S]{0,160}(?:\.aws\/credentials|\.ssh\/|\.npmrc|id_rsa|OPENAI_API_KEY|ANTHROPIC_API_KEY|API_KEY|TOKEN|SECRET)[\s\S]{0,160}\b(?:curl|wget|nc|netcat|scp)\b/i;
  const networkPattern = /\b(?:curl|wget|fetch|httpie|nc|netcat|scp|ssh)\b|https?:\/\//i;
  const secretReferencePattern = /\b(?:process\.env|printenv|\$[A-Z][A-Z0-9_]{2,}|API_KEY|TOKEN|SECRET|PASSWORD|\.env)\b/i;

  for (const file of files) {
    if (file.sizeBytes > MAX_CATALOG_FILE_BYTES) {
      pushFinding(findings, "oversized_file", "error", `Skill file exceeds ${MAX_CATALOG_FILE_BYTES} bytes.`, file.path);
    }
    if (file.kind !== "asset" && contentLooksBinary(file.bytes)) {
      pushFinding(findings, "non_text_file", "error", "Non-asset skill files must be UTF-8 text.", file.path);
      continue;
    }
    if (file.kind === "asset" || file.kind === "script" || file.kind === "other") {
      pushFinding(findings, `${file.kind}_trust`, "warning", `Skill includes a ${file.kind} file.`, file.path);
    }
    if (file.kind === "asset") continue;

    const text = file.bytes.toString("utf8");
    if (remoteExecPattern.test(text)) {
      pushFinding(findings, "remote_fetch_exec", "error", "Remote-fetch or dynamic execution pattern is not allowed.", file.path);
    }
    if (secretExfilPattern.test(text)) {
      pushFinding(findings, "secret_exfiltration", "error", "Secret exfiltration pattern is not allowed.", file.path);
    }
    if (networkPattern.test(text)) {
      pushFinding(findings, "network_reference", "warning", "Skill content references network-capable commands or URLs.", file.path);
    }
    if (secretReferencePattern.test(text)) {
      pushFinding(findings, "secret_reference", "warning", "Skill content references environment variables or secret-like values.", file.path);
    }
    if (isMarkdownPath(file.path)) {
      for (const link of extractMarkdownLinks(text)) {
        if (/^(?:https?:|mailto:|#)/i.test(link)) continue;
        const linkTarget = normalizePortablePath(path.posix.join(path.posix.dirname(file.path), link.split("#")[0] ?? ""));
        if (linkTarget && !actualSet.has(linkTarget)) {
          pushFinding(findings, "broken_internal_link", "warning", `Markdown link target is missing: ${link}`, file.path);
        }
      }
    }
  }

  if (originHash && installedHash !== originHash) {
    pushFinding(findings, "local_modifications", "warning", "Installed catalog bytes differ from the pinned origin hash.", null);
  }

  findings.sort((left, right) => `${left.severity}:${left.code}:${left.path ?? ""}`.localeCompare(`${right.severity}:${right.code}:${right.path ?? ""}`));
  const verdict: SquadSkillAuditVerdict = findings.some((finding) => finding.severity === "error")
    ? "fail"
    : findings.length > 0 ? "warning" : "pass";
  return {
    skillId: skill.id,
    installedHash,
    originHash,
    verdict,
    codes: Array.from(new Set(findings.map((finding) => finding.code))).sort(),
    findings,
    scannedAt,
    scanVersion: SKILL_AUDIT_SCAN_VERSION,
  };
}

function inferLanguageFromPath(filePath: string) {
  const fileName = path.posix.basename(filePath).toLowerCase();
  if (fileName === "skill.md" || fileName.endsWith(".md")) return "markdown";
  if (fileName.endsWith(".ts")) return "typescript";
  if (fileName.endsWith(".tsx")) return "tsx";
  if (fileName.endsWith(".js")) return "javascript";
  if (fileName.endsWith(".jsx")) return "jsx";
  if (fileName.endsWith(".json")) return "json";
  if (fileName.endsWith(".yml") || fileName.endsWith(".yaml")) return "yaml";
  if (fileName.endsWith(".sh")) return "bash";
  if (fileName.endsWith(".py")) return "python";
  if (fileName.endsWith(".html")) return "html";
  if (fileName.endsWith(".css")) return "css";
  return null;
}

function isMarkdownPath(filePath: string) {
  const fileName = path.posix.basename(filePath).toLowerCase();
  return fileName === "skill.md" || fileName.endsWith(".md");
}

function deriveSkillSourceInfo(skill: SkillSourceInfoTarget): {
  editable: boolean;
  editableReason: string | null;
  sourceLabel: string | null;
  sourceBadge: SquadSkillSourceBadge;
  sourcePath: string | null;
} {
  const metadata = getSkillMeta(skill);
  const localSkillDir = normalizeSkillDirectory(skill);
  if (metadata.sourceKind === "slaw_bundled") {
    return {
      editable: false,
      editableReason: "Bundled Slaw skills are read-only.",
      sourceLabel: "Slaw bundled",
      sourceBadge: "slaw",
      sourcePath: null,
    };
  }

  if (skill.sourceType === "botfather") {
    const version = skill.towerSkillVersion ?? null;
    return {
      editable: false,
      editableReason: "Skills are managed by your control tower and are read-only here.",
      sourceLabel: version ? `Control tower · v${version}` : "Control tower",
      sourceBadge: "botfather",
      sourcePath: null,
    };
  }

  if (skill.sourceType === "skills_sh") {
    const owner = asString(metadata.owner) ?? null;
    const repo = asString(metadata.repo) ?? null;
    return {
      editable: false,
      editableReason: "Skills.sh-managed skills are read-only.",
      sourceLabel: skill.sourceLocator ?? (owner && repo ? `${owner}/${repo}` : null),
      sourceBadge: "skills_sh",
      sourcePath: null,
    };
  }

  if (skill.sourceType === "github") {
    const owner = asString(metadata.owner) ?? null;
    const repo = asString(metadata.repo) ?? null;
    return {
      editable: false,
      editableReason: "Remote GitHub skills are read-only. Fork or import locally to edit them.",
      sourceLabel: owner && repo ? `${owner}/${repo}` : skill.sourceLocator,
      sourceBadge: "github",
      sourcePath: null,
    };
  }

  if (skill.sourceType === "url") {
    return {
      editable: false,
      editableReason: "URL-based skills are read-only. Save them locally to edit them.",
      sourceLabel: skill.sourceLocator,
      sourceBadge: "url",
      sourcePath: null,
    };
  }

  if (skill.sourceType === "local_path") {
    const managedRoot = resolveManagedSkillsRoot(skill.squadId);
    const projectName = asString(metadata.projectName);
    const workspaceName = asString(metadata.workspaceName);
    const isProjectScan = metadata.sourceKind === "project_scan";
    if (localSkillDir && localSkillDir.startsWith(managedRoot)) {
      return {
        editable: true,
        editableReason: null,
        sourceLabel: "Slaw workspace",
        sourceBadge: "slaw",
        sourcePath: managedRoot,
      };
    }

    return {
      editable: true,
      editableReason: null,
      sourceLabel: isProjectScan
        ? [projectName, workspaceName].filter((value): value is string => Boolean(value)).join(" / ")
          || skill.sourceLocator
        : skill.sourceLocator,
      sourceBadge: "local",
      sourcePath: null,
    };
  }

  return {
    editable: false,
    editableReason: "This skill source is read-only.",
    sourceLabel: skill.sourceLocator,
    sourceBadge: "catalog",
    sourcePath: null,
  };
}

function enrichSkill(skill: SquadSkill, attachedAgentCount: number, usedByAgents: SquadSkillUsageAgent[] = []) {
  const source = deriveSkillSourceInfo(skill);
  return {
    ...skill,
    attachedAgentCount,
    usedByAgents,
    ...source,
  };
}

function toSquadSkillListItem(skill: SquadSkillListRow, attachedAgentCount: number): SquadSkillListItem {
  const source = deriveSkillSourceInfo(skill);
  const metadata = getSkillMeta(skill);
  const catalogKind = skill.sourceType === "catalog" && (metadata.catalogKind === "bundled" || metadata.catalogKind === "optional")
    ? metadata.catalogKind
    : null;
  const originHash = skill.sourceType === "catalog" ? asString(metadata.originHash) : null;
  const packageName = skill.sourceType === "catalog" ? asString(metadata.packageName) : null;
  const packageVersion = skill.sourceType === "catalog" ? asString(metadata.packageVersion) : null;
  return {
    id: skill.id,
    squadId: skill.squadId,
    key: skill.key,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    sourceType: skill.sourceType,
    sourceLocator: skill.sourceLocator,
    sourceRef: skill.sourceRef,
    trustLevel: skill.trustLevel,
    compatibility: skill.compatibility,
    fileInventory: skill.fileInventory,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    attachedAgentCount,
    editable: source.editable,
    editableReason: source.editableReason,
    sourceLabel: source.sourceLabel,
    sourceBadge: source.sourceBadge,
    sourcePath: source.sourcePath,
    catalogKind,
    originHash,
    packageName,
    packageVersion,
  };
}

export function squadSkillService(db: Db) {
  const agents = agentService(db);
  const projects = projectService(db);

  async function ensureBundledSkills(squadId: string) {
    for (const skillsRoot of resolveBundledSkillsRoot()) {
      const stats = await fs.stat(skillsRoot).catch(() => null);
      if (!stats?.isDirectory()) continue;
      const bundledSkills = await readLocalSkillImports(squadId, skillsRoot)
        .then((skills) => skills.map((skill) => ({
          ...skill,
          key: deriveCanonicalSkillKey(squadId, {
            ...skill,
            metadata: {
              ...(skill.metadata ?? {}),
              sourceKind: "slaw_bundled",
            },
          }),
          metadata: {
            ...(skill.metadata ?? {}),
            sourceKind: "slaw_bundled",
          },
        })))
        .catch(() => [] as ImportedSkill[]);
      if (bundledSkills.length === 0) continue;
      return upsertImportedSkills(squadId, bundledSkills);
    }
    return [];
  }

  async function reconcileLocalPathSkillSources(squadId: string) {
    const rows = await db
      .select({
        id: squadSkills.id,
        key: squadSkills.key,
        slug: squadSkills.slug,
        sourceType: squadSkills.sourceType,
        sourceLocator: squadSkills.sourceLocator,
        metadata: squadSkills.metadata,
      })
      .from(squadSkills)
      .where(eq(squadSkills.squadId, squadId));
    const skills = rows.map((row) => ({
      ...row,
      sourceType: row.sourceType as SquadSkillSourceType,
      metadata: isPlainRecord(row.metadata) ? row.metadata : null,
    }));
    const missingIds = new Set(await findMissingLocalSkillIds(skills));

    for (const skill of skills) {
      if (skill.sourceType !== "local_path") continue;

      if (!missingIds.has(skill.id)) {
        if (getMissingSourceMarker(skill.metadata)) {
          await db
            .update(squadSkills)
            .set({
              metadata: withoutMissingSourceMarker(skill.metadata),
              updatedAt: new Date(),
            })
            .where(eq(squadSkills.id, skill.id));
        }
        continue;
      }

      const usedByAgents = await usage(squadId, skill.key);
      if (usedByAgents.length > 0) {
        const metadata = withMissingSourceMarker(
          skill.metadata,
          buildMissingLocalSourceMarker(skill),
        );
        if (JSON.stringify(metadata) !== JSON.stringify(skill.metadata ?? {})) {
          await db
            .update(squadSkills)
            .set({ metadata, updatedAt: new Date() })
            .where(eq(squadSkills.id, skill.id));
        }
        continue;
      }

      await db
        .delete(squadSkills)
        .where(eq(squadSkills.id, skill.id));
      await fs.rm(resolveRuntimeSkillMaterializedPath(squadId, skill), { recursive: true, force: true });
    }
  }

  async function ensureSkillInventoryCurrent(squadId: string) {
    const existingRefresh = skillInventoryRefreshPromises.get(squadId);
    if (existingRefresh) {
      await existingRefresh;
      return;
    }

    const refreshPromise = (async () => {
      const squadExists = await db
        .select({ id: squads.id })
        .from(squads)
        .where(eq(squads.id, squadId))
        .then((rows) => rows.length > 0);
      if (!squadExists) {
        throw notFound("Squad not found");
      }
      await ensureBundledSkills(squadId);
      await reconcileLocalPathSkillSources(squadId);
    })();

    skillInventoryRefreshPromises.set(squadId, refreshPromise);
    try {
      await refreshPromise;
    } finally {
      if (skillInventoryRefreshPromises.get(squadId) === refreshPromise) {
        skillInventoryRefreshPromises.delete(squadId);
      }
    }
  }

  async function list(squadId: string): Promise<SquadSkillListItem[]> {
    await ensureSkillInventoryCurrent(squadId);
    const rows = await db
      .select({
        id: squadSkills.id,
        squadId: squadSkills.squadId,
        key: squadSkills.key,
        slug: squadSkills.slug,
        name: squadSkills.name,
        description: squadSkills.description,
        sourceType: squadSkills.sourceType,
        sourceLocator: squadSkills.sourceLocator,
        sourceRef: squadSkills.sourceRef,
        trustLevel: squadSkills.trustLevel,
        compatibility: squadSkills.compatibility,
        fileInventory: squadSkills.fileInventory,
        metadata: squadSkills.metadata,
        createdAt: squadSkills.createdAt,
        updatedAt: squadSkills.updatedAt,
      })
      .from(squadSkills)
      .where(eq(squadSkills.squadId, squadId))
      .orderBy(asc(squadSkills.name), asc(squadSkills.key))
      .then((entries) => entries.map((entry) => toSquadSkillListRow(entry as SquadSkillListDbRow)));
    const agentRows = await agents.list(squadId);
    return rows.map((skill) => {
      const attachedAgentCount = agentRows.filter((agent) => {
        const desiredSkills = resolveDesiredSkillKeys(rows, agent.adapterConfig as Record<string, unknown>);
        return desiredSkills.includes(skill.key);
      }).length;
      return toSquadSkillListItem(skill, attachedAgentCount);
    });
  }

  async function listFull(squadId: string): Promise<SquadSkill[]> {
    await ensureSkillInventoryCurrent(squadId);
    const rows = await db
      .select(selectSquadSkillColumns())
      .from(squadSkills)
      .where(eq(squadSkills.squadId, squadId))
      .orderBy(asc(squadSkills.name), asc(squadSkills.key));
    return rows.map((row) => toSquadSkill(row));
  }

  async function listReferenceTargets(squadId: string): Promise<SkillReferenceTarget[]> {
    const rows = await db
      .select({
        id: squadSkills.id,
        key: squadSkills.key,
        slug: squadSkills.slug,
      })
      .from(squadSkills)
      .where(eq(squadSkills.squadId, squadId));
    return rows as SquadSkillReferenceRow[];
  }

  async function getById(squadId: string, id: string) {
    const row = await db
      .select(selectSquadSkillColumns())
      .from(squadSkills)
      .where(and(eq(squadSkills.squadId, squadId), eq(squadSkills.id, id)))
      .then((rows) => rows[0] ?? null);
    return row ? toSquadSkill(row) : null;
  }

  async function getByKey(squadId: string, key: string) {
    const row = await db
      .select(selectSquadSkillColumns())
      .from(squadSkills)
      .where(and(eq(squadSkills.squadId, squadId), eq(squadSkills.key, key)))
      .then((rows) => rows[0] ?? null);
    return row ? toSquadSkill(row) : null;
  }

  async function updateSkillMetadata(
    skill: SquadSkill,
    metadataPatch: Record<string, unknown>,
  ): Promise<SquadSkill> {
    const metadata = {
      ...(isPlainRecord(skill.metadata) ? skill.metadata : {}),
      ...metadataPatch,
    };
    const row = await db
      .update(squadSkills)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(squadSkills.id, skill.id))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Skill not found");
    return toSquadSkill(row);
  }

  async function persistAuditMetadata(skill: SquadSkill, audit: SquadSkillAuditResult): Promise<SquadSkill> {
    const userModifiedAt = audit.originHash && audit.installedHash !== audit.originHash
      ? asString(getSkillMeta(skill).userModifiedAt) ?? audit.scannedAt
      : null;
    const updateHoldReason: SquadSkillUpdateHoldReason | null = audit.verdict === "fail"
      ? "audit_hard_stop"
      : userModifiedAt ? "local_modifications" : null;
    return updateSkillMetadata(skill, {
      installedHash: audit.installedHash,
      userModifiedAt,
      updateHoldReason,
      auditVerdict: audit.verdict,
      auditCodes: audit.codes,
      auditScannedAt: audit.scannedAt,
      auditScanVersion: audit.scanVersion,
    });
  }

  async function auditSkill(squadId: string, skillId: string): Promise<SquadSkillAuditResult | null> {
    await ensureSkillInventoryCurrent(squadId);
    const skill = await getById(squadId, skillId);
    if (!skill) return null;
    if (skill.sourceType !== "catalog" && skill.sourceType !== "local_path") {
      throw unprocessable("Only local-path and catalog-managed squad skills support audit.");
    }
    const audit = await auditInstalledSkillBytes(skill);
    await persistAuditMetadata(skill, audit);
    return audit;
  }

  async function usage(squadId: string, key: string): Promise<SquadSkillUsageAgent[]> {
    const skills = await listReferenceTargets(squadId);
    const agentRows = await agents.list(squadId);
    const desiredAgents = agentRows.filter((agent) => {
      const desiredSkills = resolveDesiredSkillKeys(skills, agent.adapterConfig as Record<string, unknown>);
      return desiredSkills.includes(key);
    });

    return desiredAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      urlKey: agent.urlKey,
      adapterType: agent.adapterType,
      desired: true,
      // Runtime adapter state is intentionally omitted from this bounded metadata read.
      actualState: null,
    }));
  }

  async function detail(squadId: string, id: string): Promise<SquadSkillDetail | null> {
    await ensureSkillInventoryCurrent(squadId);
    const skill = await getById(squadId, id);
    if (!skill) return null;
    const usedByAgents = await usage(squadId, skill.key);
    return enrichSkill(skill, usedByAgents.length, usedByAgents);
  }

  async function updateStatus(squadId: string, skillId: string): Promise<SquadSkillUpdateStatus | null> {
    await ensureSkillInventoryCurrent(squadId);
    const skill = await getById(squadId, skillId);
    if (!skill) return null;
    const audit = skill.sourceType === "catalog" || skill.sourceType === "local_path"
      ? await auditInstalledSkillBytes(skill)
      : null;
    const metadata = getSkillMeta(skill);
    const statusMeta = {
      installedHash: audit?.installedHash ?? asString(metadata.installedHash),
      originHash: audit?.originHash ?? asString(metadata.originHash),
      userModifiedAt: audit && audit.originHash && audit.installedHash !== audit.originHash
        ? asString(metadata.userModifiedAt) ?? audit.scannedAt
        : audit && audit.originHash
          ? null
        : asString(metadata.userModifiedAt),
      updateHoldReason: (audit?.verdict === "fail"
        ? "audit_hard_stop"
        : audit && audit.originHash && audit.installedHash !== audit.originHash
          ? "local_modifications"
          : audit && audit.originHash
            ? null
          : asString(metadata.updateHoldReason)) as SquadSkillUpdateHoldReason | null,
      auditVerdict: audit?.verdict ?? (asString(metadata.auditVerdict) as SquadSkillAuditVerdict | null),
      auditCodes: audit?.codes ?? (Array.isArray(metadata.auditCodes) ? metadata.auditCodes.map(String) : []),
    };

    if (skill.sourceType === "catalog") {
      const catalogId = asString(metadata.catalogId);
      if (!catalogId) {
        return {
          supported: false,
          reason: "This catalog skill does not have enough metadata to track updates.",
          trackingRef: null,
          currentRef: skill.sourceRef ?? statusMeta.originHash,
          latestRef: null,
          hasUpdate: false,
          ...statusMeta,
        };
      }
      const catalogSkill = resolveCatalogSkillIfPresent(catalogId);
      if (!catalogSkill) {
        return {
          supported: false,
          reason: "Catalog entry is no longer available in the shipped manifest.",
          trackingRef: catalogId,
          currentRef: skill.sourceRef ?? statusMeta.originHash,
          latestRef: null,
          hasUpdate: false,
          ...statusMeta,
        };
      }
      return {
        supported: true,
        reason: null,
        trackingRef: catalogSkill.id,
        currentRef: skill.sourceRef ?? statusMeta.originHash,
        latestRef: catalogSkill.contentHash,
        hasUpdate: catalogSkill.contentHash !== (skill.sourceRef ?? statusMeta.originHash),
        ...statusMeta,
      };
    }

    if (skill.sourceType !== "github" && skill.sourceType !== "skills_sh") {
      return {
        supported: false,
        reason: "Only GitHub-managed skills support update checks.",
        trackingRef: null,
        currentRef: skill.sourceRef ?? null,
        latestRef: null,
        hasUpdate: false,
        ...statusMeta,
      };
    }

    const owner = asString(metadata.owner);
    const repo = asString(metadata.repo);
    const trackingRef = asString(metadata.trackingRef) ?? asString(metadata.ref);
    if (!owner || !repo || !trackingRef) {
      return {
        supported: false,
        reason: "This GitHub skill does not have enough metadata to track updates.",
        trackingRef: trackingRef ?? null,
        currentRef: skill.sourceRef ?? null,
        latestRef: null,
        hasUpdate: false,
        ...statusMeta,
      };
    }

    const hostname = asString(metadata.hostname) || "github.com";
    const apiBase = gitHubApiBase(hostname);
    const latestRef = await resolveGitHubCommitSha(owner, repo, trackingRef, apiBase);
    return {
      supported: true,
      reason: null,
      trackingRef,
      currentRef: skill.sourceRef ?? null,
      latestRef,
      hasUpdate: latestRef !== (skill.sourceRef ?? null),
      ...statusMeta,
    };
  }

  async function readFile(squadId: string, skillId: string, relativePath: string): Promise<SquadSkillFileDetail | null> {
    await ensureSkillInventoryCurrent(squadId);
    const skill = await getById(squadId, skillId);
    if (!skill) return null;

    const normalizedPath = normalizePortablePath(relativePath || "SKILL.md");
    const fileEntry = skill.fileInventory.find((entry) => entry.path === normalizedPath);
    if (!fileEntry) {
      throw notFound("Skill file not found");
    }

    const source = deriveSkillSourceInfo(skill);
    let content = "";

    if (skill.sourceType === "local_path" || skill.sourceType === "catalog") {
      const absolutePath = resolveLocalSkillFilePath(skill, normalizedPath);
      if (absolutePath) {
        content = await fs.readFile(absolutePath, "utf8");
      } else if (normalizedPath === "SKILL.md") {
        content = skill.markdown;
      } else {
        throw notFound("Skill file not found");
      }
    } else if (skill.sourceType === "github" || skill.sourceType === "skills_sh") {
      const metadata = getSkillMeta(skill);
      const owner = asString(metadata.owner);
      const repo = asString(metadata.repo);
      const hostname = asString(metadata.hostname) || "github.com";
      const ref = skill.sourceRef ?? asString(metadata.ref) ?? "main";
      const repoSkillDir = normalizeGitHubSkillDirectory(asString(metadata.repoSkillDir), skill.slug);
      if (!owner || !repo) {
        throw unprocessable("Skill source metadata is incomplete.");
      }
      const repoPath = normalizePortablePath(path.posix.join(repoSkillDir, normalizedPath));
      content = await fetchText(resolveRawGitHubUrl(hostname, owner, repo, ref, repoPath));
    } else if (skill.sourceType === "url") {
      if (normalizedPath !== "SKILL.md") {
        throw notFound("This skill source only exposes SKILL.md");
      }
      content = skill.markdown;
    } else {
      throw unprocessable("Unsupported skill source.");
    }

    return {
      skillId: skill.id,
      path: normalizedPath,
      kind: fileEntry.kind,
      content,
      language: inferLanguageFromPath(normalizedPath),
      markdown: isMarkdownPath(normalizedPath),
      editable: source.editable,
    };
  }

  async function createLocalSkill(squadId: string, input: SquadSkillCreateRequest): Promise<SquadSkill> {
    const slug = normalizeSkillSlug(input.slug ?? input.name) ?? "skill";
    const managedRoot = resolveManagedSkillsRoot(squadId);
    const skillDir = path.resolve(managedRoot, slug);
    const skillFilePath = path.resolve(skillDir, "SKILL.md");

    await fs.mkdir(skillDir, { recursive: true });

    const markdown = (input.markdown?.trim().length
      ? input.markdown
      : [
        "---",
        `name: ${input.name}`,
        ...(input.description?.trim() ? [`description: ${input.description.trim()}`] : []),
        "---",
        "",
        `# ${input.name}`,
        "",
        input.description?.trim() ? input.description.trim() : "Describe what this skill does.",
        "",
      ].join("\n"));

    await fs.writeFile(skillFilePath, markdown, "utf8");

    const parsed = parseFrontmatterMarkdown(markdown);
    const imported = await upsertImportedSkills(squadId, [{
      key: `squad/${squadId}/${slug}`,
      slug,
      name: asString(parsed.frontmatter.name) ?? input.name,
      description: asString(parsed.frontmatter.description) ?? input.description?.trim() ?? null,
      markdown,
      sourceType: "local_path",
      sourceLocator: skillDir,
      sourceRef: null,
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: [{ path: "SKILL.md", kind: "skill" }],
      metadata: { sourceKind: "managed_local" },
    }]);

    return imported[0]!;
  }

  async function updateFile(squadId: string, skillId: string, relativePath: string, content: string): Promise<SquadSkillFileDetail> {
    await ensureSkillInventoryCurrent(squadId);
    const skill = await getById(squadId, skillId);
    if (!skill) throw notFound("Skill not found");

    const source = deriveSkillSourceInfo(skill);
    if (!source.editable || skill.sourceType !== "local_path") {
      throw unprocessable(source.editableReason ?? "This skill cannot be edited.");
    }

    const normalizedPath = normalizePortablePath(relativePath);
    const absolutePath = resolveLocalSkillFilePath(skill, normalizedPath);
    if (!absolutePath) throw notFound("Skill file not found");

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");

    if (normalizedPath === "SKILL.md") {
      const parsed = parseFrontmatterMarkdown(content);
      await db
        .update(squadSkills)
        .set({
          name: asString(parsed.frontmatter.name) ?? skill.name,
          description: asString(parsed.frontmatter.description) ?? skill.description,
          markdown: content,
          updatedAt: new Date(),
        })
        .where(eq(squadSkills.id, skill.id));
    } else {
      await db
        .update(squadSkills)
        .set({ updatedAt: new Date() })
        .where(eq(squadSkills.id, skill.id));
    }

    const detail = await readFile(squadId, skillId, normalizedPath);
    if (!detail) throw notFound("Skill file not found");
    return detail;
  }

  async function installUpdate(squadId: string, skillId: string, options: { force?: boolean } = {}): Promise<SquadSkill | null> {
    await ensureSkillInventoryCurrent(squadId);
    const skill = await getById(squadId, skillId);
    if (!skill) return null;

    const status = await updateStatus(squadId, skillId);
    if (!status?.supported) {
      throw unprocessable(status?.reason ?? "This skill does not support updates.");
    }
    if (skill.sourceType === "catalog" || skill.sourceType === "local_path") {
      const audit = await auditInstalledSkillBytes(skill);
      await persistAuditMetadata(skill, audit);
      if (audit.verdict === "fail") {
        throw unprocessable("Skill update is blocked by hard-stop audit findings.", {
          updateHoldReason: "audit_hard_stop",
          audit,
        });
      }
      if (audit.originHash && audit.installedHash !== audit.originHash && !options.force) {
        throw unprocessable("Skill update is held because local modifications were detected; rerun with --force to discard them.", {
          updateHoldReason: "local_modifications",
          audit,
        });
      }
    }

    if (skill.sourceType === "catalog") {
      const catalogId = asString(getSkillMeta(skill).catalogId);
      if (!catalogId) {
        throw unprocessable("Catalog skill metadata is incomplete.");
      }
      const catalogSkill = resolveCatalogSkillIfPresent(catalogId);
      if (!catalogSkill) {
        throw unprocessable("Catalog entry is no longer available in the shipped manifest.", {
          updateHoldReason: "origin_unavailable",
        });
      }
      assertCatalogSkillInstallable(catalogSkill);
      const originSnapshotLocator = await materializeCatalogOriginSnapshot(squadId, catalogSkill, skill.slug);
      const snapshotSkill = {
        ...skill,
        sourceLocator: originSnapshotLocator,
        sourceRef: catalogSkill.contentHash,
        fileInventory: catalogSkill.files.map((entry) => ({ path: entry.path, kind: entry.kind })),
        metadata: {
          ...(isPlainRecord(skill.metadata) ? skill.metadata : {}),
          originHash: catalogSkill.contentHash,
        },
      };
      const candidateAudit = await auditInstalledSkillBytes(snapshotSkill);
      if (candidateAudit.verdict === "fail") {
        throw unprocessable("Catalog update is blocked by hard-stop audit findings.", {
          updateHoldReason: "audit_hard_stop",
          audit: candidateAudit,
        });
      }
      const materializedDir = path.resolve(
        resolveManagedSkillsRoot(squadId),
        "__catalog__",
        buildSkillRuntimeName(catalogSkill.key, skill.slug),
      );
      await copySkillDirectory(originSnapshotLocator, materializedDir);
      const markdown = (await readCatalogSkillFile(catalogSkill.id, catalogSkill.entrypoint)).content;
      const nextMetadata = buildCatalogSkillMetadata(catalogSkill, skill, originSnapshotLocator);
      const nextValues = {
        name: catalogSkill.name,
        description: catalogSkill.description,
        markdown,
        sourceLocator: materializedDir,
        sourceRef: catalogSkill.contentHash,
        trustLevel: catalogSkill.trustLevel,
        compatibility: catalogSkill.compatibility,
        fileInventory: serializeFileInventory(catalogSkill.files.map((entry) => ({
          path: entry.path,
          kind: entry.kind,
        }))),
        metadata: {
          ...nextMetadata,
          installedHash: catalogSkill.contentHash,
          userModifiedAt: null,
          updateHoldReason: null,
          auditVerdict: "pass",
          auditCodes: [],
          auditScannedAt: new Date().toISOString(),
          auditScanVersion: SKILL_AUDIT_SCAN_VERSION,
        },
        updatedAt: new Date(),
      };
      const row = await db
        .update(squadSkills)
        .set(nextValues)
        .where(and(eq(squadSkills.id, skill.id), eq(squadSkills.squadId, squadId)))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!row) throw notFound("Skill not found");
      const updated = toSquadSkill(row);
      const postAudit = await auditInstalledSkillBytes(updated);
      if (postAudit.verdict === "fail") {
        await persistAuditMetadata(updated, postAudit);
        throw unprocessable("Catalog update produced hard-stop audit findings.", {
          updateHoldReason: "audit_hard_stop",
          audit: postAudit,
        });
      }
      return persistAuditMetadata(updated, postAudit);
    }

    if (!skill.sourceLocator) {
      throw unprocessable("Skill source locator is missing.");
    }

    const result = await readUrlSkillImports(squadId, skill.sourceLocator, skill.slug);
    const matching = result.skills.find((entry) => entry.key === skill.key) ?? result.skills[0] ?? null;
    if (!matching) {
      throw unprocessable(`Skill ${skill.key} could not be re-imported from its source.`);
    }
    const imported = await upsertImportedSkills(squadId, [matching]);
    return imported[0] ?? null;
  }

  async function resetSkill(squadId: string, skillId: string, options: { force?: boolean } = {}): Promise<SquadSkill | null> {
    await ensureSkillInventoryCurrent(squadId);
    const skill = await getById(squadId, skillId);
    if (!skill) return null;
    if (skill.sourceType !== "catalog") {
      throw unprocessable("Only catalog-managed squad skills support reset.");
    }

    const metadata = getSkillMeta(skill);
    const originHash = asString(metadata.originHash);
    const snapshotLocator = asString(metadata.originSnapshotLocator);
    const targetDir = normalizeSkillDirectory(skill);
    if (!originHash || !targetDir) {
      throw unprocessable("Catalog skill origin metadata is incomplete.", {
        updateHoldReason: "origin_unavailable",
      });
    }

    let sourceDir = snapshotLocator && (await statPath(path.join(snapshotLocator, "SKILL.md")))?.isFile()
      ? snapshotLocator
      : null;
    if (!sourceDir) {
      const catalogId = asString(metadata.catalogId);
      const catalogSkill = catalogId ? resolveCatalogSkillIfPresent(catalogId) : null;
      if (catalogSkill?.contentHash === originHash) {
        sourceDir = await materializeCatalogOriginSnapshot(squadId, catalogSkill, skill.slug);
      }
    }
    if (!sourceDir) {
      throw conflict("Pinned catalog origin bytes are unavailable; run skills update explicitly instead.", {
        updateHoldReason: "origin_unavailable",
      });
    }

    const originAudit = await auditInstalledSkillBytes({
      ...skill,
      sourceLocator: sourceDir,
      metadata: {
        ...(isPlainRecord(skill.metadata) ? skill.metadata : {}),
        originHash,
      },
    });
    if (originAudit.installedHash !== originHash || originAudit.verdict === "fail") {
      throw unprocessable("Pinned catalog origin failed audit and cannot be restored.", {
        updateHoldReason: originAudit.verdict === "fail" ? "audit_hard_stop" : "origin_unavailable",
        audit: originAudit,
      });
    }

    const preAudit = await auditInstalledSkillBytes(skill);
    await persistAuditMetadata(skill, preAudit);
    if (preAudit.installedHash !== originHash && !options.force) {
      throw unprocessable("Skill reset would discard local modifications; rerun with --force after confirming reset.", {
        updateHoldReason: "local_modifications",
        audit: preAudit,
      });
    }

    await copySkillDirectory(sourceDir, targetDir);
    const markdown = await fs.readFile(path.join(targetDir, "SKILL.md"), "utf8");
    const inventory = await collectLocalSkillInventory(targetDir);
    const trustLevel = deriveTrustLevel(inventory);
    const row = await db
      .update(squadSkills)
      .set({
        markdown,
        sourceRef: originHash,
        trustLevel,
        compatibility: "compatible",
        fileInventory: serializeFileInventory(inventory),
        metadata: {
          ...(isPlainRecord(skill.metadata) ? skill.metadata : {}),
          originSnapshotLocator: sourceDir,
          installedHash: originHash,
          userModifiedAt: null,
          updateHoldReason: null,
          auditVerdict: "pass",
          auditCodes: [],
          auditScannedAt: new Date().toISOString(),
          auditScanVersion: SKILL_AUDIT_SCAN_VERSION,
        },
        updatedAt: new Date(),
      })
      .where(and(eq(squadSkills.id, skill.id), eq(squadSkills.squadId, squadId)))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Skill not found");
    const reset = toSquadSkill(row);
    const postAudit = await auditInstalledSkillBytes(reset);
    if (postAudit.installedHash !== originHash || postAudit.verdict === "fail") {
      await persistAuditMetadata(reset, postAudit);
      throw unprocessable("Catalog reset did not restore a passing pinned origin.", {
        updateHoldReason: postAudit.verdict === "fail" ? "audit_hard_stop" : "origin_unavailable",
        audit: postAudit,
      });
    }
    return persistAuditMetadata(reset, postAudit);
  }

  async function scanProjectWorkspaces(
    squadId: string,
    input: SquadSkillProjectScanRequest = {},
  ): Promise<SquadSkillProjectScanResult> {
    await ensureSkillInventoryCurrent(squadId);
    const projectRows = input.projectIds?.length
      ? await projects.listByIds(squadId, input.projectIds)
      : await projects.list(squadId);
    const workspaceFilter = new Set(input.workspaceIds ?? []);
    const skipped: SquadSkillProjectScanSkipped[] = [];
    const conflicts: SquadSkillProjectScanConflict[] = [];
    const warnings: string[] = [];
    const imported: SquadSkill[] = [];
    const updated: SquadSkill[] = [];
    const availableSkills = await listFull(squadId);
    const acceptedSkills = [...availableSkills];
    const acceptedByKey = new Map(acceptedSkills.map((skill) => [skill.key, skill]));
    const scanTargets: ProjectSkillScanTarget[] = [];
    const scannedProjectIds = new Set<string>();
    let discovered = 0;

    const trackWarning = (message: string) => {
      warnings.push(message);
      return message;
    };
    const upsertAcceptedSkill = (skill: SquadSkill) => {
      const nextIndex = acceptedSkills.findIndex((entry) => entry.id === skill.id || entry.key === skill.key);
      if (nextIndex >= 0) acceptedSkills[nextIndex] = skill;
      else acceptedSkills.push(skill);
      acceptedByKey.set(skill.key, skill);
    };

    for (const project of projectRows) {
      for (const workspace of project.workspaces) {
        if (workspaceFilter.size > 0 && !workspaceFilter.has(workspace.id)) continue;
        const workspaceCwd = asString(workspace.cwd);
        if (!workspaceCwd) {
          skipped.push({
            projectId: project.id,
            projectName: project.name,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            path: null,
            reason: trackWarning(`Skipped ${project.name} / ${workspace.name}: no local workspace path is configured.`),
          });
          continue;
        }

        const workspaceStat = await statPath(workspaceCwd);
        if (!workspaceStat?.isDirectory()) {
          skipped.push({
            projectId: project.id,
            projectName: project.name,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            path: workspaceCwd,
            reason: trackWarning(`Skipped ${project.name} / ${workspace.name}: local workspace path is not available at ${workspaceCwd}.`),
          });
          continue;
        }

        scanTargets.push({
          projectId: project.id,
          projectName: project.name,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          workspaceCwd,
        });
      }
    }

    for (const target of scanTargets) {
      scannedProjectIds.add(target.projectId);
      const directories = await discoverProjectWorkspaceSkillDirectories(target);

      for (const directory of directories) {
        discovered += 1;

        let nextSkill: ImportedSkill;
        try {
          nextSkill = await readLocalSkillImportFromDirectory(squadId, directory.skillDir, {
            inventoryMode: directory.inventoryMode,
            metadata: {
              sourceKind: "project_scan",
              projectId: target.projectId,
              projectName: target.projectName,
              workspaceId: target.workspaceId,
              workspaceName: target.workspaceName,
              workspaceCwd: target.workspaceCwd,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          skipped.push({
            projectId: target.projectId,
            projectName: target.projectName,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceName,
            path: directory.skillDir,
            reason: trackWarning(`Skipped ${directory.skillDir}: ${message}`),
          });
          continue;
        }

        const normalizedSourceDir = normalizeSourceLocatorDirectory(nextSkill.sourceLocator);
        const existingByKey = acceptedByKey.get(nextSkill.key) ?? null;
        if (existingByKey) {
          const existingSourceDir = normalizeSkillDirectory(existingByKey);
          if (
            existingByKey.sourceType !== "local_path"
            || !existingSourceDir
            || !normalizedSourceDir
            || existingSourceDir !== normalizedSourceDir
          ) {
            conflicts.push({
              slug: nextSkill.slug,
              key: nextSkill.key,
              projectId: target.projectId,
              projectName: target.projectName,
              workspaceId: target.workspaceId,
              workspaceName: target.workspaceName,
              path: directory.skillDir,
              existingSkillId: existingByKey.id,
              existingSkillKey: existingByKey.key,
              existingSourceLocator: existingByKey.sourceLocator,
              reason: `Skill key ${nextSkill.key} already points at ${existingByKey.sourceLocator ?? "another source"}.`,
            });
            continue;
          }

          const persisted = (await upsertImportedSkills(squadId, [nextSkill]))[0];
          if (!persisted) continue;
          updated.push(persisted);
          upsertAcceptedSkill(persisted);
          continue;
        }

        const slugConflict = acceptedSkills.find((skill) => {
          if (skill.slug !== nextSkill.slug) return false;
          return normalizeSkillDirectory(skill) !== normalizedSourceDir;
        });
        if (slugConflict) {
          conflicts.push({
            slug: nextSkill.slug,
            key: nextSkill.key,
            projectId: target.projectId,
            projectName: target.projectName,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceName,
            path: directory.skillDir,
            existingSkillId: slugConflict.id,
            existingSkillKey: slugConflict.key,
            existingSourceLocator: slugConflict.sourceLocator,
            reason: `Slug ${nextSkill.slug} is already in use by ${slugConflict.sourceLocator ?? slugConflict.key}.`,
          });
          continue;
        }

        const persisted = (await upsertImportedSkills(squadId, [nextSkill]))[0];
        if (!persisted) continue;
        imported.push(persisted);
        upsertAcceptedSkill(persisted);
      }
    }

    return {
      scannedProjects: scannedProjectIds.size,
      scannedWorkspaces: scanTargets.length,
      discovered,
      imported,
      updated,
      skipped,
      conflicts,
      warnings,
    };
  }

  async function materializeCatalogSkillFiles(
    squadId: string,
    skill: ImportedSkill,
    normalizedFiles: Record<string, string>,
  ) {
    const packageDir = skill.packageDir ? normalizePortablePath(skill.packageDir) : null;
    if (!packageDir) return null;
    const catalogRoot = path.resolve(resolveManagedSkillsRoot(squadId), "__catalog__");
    const skillDir = path.resolve(catalogRoot, buildSkillRuntimeName(skill.key, skill.slug));
    await fs.rm(skillDir, { recursive: true, force: true });
    await fs.mkdir(skillDir, { recursive: true });

    for (const entry of skill.fileInventory) {
      const sourcePath = entry.path === "SKILL.md"
        ? `${packageDir}/SKILL.md`
        : `${packageDir}/${entry.path}`;
      const content = normalizedFiles[sourcePath];
      if (typeof content !== "string") continue;
      const targetPath = path.resolve(skillDir, entry.path);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, "utf8");
    }

    return skillDir;
  }

  async function createDirectoryReplacement(targetDir: string) {
    const parentDir = path.dirname(targetDir);
    const baseName = path.basename(targetDir);
    await fs.mkdir(parentDir, { recursive: true });
    const stagingDir = path.join(parentDir, `.${baseName}.tmp-${randomUUID()}`);
    const previousDir = path.join(parentDir, `.${baseName}.old-${randomUUID()}`);
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });

    return {
      stagingDir,
      async commit() {
        let hasPrevious = false;
        try {
          await fs.rename(targetDir, previousDir);
          hasPrevious = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }

        try {
          await fs.rename(stagingDir, targetDir);
        } catch (error) {
          if (hasPrevious) {
            await fs.rename(previousDir, targetDir).catch(() => undefined);
          }
          throw error;
        }

        if (hasPrevious) {
          await fs.rm(previousDir, { recursive: true, force: true });
        }
      },
      async cleanup() {
        await fs.rm(stagingDir, { recursive: true, force: true });
      },
    };
  }

  async function materializeCatalogManifestSkillFiles(
    squadId: string,
    catalogSkill: CatalogSkill,
    slug: string,
  ) {
    const catalogRoot = path.resolve(resolveManagedSkillsRoot(squadId), "__catalog__");
    const skillDir = path.resolve(catalogRoot, buildSkillRuntimeName(catalogSkill.key, slug));
    const replacement = await createDirectoryReplacement(skillDir);
    try {
      for (const entry of catalogSkill.files) {
        const targetPath = path.resolve(replacement.stagingDir, entry.path);
        if (targetPath !== replacement.stagingDir && !targetPath.startsWith(`${replacement.stagingDir}${path.sep}`)) {
          throw unprocessable(`Catalog file path is invalid: ${entry.path}`);
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await copyCatalogSkillFile(catalogSkill.id, entry.path, targetPath);
      }
      await replacement.commit();
    } catch (error) {
      await replacement.cleanup();
      throw error;
    }

    return skillDir;
  }

  async function materializeCatalogOriginSnapshot(
    squadId: string,
    catalogSkill: CatalogSkill,
    slug: string,
  ) {
    const originsRoot = path.resolve(resolveManagedSkillsRoot(squadId), "__catalog_origins__");
    const snapshotDir = path.resolve(
      originsRoot,
      buildSkillRuntimeName(catalogSkill.key, slug),
      catalogSkill.contentHash.replace(/^sha256:/, ""),
    );
    const replacement = await createDirectoryReplacement(snapshotDir);
    try {
      for (const entry of catalogSkill.files) {
        const targetPath = path.resolve(replacement.stagingDir, entry.path);
        if (targetPath !== replacement.stagingDir && !targetPath.startsWith(`${replacement.stagingDir}${path.sep}`)) {
          throw unprocessable(`Catalog file path is invalid: ${entry.path}`);
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await copyCatalogSkillFile(catalogSkill.id, entry.path, targetPath);
      }
      await replacement.commit();
    } catch (error) {
      await replacement.cleanup();
      throw error;
    }

    return snapshotDir;
  }

  async function copySkillDirectory(sourceDir: string, targetDir: string) {
    const { files } = await collectSkillFileBytes(sourceDir);
    const replacement = await createDirectoryReplacement(targetDir);
    try {
      for (const file of files) {
        const targetPath = path.resolve(replacement.stagingDir, file.path);
        if (targetPath !== replacement.stagingDir && !targetPath.startsWith(`${replacement.stagingDir}${path.sep}`)) {
          throw unprocessable(`Skill file path is invalid: ${file.path}`);
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, file.bytes);
      }
      await replacement.commit();
    } catch (error) {
      await replacement.cleanup();
      throw error;
    }
  }

  function buildCatalogSkillMetadata(
    catalogSkill: CatalogSkill,
    existing: SquadSkill | null,
    originSnapshotLocator: string,
  ) {
    const packageMetadata = getCatalogPackageMetadata();
    const existingMetadata = existing && isPlainRecord(existing.metadata) ? existing.metadata : {};
    return {
      ...existingMetadata,
      skillKey: catalogSkill.key,
      sourceKind: "catalog",
      catalogId: catalogSkill.id,
      catalogKey: catalogSkill.key,
      catalogKind: catalogSkill.kind,
      catalogCategory: catalogSkill.category,
      catalogPath: catalogSkill.path,
      packageName: packageMetadata.packageName,
      packageVersion: packageMetadata.packageVersion,
      originHash: catalogSkill.contentHash,
      originVersion: packageMetadata.packageVersion,
      originSnapshotLocator,
      userModifiedAt: existingMetadata.userModifiedAt ?? null,
      updateHoldReason: existingMetadata.updateHoldReason ?? null,
    };
  }

  function assertCatalogSkillInstallable(catalogSkill: CatalogSkill) {
    if (catalogSkill.compatibility !== "compatible") {
      throw unprocessable(`Catalog skill ${catalogSkill.id} is not compatible.`);
    }
    if (catalogSkill.trustLevel === "scripts_executables") {
      throw unprocessable(
        "Catalog skill contains executable scripts and cannot be force-installed until security review semantics allow it.",
      );
    }
  }

  async function installFromCatalog(
    squadId: string,
    input: SquadSkillInstallCatalogRequest,
  ): Promise<SquadSkillInstallCatalogResult> {
    await ensureSkillInventoryCurrent(squadId);
    const catalogSkill = getCatalogSkillOrThrow(input.catalogSkillId);
    assertCatalogSkillInstallable(catalogSkill);

    const slug = normalizeSkillSlug(input.slug ?? catalogSkill.slug);
    if (!slug) {
      throw unprocessable("Catalog skill slug is invalid.");
    }

    const existingSkills = await listFull(squadId);
    const existingByKey = existingSkills.find((skill) => skill.key === catalogSkill.key) ?? null;
    const slugConflict = existingSkills.find((skill) => skill.slug === slug && skill.id !== existingByKey?.id) ?? null;
    if (slugConflict) {
      throw conflict(`Skill slug "${slug}" is already used by ${slugConflict.key}.`);
    }

    if (existingByKey) {
      const metadata = getSkillMeta(existingByKey);
      const existingCatalogId = asString(metadata.catalogId);
      const sameCatalog = existingByKey.sourceType === "catalog" && existingCatalogId === catalogSkill.id;
      const catalogManaged = existingByKey.sourceType === "catalog";
      if (!sameCatalog && (!catalogManaged || !input.force)) {
        throw conflict(
          `Skill key "${catalogSkill.key}" is already used by ${existingByKey.sourceLocator ?? existingByKey.slug}.`,
        );
      }
      if (
        sameCatalog
        && existingByKey.slug === slug
        && asString(metadata.originHash) === catalogSkill.contentHash
      ) {
        const audit = await auditInstalledSkillBytes(existingByKey);
        const audited = await persistAuditMetadata(existingByKey, audit);
        if (audit.installedHash === catalogSkill.contentHash && audit.verdict !== "fail") {
          return {
            action: "unchanged",
            skill: audited,
            catalogSkill,
            warnings: audit.findings.map((finding) => finding.message),
          };
        }
        if (!input.force) {
          const holdReason = audit.verdict === "fail" ? "audit_hard_stop" : "local_modifications";
          const message = audit.verdict === "fail"
            ? "Catalog skill has hard-stop audit findings; rerun with --force to replace it."
            : "Catalog skill has local modifications; rerun with --force to replace it.";
          throw unprocessable(message, {
            updateHoldReason: holdReason,
            audit,
          });
        }
      }
    }

    const materializedDir = await materializeCatalogManifestSkillFiles(squadId, catalogSkill, slug);
    const originSnapshotLocator = await materializeCatalogOriginSnapshot(squadId, catalogSkill, slug);
    const markdown = (await readCatalogSkillFile(catalogSkill.id, catalogSkill.entrypoint)).content;
    const metadata = buildCatalogSkillMetadata(catalogSkill, existingByKey, originSnapshotLocator);
    const values = {
      squadId,
      key: catalogSkill.key,
      slug,
      name: catalogSkill.name,
      description: catalogSkill.description,
      markdown,
      sourceType: "catalog",
      sourceLocator: materializedDir,
      sourceRef: catalogSkill.contentHash,
      trustLevel: catalogSkill.trustLevel,
      compatibility: catalogSkill.compatibility,
      fileInventory: serializeFileInventory(catalogSkill.files.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
      }))),
      metadata,
      updatedAt: new Date(),
    };

    const row = existingByKey
      ? await db
        .update(squadSkills)
        .set(values)
        .where(eq(squadSkills.id, existingByKey.id))
        .returning()
        .then((rows) => rows[0] ?? null)
      : await db
        .insert(squadSkills)
        .values(values)
        .returning()
        .then((rows) => rows[0] ?? null);

    if (!row) throw notFound("Failed to persist squad skill");
    const installed = toSquadSkill(row);
    const postAudit = await auditInstalledSkillBytes(installed);
    if (postAudit.verdict === "fail") {
      await persistAuditMetadata(installed, postAudit);
      throw unprocessable("Catalog install produced hard-stop audit findings.", {
        updateHoldReason: "audit_hard_stop",
        audit: postAudit,
      });
    }
    const audited = await persistAuditMetadata(installed, postAudit);
    return {
      action: existingByKey ? "updated" : "created",
      skill: audited,
      catalogSkill,
      warnings: postAudit.findings.map((finding) => finding.message),
    };
  }

  async function materializeRuntimeSkillFiles(squadId: string, skill: SquadSkill) {
    const runtimeRoot = path.resolve(resolveManagedSkillsRoot(squadId), "__runtime__");
    const skillDir = path.resolve(runtimeRoot, buildSkillRuntimeName(skill.key, skill.slug));
    await fs.rm(skillDir, { recursive: true, force: true });
    await fs.mkdir(skillDir, { recursive: true });

    let wroteSkillFile = false;
    for (const entry of skill.fileInventory) {
      const normalizedPath = normalizePortablePath(entry.path);
      const detail = await readFile(squadId, skill.id, normalizedPath).catch(() => null);
      const content = detail?.content ?? (normalizedPath === "SKILL.md" ? skill.markdown : null);
      if (content === null) continue;
      const targetPath = path.resolve(skillDir, entry.path);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, "utf8");
      if (normalizedPath === "SKILL.md") wroteSkillFile = true;
    }

    if (!wroteSkillFile) {
      await fs.rm(skillDir, { recursive: true, force: true });
      throw unprocessable("Squad skill could not be materialized because its stored SKILL.md copy is missing.");
    }

    return skillDir;
  }

  function resolveRuntimeSkillMaterializedPath(squadId: string, skill: Pick<SquadSkill, "key" | "slug">) {
    const runtimeRoot = path.resolve(resolveManagedSkillsRoot(squadId), "__runtime__");
    return path.resolve(runtimeRoot, buildSkillRuntimeName(skill.key, skill.slug));
  }

  async function resolveRuntimeSkillSource(
    squadId: string,
    skill: SquadSkill,
    options: RuntimeSkillEntryOptions,
  ): Promise<RuntimeSkillSourceResolution | null> {
    const source = await resolveExistingSkillDirectory(normalizeSkillDirectory(skill));
    if (source) return { status: "available", source };

    if (options.materializeMissing === false) {
      const materializedPath = resolveRuntimeSkillMaterializedPath(squadId, skill);
      const materializedSource = await resolveExistingSkillDirectory(materializedPath);
      if (materializedSource) return { status: "available", source: materializedSource };
      return {
        status: "missing",
        source: materializedPath,
        detail: buildMissingRuntimeSourceDetail(skill),
      };
    }

    const materializedSource = await materializeRuntimeSkillFiles(squadId, skill).catch(() => null);
    return materializedSource ? { status: "available", source: materializedSource } : null;
  }

  async function listRuntimeSkillEntries(
    squadId: string,
    options: RuntimeSkillEntryOptions = {},
  ): Promise<SlawSkillEntry[]> {
    const skills = await listFull(squadId);

    const out: SlawSkillEntry[] = [];
    for (const skill of skills) {
      const sourceKind = asString(getSkillMeta(skill).sourceKind);
      const sourceResolution = await resolveRuntimeSkillSource(squadId, skill, options);
      if (!sourceResolution) continue;

      const required = sourceKind === "slaw_bundled";
      out.push({
        key: skill.key,
        runtimeName: buildSkillRuntimeName(skill.key, skill.slug),
        source: sourceResolution.source,
        sourceStatus: sourceResolution.status,
        missingDetail: sourceResolution.status === "missing" ? sourceResolution.detail : null,
        required,
        requiredReason: required
          ? "Bundled Slaw skills are always available for local adapters."
          : null,
      });
    }

    out.sort((left, right) => left.key.localeCompare(right.key));
    return out;
  }

  async function importPackageFiles(
    squadId: string,
    files: Record<string, string>,
    options?: {
      onConflict?: PackageSkillConflictStrategy;
    },
  ): Promise<ImportPackageSkillResult[]> {
    await ensureSkillInventoryCurrent(squadId);
    const normalizedFiles = normalizePackageFileMap(files);
    const importedSkills = readInlineSkillImports(squadId, normalizedFiles);
    if (importedSkills.length === 0) return [];

    for (const skill of importedSkills) {
      if (skill.sourceType !== "catalog") continue;
      const materializedDir = await materializeCatalogSkillFiles(squadId, skill, normalizedFiles);
      if (materializedDir) {
        skill.sourceLocator = materializedDir;
      }
    }

    const conflictStrategy = options?.onConflict ?? "replace";
    const existingSkills = await listFull(squadId);
    const existingByKey = new Map(existingSkills.map((skill) => [skill.key, skill]));
    const existingBySlug = new Map(
      existingSkills.map((skill) => [normalizeSkillSlug(skill.slug) ?? skill.slug, skill]),
    );
    const usedSlugs = new Set(existingBySlug.keys());
    const usedKeys = new Set(existingByKey.keys());

    const toPersist: ImportedSkill[] = [];
    const prepared: Array<{
      skill: ImportedSkill;
      originalKey: string;
      originalSlug: string;
      existingBefore: SquadSkill | null;
      actionHint: "created" | "updated";
      reason: string | null;
    }> = [];
    const out: ImportPackageSkillResult[] = [];

    for (const importedSkill of importedSkills) {
      const originalKey = importedSkill.key;
      const originalSlug = importedSkill.slug;
      const normalizedSlug = normalizeSkillSlug(importedSkill.slug) ?? importedSkill.slug;
      const existingByIncomingKey = existingByKey.get(importedSkill.key) ?? null;
      const existingByIncomingSlug = existingBySlug.get(normalizedSlug) ?? null;
      const conflict = existingByIncomingKey ?? existingByIncomingSlug;

      if (!conflict || conflictStrategy === "replace") {
        toPersist.push(importedSkill);
        prepared.push({
          skill: importedSkill,
          originalKey,
          originalSlug,
          existingBefore: existingByIncomingKey,
          actionHint: existingByIncomingKey ? "updated" : "created",
          reason: existingByIncomingKey ? "Existing skill key matched; replace strategy." : null,
        });
        usedSlugs.add(normalizedSlug);
        usedKeys.add(importedSkill.key);
        continue;
      }

      if (conflictStrategy === "skip") {
        out.push({
          skill: conflict,
          action: "skipped",
          originalKey,
          originalSlug,
          requestedRefs: Array.from(new Set([originalKey, originalSlug])),
          reason: "Existing skill matched; skip strategy.",
        });
        continue;
      }

      const renamedSlug = uniqueSkillSlug(normalizedSlug || "skill", usedSlugs);
      const renamedKey = uniqueImportedSkillKey(squadId, renamedSlug, usedKeys);
      const renamedSkill: ImportedSkill = {
        ...importedSkill,
        slug: renamedSlug,
        key: renamedKey,
        metadata: {
          ...(importedSkill.metadata ?? {}),
          skillKey: renamedKey,
          importedFromSkillKey: originalKey,
          importedFromSkillSlug: originalSlug,
        },
      };
      toPersist.push(renamedSkill);
      prepared.push({
        skill: renamedSkill,
        originalKey,
        originalSlug,
        existingBefore: null,
        actionHint: "created",
        reason: `Existing skill matched; renamed to ${renamedSlug}.`,
      });
      usedSlugs.add(renamedSlug);
      usedKeys.add(renamedKey);
    }

    if (toPersist.length === 0) return out;

    const persisted = await upsertImportedSkills(squadId, toPersist);
    for (let index = 0; index < prepared.length; index += 1) {
      const persistedSkill = persisted[index];
      const preparedSkill = prepared[index];
      if (!persistedSkill || !preparedSkill) continue;
      out.push({
        skill: persistedSkill,
        action: preparedSkill.actionHint,
        originalKey: preparedSkill.originalKey,
        originalSlug: preparedSkill.originalSlug,
        requestedRefs: Array.from(new Set([preparedSkill.originalKey, preparedSkill.originalSlug])),
        reason: preparedSkill.reason,
      });
    }

    return out;
  }

  async function upsertImportedSkills(squadId: string, imported: ImportedSkill[]): Promise<SquadSkill[]> {
    const out: SquadSkill[] = [];
    for (const skill of imported) {
      const existing = await getByKey(squadId, skill.key);
      const existingMeta = existing ? getSkillMeta(existing) : {};
      const incomingMeta = skill.metadata && isPlainRecord(skill.metadata) ? skill.metadata : {};
      const incomingOwner = asString(incomingMeta.owner);
      const incomingRepo = asString(incomingMeta.repo);
      const incomingKind = asString(incomingMeta.sourceKind);
      if (
        existing
        && existingMeta.sourceKind === "slaw_bundled"
        && incomingKind === "github"
        && incomingOwner === "slaw"
        && incomingRepo === "slaw"
      ) {
        out.push(existing);
        continue;
      }

      const metadata = {
        ...(skill.metadata ?? {}),
        skillKey: skill.key,
      };
      const values = {
        squadId,
        key: skill.key,
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        markdown: skill.markdown,
        sourceType: skill.sourceType,
        sourceLocator: skill.sourceLocator,
        sourceRef: skill.sourceRef,
        trustLevel: skill.trustLevel,
        compatibility: skill.compatibility,
        fileInventory: serializeFileInventory(skill.fileInventory),
        metadata,
        updatedAt: new Date(),
      };
      const row = existing
        ? await db
          .update(squadSkills)
          .set(values)
          .where(eq(squadSkills.id, existing.id))
          .returning()
          .then((rows) => rows[0] ?? null)
        : await db
          .insert(squadSkills)
          .values(values)
          .returning()
          .then((rows) => rows[0] ?? null);
      if (!row) throw notFound("Failed to persist squad skill");
      out.push(toSquadSkill(row));
    }
    return out;
  }

  async function importFromSource(squadId: string, source: string): Promise<SquadSkillImportResult> {
    await ensureSkillInventoryCurrent(squadId);
    const parsed = parseSkillImportSourceInput(source);
    const local = !/^https?:\/\//i.test(parsed.resolvedSource);
    const { skills, warnings } = local
      ? {
        skills: (await readLocalSkillImports(squadId, parsed.resolvedSource))
          .filter((skill) => !parsed.requestedSkillSlug || skill.slug === parsed.requestedSkillSlug),
        warnings: parsed.warnings,
      }
      : await readUrlSkillImports(squadId, parsed.resolvedSource, parsed.requestedSkillSlug)
        .then((result) => ({
          skills: result.skills,
          warnings: [...parsed.warnings, ...result.warnings],
        }));
    const filteredSkills = parsed.requestedSkillSlug
      ? skills.filter((skill) => skill.slug === parsed.requestedSkillSlug)
      : skills;
    if (filteredSkills.length === 0) {
      throw unprocessable(
        parsed.requestedSkillSlug
          ? `Skill ${parsed.requestedSkillSlug} was not found in the provided source.`
          : "No skills were found in the provided source.",
      );
    }
    // Override sourceType/sourceLocator for skills imported via skills.sh
    if (parsed.originalSkillsShUrl) {
      for (const skill of filteredSkills) {
        skill.sourceType = "skills_sh";
        skill.sourceLocator = parsed.originalSkillsShUrl;
        if (skill.metadata) {
          (skill.metadata as Record<string, unknown>).sourceKind = "skills_sh";
        }
        skill.key = deriveCanonicalSkillKey(squadId, skill);
      }
    }
    const imported = await upsertImportedSkills(squadId, filteredSkills);
    return { imported, warnings };
  }

  async function deleteSkill(squadId: string, skillId: string): Promise<SquadSkill | null> {
    const row = await db
      .select()
      .from(squadSkills)
      .where(and(eq(squadSkills.id, skillId), eq(squadSkills.squadId, squadId)))
      .then((rows) => rows[0] ?? null);
    if (!row) return null;

    const skill = toSquadSkill(row);
    const usedByAgents = await usage(squadId, skill.key);

    if (usedByAgents.length > 0) {
      const agentNames = usedByAgents.map((agent) => agent.name).sort((left, right) => left.localeCompare(right));
      throw unprocessable(
        `Cannot delete skill "${skill.name}" while it is still used by ${agentNames.join(", ")}. Detach it from those agents first.`,
        {
          skillId: skill.id,
          skillKey: skill.key,
          usedByAgents: usedByAgents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            urlKey: agent.urlKey,
            adapterType: agent.adapterType,
          })),
        },
      );
    }

    // Delete DB row
    await db
      .delete(squadSkills)
      .where(eq(squadSkills.id, skillId));

    // Clean up materialized runtime files
    await fs.rm(resolveRuntimeSkillMaterializedPath(squadId, skill), { recursive: true, force: true });

    return skill;
  }

  /* ───────────── tower-mastered skills (botfather skill registry) ─────────────
   * The control tower is the master skill registry. Its skills are pulled DOWN
   * and installed onto a chosen local squad as `botfather`-sourced rows: the
   * markdown body is stored locally (so the squad works offline) but is governed
   * centrally — read-only locally and refreshed when the tower publishes a new
   * version. Squad composition stays fully local; only the skill content is
   * tower-mastered. See DESIGN-skill-registry.md. */
  type TowerSkillContent = {
    key: string;
    slug?: string;
    name: string;
    description?: string | null;
    trustLevel?: string;
    version: number;
    markdown: string;
    files?: Array<{ path: string; content: string; encoding?: string }>;
    metadata?: Record<string, unknown> | null;
  };

  async function upsertTowerSkill(squadId: string, content: TowerSkillContent): Promise<SquadSkill> {
    const squad = await db.select().from(squads).where(eq(squads.id, squadId)).then((rows) => rows[0]);
    if (!squad) throw notFound("Squad not found");

    const slug = normalizeSkillSlug(content.slug ?? content.name) ?? normalizeSkillSlug(content.key) ?? content.key;
    const fileInventory = serializeFileInventory(
      (content.files ?? []).map((f) => ({ path: f.path, kind: "other" as const })),
    );
    const values = {
      squadId,
      key: content.key,
      slug,
      name: content.name,
      description: content.description ?? null,
      markdown: content.markdown,
      sourceType: "botfather" as const,
      sourceLocator: null,
      sourceRef: String(content.version),
      // The tower owns the trust level; SLAW honors it, never escalates locally.
      trustLevel: content.trustLevel ?? "markdown_only",
      compatibility: "compatible" as const,
      fileInventory,
      // carry the tower's two-axis classification (layer/discipline/tags) through install
      metadata: { ...(content.metadata ?? {}), towerManaged: true } as Record<string, unknown>,
      isTowerManaged: true,
      towerSkillKey: content.key,
      towerSkillVersion: content.version,
      updatedAt: new Date(),
    };

    const existing = await db
      .select()
      .from(squadSkills)
      .where(and(eq(squadSkills.squadId, squadId), eq(squadSkills.key, content.key)))
      .then((rows) => rows[0] ?? null);

    const row = existing
      ? await db.update(squadSkills).set(values).where(eq(squadSkills.id, existing.id)).returning().then((r) => r[0])
      : await db.insert(squadSkills).values(values).returning().then((r) => r[0]);
    if (!row) throw notFound("Failed to persist tower skill");
    return toSquadSkill(row);
  }

  /** List the tower-managed skills installed on a squad (or all squads). */
  async function listTowerManagedSkills(squadId?: string) {
    const where = squadId
      ? and(eq(squadSkills.isTowerManaged, true), eq(squadSkills.squadId, squadId))
      : eq(squadSkills.isTowerManaged, true);
    const rows = await db
      .select({
        id: squadSkills.id,
        squadId: squadSkills.squadId,
        key: squadSkills.key,
        towerSkillKey: squadSkills.towerSkillKey,
        towerSkillVersion: squadSkills.towerSkillVersion,
      })
      .from(squadSkills)
      .where(where);
    return rows;
  }

  /** Remove a tower-managed skill from a squad (the user opts out; the tower
   * library is unaffected). */
  async function removeTowerSkill(squadId: string, key: string): Promise<void> {
    const existing = await db
      .select()
      .from(squadSkills)
      .where(and(eq(squadSkills.squadId, squadId), eq(squadSkills.key, key)))
      .then((rows) => rows[0] ?? null);
    if (!existing) return;
    await db.delete(squadSkills).where(eq(squadSkills.id, existing.id));
    await fs
      .rm(resolveRuntimeSkillMaterializedPath(squadId, toSquadSkill(existing)), { recursive: true, force: true })
      .catch(() => {});
  }

  return {
    list,
    listFull,
    upsertTowerSkill,
    listTowerManagedSkills,
    removeTowerSkill,
    getById,
    getByKey,
    resolveRequestedSkillKeys: async (squadId: string, requestedReferences: string[]) => {
      const skills = await listFull(squadId);
      return resolveRequestedSkillKeysOrThrow(skills, requestedReferences);
    },
    detail,
    updateStatus,
    readFile,
    updateFile,
    createLocalSkill,
    deleteSkill,
    importFromSource,
    installFromCatalog,
    scanProjectWorkspaces,
    importPackageFiles,
    auditSkill,
    installUpdate,
    resetSkill,
    listRuntimeSkillEntries,
  };
}
