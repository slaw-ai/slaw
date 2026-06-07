import { z } from "zod";

export const squadSkillSourceTypeSchema = z.enum(["local_path", "github", "url", "catalog", "skills_sh", "botfather"]);
export const squadSkillTrustLevelSchema = z.enum(["markdown_only", "assets", "scripts_executables"]);
export const squadSkillCompatibilitySchema = z.enum(["compatible", "unknown", "invalid"]);
export const squadSkillSourceBadgeSchema = z.enum(["slaw", "github", "local", "url", "catalog", "skills_sh", "botfather"]);

export const squadSkillFileInventoryEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["skill", "markdown", "reference", "script", "asset", "other"]),
});

export const squadSkillSchema = z.object({
  id: z.string().uuid(),
  squadId: z.string().uuid(),
  key: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  markdown: z.string(),
  sourceType: squadSkillSourceTypeSchema,
  sourceLocator: z.string().nullable(),
  sourceRef: z.string().nullable(),
  trustLevel: squadSkillTrustLevelSchema,
  compatibility: squadSkillCompatibilitySchema,
  fileInventory: z.array(squadSkillFileInventoryEntrySchema).default([]),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const squadSkillListItemSchema = squadSkillSchema.extend({
  attachedAgentCount: z.number().int().nonnegative(),
  editable: z.boolean(),
  editableReason: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  sourceBadge: squadSkillSourceBadgeSchema,
  catalogKind: z.enum(["bundled", "optional"]).nullable(),
  originHash: z.string().nullable(),
  packageName: z.string().nullable(),
  packageVersion: z.string().nullable(),
});

export const squadSkillUsageAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  urlKey: z.string().min(1),
  adapterType: z.string().min(1),
  desired: z.boolean(),
  actualState: z.string().nullable().describe(
    "Runtime adapter skill state when explicitly fetched; squad skill detail reads return null without probing agent runtimes.",
  ),
});

export const squadSkillDetailSchema = squadSkillSchema.extend({
  attachedAgentCount: z.number().int().nonnegative(),
  usedByAgents: z.array(squadSkillUsageAgentSchema).default([]),
  editable: z.boolean(),
  editableReason: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  sourceBadge: squadSkillSourceBadgeSchema,
});

export const squadSkillUpdateStatusSchema = z.object({
  supported: z.boolean(),
  reason: z.string().nullable(),
  trackingRef: z.string().nullable(),
  currentRef: z.string().nullable(),
  latestRef: z.string().nullable(),
  hasUpdate: z.boolean(),
  installedHash: z.string().nullable(),
  originHash: z.string().nullable(),
  userModifiedAt: z.string().nullable(),
  updateHoldReason: z.enum([
    "local_modifications",
    "audit_hard_stop",
    "origin_unavailable",
    "compatibility_invalid",
    "operator_hold",
  ]).nullable(),
  auditVerdict: z.enum(["pass", "warning", "fail"]).nullable(),
  auditCodes: z.array(z.string()),
});

export const squadSkillAuditFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["warning", "error"]),
  message: z.string().min(1),
  path: z.string().nullable(),
});

export const squadSkillAuditResultSchema = z.object({
  skillId: z.string().uuid(),
  installedHash: z.string().nullable(),
  originHash: z.string().nullable(),
  verdict: z.enum(["pass", "warning", "fail"]),
  codes: z.array(z.string()),
  findings: z.array(squadSkillAuditFindingSchema),
  scannedAt: z.string().min(1),
  scanVersion: z.string().min(1),
});

export const squadSkillInstallUpdateSchema = z.object({
  force: z.boolean().optional(),
}).default({});

export const squadSkillResetSchema = z.object({
  force: z.boolean().optional(),
}).default({});

export const squadSkillImportSchema = z.object({
  source: z.string().min(1),
});

export const squadSkillProjectScanRequestSchema = z.object({
  projectIds: z.array(z.string().uuid()).optional(),
  workspaceIds: z.array(z.string().uuid()).optional(),
});

