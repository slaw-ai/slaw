export type SquadSkillSourceType = "local_path" | "github" | "url" | "catalog" | "skills_sh" | "botfather";

export type SquadSkillTrustLevel = "markdown_only" | "assets" | "scripts_executables";

export type SquadSkillCompatibility = "compatible" | "unknown" | "invalid";

export type SquadSkillSourceBadge = "slaw" | "github" | "local" | "url" | "catalog" | "skills_sh" | "botfather";

export interface SquadSkillFileInventoryEntry {
  path: string;
  kind: "skill" | "markdown" | "reference" | "script" | "asset" | "other";
}

export interface SquadSkill {
  id: string;
  squadId: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  markdown: string;
  sourceType: SquadSkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: SquadSkillTrustLevel;
  compatibility: SquadSkillCompatibility;
  fileInventory: SquadSkillFileInventoryEntry[];
  metadata: Record<string, unknown> | null;
  /** true when this skill is mastered by the control tower (read-only locally) */
  isTowerManaged?: boolean;
  /** the tower skill_library key this was installed from (tower-managed only) */
  towerSkillKey?: string | null;
  /** the tower skill version currently installed locally */
  towerSkillVersion?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SquadSkillListItem {
  id: string;
  squadId: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  sourceType: SquadSkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: SquadSkillTrustLevel;
  compatibility: SquadSkillCompatibility;
  fileInventory: SquadSkillFileInventoryEntry[];
  createdAt: Date;
  updatedAt: Date;
  attachedAgentCount: number;
  editable: boolean;
  editableReason: string | null;
  sourceLabel: string | null;
  sourceBadge: SquadSkillSourceBadge;
  sourcePath: string | null;
  catalogKind: "bundled" | "optional" | null;
  originHash: string | null;
  packageName: string | null;
  packageVersion: string | null;
}

export interface SquadSkillUsageAgent {
  id: string;
  name: string;
  urlKey: string;
  adapterType: string;
  desired: boolean;
  /**
   * Runtime adapter skill state when a caller explicitly fetched it.
   * Squad skill detail reads intentionally return null here to avoid probing
   * agent runtimes while loading operator-facing skill metadata.
   */
  actualState: string | null;
}

export interface SquadSkillDetail extends SquadSkill {
  attachedAgentCount: number;
  usedByAgents: SquadSkillUsageAgent[];
  editable: boolean;
  editableReason: string | null;
  sourceLabel: string | null;
  sourceBadge: SquadSkillSourceBadge;
  sourcePath: string | null;
}

export interface SquadSkillUpdateStatus {
  supported: boolean;
  reason: string | null;
  trackingRef: string | null;
  currentRef: string | null;
  latestRef: string | null;
  hasUpdate: boolean;
  installedHash: string | null;
  originHash: string | null;
  userModifiedAt: string | null;
  updateHoldReason: SquadSkillUpdateHoldReason | null;
  auditVerdict: SquadSkillAuditVerdict | null;
  auditCodes: string[];
}

export type SquadSkillAuditSeverity = "warning" | "error";

export type SquadSkillAuditVerdict = "pass" | "warning" | "fail";

export type SquadSkillUpdateHoldReason =
  | "local_modifications"
  | "audit_hard_stop"
  | "origin_unavailable"
  | "compatibility_invalid"
  | "operator_hold";

export interface SquadSkillAuditFinding {
  code: string;
  severity: SquadSkillAuditSeverity;
  message: string;
  path: string | null;
}

export interface SquadSkillAuditResult {
  skillId: string;
  installedHash: string | null;
  originHash: string | null;
  verdict: SquadSkillAuditVerdict;
  codes: string[];
  findings: SquadSkillAuditFinding[];
  scannedAt: string;
  scanVersion: string;
}

export interface SquadSkillInstallUpdateRequest {
  force?: boolean;
}

export interface SquadSkillResetRequest {
  force?: boolean;
}

export interface SquadSkillImportRequest {
  source: string;
}

export interface SquadSkillImportResult {
  imported: SquadSkill[];
  warnings: string[];
}

export interface SquadSkillProjectScanRequest {
  projectIds?: string[];
  workspaceIds?: string[];
}

export interface SquadSkillProjectScanSkipped {
  projectId: string;
  projectName: string;
  workspaceId: string | null;
  workspaceName: string | null;
  path: string | null;
  reason: string;
}

export interface SquadSkillProjectScanConflict {
  slug: string;
  key: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  path: string;
  existingSkillId: string;
  existingSkillKey: string;
  existingSourceLocator: string | null;
  reason: string;
}

export interface SquadSkillProjectScanResult {
  scannedProjects: number;
  scannedWorkspaces: number;
  discovered: number;
  imported: SquadSkill[];
  updated: SquadSkill[];
  skipped: SquadSkillProjectScanSkipped[];
  conflicts: SquadSkillProjectScanConflict[];
  warnings: string[];
}

export interface SquadSkillCreateRequest {
  name: string;
  slug?: string | null;
  description?: string | null;
  markdown?: string | null;
}

export interface SquadSkillFileDetail {
  skillId: string;
  path: string;
  kind: SquadSkillFileInventoryEntry["kind"];
  content: string;
  language: string | null;
  markdown: boolean;
  editable: boolean;
}

export interface SquadSkillFileUpdateRequest {
  path: string;
  content: string;
}

export type CatalogSkillKind = "bundled" | "optional";

export type CatalogSkillFileKind = SquadSkillFileInventoryEntry["kind"];

export interface CatalogSkillFile {
  path: string;
  kind: CatalogSkillFileKind;
  sizeBytes: number;
  sha256: string;
}

export interface CatalogSkill {
  id: string;
  key: string;
  kind: CatalogSkillKind;
  category: string;
  slug: string;
  name: string;
  description: string;
  path: string;
  entrypoint: "SKILL.md";
  trustLevel: SquadSkillTrustLevel;
  compatibility: SquadSkillCompatibility;
  defaultInstall: boolean;
  recommendedForRoles: string[];
  requires: string[];
  tags: string[];
  files: CatalogSkillFile[];
  contentHash: string;
  packageName?: string;
  packageVersion?: string;
}

export interface CatalogSkillListQuery {
  kind?: CatalogSkillKind;
  category?: string;
  q?: string;
}

export interface CatalogSkillFileDetail {
  catalogSkillId: string;
  path: string;
  kind: CatalogSkillFileKind;
  content: string;
  language: string | null;
  markdown: boolean;
}

export interface SquadSkillInstallCatalogRequest {
  catalogSkillId: string;
  slug?: string | null;
  force?: boolean;
}

export interface SquadSkillInstallCatalogResult {
  action: "created" | "updated" | "unchanged";
  skill: SquadSkill;
  catalogSkill: CatalogSkill;
  warnings: string[];
}