export const squadSkillProjectScanSkippedSchema = z.object({
  projectId: z.string().uuid(),
  projectName: z.string().min(1),
  workspaceId: z.string().uuid().nullable(),
  workspaceName: z.string().nullable(),
  path: z.string().nullable(),
  reason: z.string().min(1),
});

export const squadSkillProjectScanConflictSchema = z.object({
  slug: z.string().min(1),
  key: z.string().min(1),
  projectId: z.string().uuid(),
  projectName: z.string().min(1),
  workspaceId: z.string().uuid(),
  workspaceName: z.string().min(1),
  path: z.string().min(1),
  existingSkillId: z.string().uuid(),
  existingSkillKey: z.string().min(1),
  existingSourceLocator: z.string().nullable(),
  reason: z.string().min(1),
});

export const squadSkillProjectScanResultSchema = z.object({
  scannedProjects: z.number().int().nonnegative(),
  scannedWorkspaces: z.number().int().nonnegative(),
  discovered: z.number().int().nonnegative(),
  imported: z.array(squadSkillSchema),
  updated: z.array(squadSkillSchema),
  skipped: z.array(squadSkillProjectScanSkippedSchema),
  conflicts: z.array(squadSkillProjectScanConflictSchema),
  warnings: z.array(z.string()),
});

export const squadSkillCreateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  markdown: z.string().nullable().optional(),
});

export const squadSkillFileDetailSchema = z.object({
  skillId: z.string().uuid(),
  path: z.string().min(1),
  kind: z.enum(["skill", "markdown", "reference", "script", "asset", "other"]),
  content: z.string(),
  language: z.string().nullable(),
  markdown: z.boolean(),
  editable: z.boolean(),
});

export const squadSkillFileUpdateSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const catalogSkillKindSchema = z.enum(["bundled", "optional"]);

export const catalogSkillFileSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["skill", "markdown", "reference", "script", "asset", "other"]),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().min(1),
});

export const catalogSkillSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  kind: catalogSkillKindSchema,
  category: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  path: z.string().min(1),
  entrypoint: z.literal("SKILL.md"),
  trustLevel: squadSkillTrustLevelSchema,
  compatibility: squadSkillCompatibilitySchema,
  defaultInstall: z.boolean(),
  recommendedForRoles: z.array(z.string()),
  requires: z.array(z.string()),
  tags: z.array(z.string()),
  files: z.array(catalogSkillFileSchema),
  contentHash: z.string().min(1),
  packageName: z.string().min(1).optional(),
  packageVersion: z.string().min(1).optional(),
});

export const catalogSkillListQuerySchema = z.object({
  kind: catalogSkillKindSchema.optional(),
  category: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
});

export const catalogSkillFileDetailSchema = z.object({
  catalogSkillId: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(["skill", "markdown", "reference", "script", "asset", "other"]),
  content: z.string(),
  language: z.string().nullable(),
  markdown: z.boolean(),
});

export const squadSkillInstallCatalogSchema = z.object({
  catalogSkillId: z.string().min(1),
  slug: z.string().min(1).nullable().optional(),
  force: z.boolean().optional(),
});

export const squadSkillInstallCatalogResultSchema = z.object({
  action: z.enum(["created", "updated", "unchanged"]),
  skill: squadSkillSchema,
  catalogSkill: catalogSkillSchema,
  warnings: z.array(z.string()),
});

export type SquadSkillImport = z.infer<typeof squadSkillImportSchema>;
export type SquadSkillProjectScan = z.infer<typeof squadSkillProjectScanRequestSchema>;
export type SquadSkillCreate = z.infer<typeof squadSkillCreateSchema>;
export type SquadSkillFileUpdate = z.infer<typeof squadSkillFileUpdateSchema>;
export type CatalogSkillListQuery = z.infer<typeof catalogSkillListQuerySchema>;
export type SquadSkillInstallCatalog = z.infer<typeof squadSkillInstallCatalogSchema>;
export type SquadSkillInstallUpdate = z.infer<typeof squadSkillInstallUpdateSchema>;
export type SquadSkillReset = z.infer<typeof squadSkillResetSchema>;
