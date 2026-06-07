import type { AgentEnvConfig } from "./secrets.js";
import type { RoutineVariable } from "./routine.js";
import type { IssueCommentAuthorType } from "../constants.js";
import type { IssueCommentMetadata, IssueCommentPresentation } from "./issue.js";

export interface SquadPortabilityInclude {
  squad: boolean;
  agents: boolean;
  projects: boolean;
  issues: boolean;
  skills: boolean;
}

export interface SquadPortabilityEnvInput {
  key: string;
  description: string | null;
  agentSlug: string | null;
  projectSlug: string | null;
  kind: "secret" | "plain";
  requirement: "required" | "optional";
  defaultValue: string | null;
  portability: "portable" | "system_dependent";
}

export type SquadPortabilityFileEntry =
  | string
  | {
      encoding: "base64";
      data: string;
      contentType?: string | null;
    };

export interface SquadPortabilitySquadManifestEntry {
  path: string;
  name: string;
  description: string | null;
  brandColor: string | null;
  logoPath: string | null;
  attachmentMaxBytes: number | null;
  requireOperatorApprovalForNewAgents: boolean;
  feedbackDataSharingEnabled: boolean;
  feedbackDataSharingConsentAt: string | null;
  feedbackDataSharingConsentByUserId: string | null;
  feedbackDataSharingTermsVersion: string | null;
}

export interface SquadPortabilitySidebarOrder {
  agents: string[];
  projects: string[];
}

export interface SquadPortabilityProjectManifestEntry {
  slug: string;
  name: string;
  path: string;
  description: string | null;
  ownerAgentSlug: string | null;
  leadAgentSlug: string | null;
  targetDate: string | null;
  color: string | null;
  status: string | null;
  env: AgentEnvConfig | null;
  executionWorkspacePolicy: Record<string, unknown> | null;
  workspaces: SquadPortabilityProjectWorkspaceManifestEntry[];
  metadata: Record<string, unknown> | null;
}

export interface SquadPortabilityProjectWorkspaceManifestEntry {
  key: string;
  name: string;
  sourceType: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  defaultRef: string | null;
  visibility: string | null;
  setupCommand: string | null;
  cleanupCommand: string | null;
  metadata: Record<string, unknown> | null;
  isPrimary: boolean;
}

export interface SquadPortabilityIssueRoutineTriggerManifestEntry {
  kind: string;
  label: string | null;
  enabled: boolean;
  cronExpression: string | null;
  timezone: string | null;
  signingMode: string | null;
  replayWindowSec: number | null;
}

export interface SquadPortabilityIssueRoutineManifestEntry {
  concurrencyPolicy: string | null;
  catchUpPolicy: string | null;
  variables?: RoutineVariable[] | null;
  triggers: SquadPortabilityIssueRoutineTriggerManifestEntry[];
}

export interface SquadPortabilityIssueCommentManifestEntry {
  body: string;
  authorType: IssueCommentAuthorType;
  authorAgentSlug: string | null;
  authorUserId: string | null;
  presentation: IssueCommentPresentation | null;
  metadata: IssueCommentMetadata | null;
  createdAt: string | null;
}

export interface SquadPortabilityIssueManifestEntry {
  slug: string;
  identifier: string | null;
  title: string;
  path: string;
  projectSlug: string | null;
  projectWorkspaceKey: string | null;
  assigneeAgentSlug: string | null;
  description: string | null;
  recurring: boolean;
  routine: SquadPortabilityIssueRoutineManifestEntry | null;
  legacyRecurrence: Record<string, unknown> | null;
  status: string | null;
  priority: string | null;
  labelIds: string[];
  billingCode: string | null;
  executionWorkspaceSettings: Record<string, unknown> | null;
  assigneeAdapterOverrides: Record<string, unknown> | null;
  comments: SquadPortabilityIssueCommentManifestEntry[];
  metadata: Record<string, unknown> | null;
}

export interface SquadPortabilityAgentManifestEntry {
  slug: string;
  name: string;
  path: string;
  skills: string[];
  role: string;
  title: string | null;
  icon: string | null;
  capabilities: string | null;
  reportsToSlug: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  permissions: Record<string, unknown>;
  budgetMonthlyCents: number;
  metadata: Record<string, unknown> | null;
}

export interface SquadPortabilitySkillManifestEntry {
  key: string;
  slug: string;
  name: string;
  path: string;
  description: string | null;
  sourceType: string;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: string | null;
  compatibility: string | null;
  metadata: Record<string, unknown> | null;
  fileInventory: Array<{
    path: string;
    kind: string;
  }>;
}

export interface SquadPortabilityManifest {
  schemaVersion: number;
  generatedAt: string;
  source: {
    squadId: string;
    squadName: string;
  } | null;
  includes: SquadPortabilityInclude;
  squad: SquadPortabilitySquadManifestEntry | null;
  sidebar: SquadPortabilitySidebarOrder | null;
  agents: SquadPortabilityAgentManifestEntry[];
  skills: SquadPortabilitySkillManifestEntry[];
  projects: SquadPortabilityProjectManifestEntry[];
  issues: SquadPortabilityIssueManifestEntry[];
  envInputs: SquadPortabilityEnvInput[];
}

export interface SquadPortabilityExportResult {
  rootPath: string;
  manifest: SquadPortabilityManifest;
  files: Record<string, SquadPortabilityFileEntry>;
  warnings: string[];
  slawExtensionPath: string;
}

export interface SquadPortabilityExportPreviewFile {
  path: string;
  kind: "squad" | "agent" | "skill" | "project" | "issue" | "extension" | "readme" | "other";
}

export interface SquadPortabilityExportPreviewResult {
  rootPath: string;
  manifest: SquadPortabilityManifest;
  files: Record<string, SquadPortabilityFileEntry>;
  fileInventory: SquadPortabilityExportPreviewFile[];
  counts: {
    files: number;
    agents: number;
    skills: number;
    projects: number;
    issues: number;
  };
  warnings: string[];
  slawExtensionPath: string;
}

export type SquadPortabilitySource =
  | {
      type: "inline";
      rootPath?: string | null;
      files: Record<string, SquadPortabilityFileEntry>;
    }
  | {
      type: "github";
      url: string;
    };

export type SquadPortabilityImportTarget =
  | {
      mode: "new_squad";
      newSquadName?: string | null;
    }
  | {
      mode: "existing_squad";
      squadId: string;
    };

export type SquadPortabilityAgentSelection = "all" | string[];

export type SquadPortabilityCollisionStrategy = "rename" | "skip" | "replace";

export interface SquadPortabilityPreviewRequest {
  source: SquadPortabilitySource;
  include?: Partial<SquadPortabilityInclude>;
  target: SquadPortabilityImportTarget;
  agents?: SquadPortabilityAgentSelection;
  collisionStrategy?: SquadPortabilityCollisionStrategy;
  nameOverrides?: Record<string, string>;
  selectedFiles?: string[];
}

export interface SquadPortabilityPreviewAgentPlan {
  slug: string;
  action: "create" | "update" | "skip";
  plannedName: string;
  existingAgentId: string | null;
  reason: string | null;
}

export interface SquadPortabilityPreviewProjectPlan {
  slug: string;
  action: "create" | "update" | "skip";
  plannedName: string;
  existingProjectId: string | null;
  reason: string | null;
}

export interface SquadPortabilityPreviewIssuePlan {
  slug: string;
  action: "create" | "skip";
  plannedTitle: string;
  reason: string | null;
}

export interface SquadPortabilityPreviewResult {
  include: SquadPortabilityInclude;
  targetSquadId: string | null;
  targetSquadName: string | null;
  collisionStrategy: SquadPortabilityCollisionStrategy;
  selectedAgentSlugs: string[];
  plan: {
    squadAction: "none" | "create" | "update";
    agentPlans: SquadPortabilityPreviewAgentPlan[];
    projectPlans: SquadPortabilityPreviewProjectPlan[];
    issuePlans: SquadPortabilityPreviewIssuePlan[];
  };
  manifest: SquadPortabilityManifest;
  files: Record<string, SquadPortabilityFileEntry>;
  envInputs: SquadPortabilityEnvInput[];
  warnings: string[];
  errors: string[];
}

export interface SquadPortabilityAdapterOverride {
  adapterType: string;
  adapterConfig?: Record<string, unknown>;
}

export interface SquadPortabilityImportRequest extends SquadPortabilityPreviewRequest {
  adapterOverrides?: Record<string, SquadPortabilityAdapterOverride>;
}

export interface SquadPortabilityImportResult {
  squad: {
    id: string;
    name: string;
    action: "created" | "updated" | "unchanged";
  };
  agents: {
    slug: string;
    id: string | null;
    action: "created" | "updated" | "skipped";
    name: string;
    reason: string | null;
  }[];
  projects: {
    slug: string;
    id: string | null;
    action: "created" | "updated" | "skipped";
    name: string;
    reason: string | null;
  }[];
  envInputs: SquadPortabilityEnvInput[];
  warnings: string[];
}

export interface SquadPortabilityExportRequest {
  include?: Partial<SquadPortabilityInclude>;
  agents?: string[];
  skills?: string[];
  projects?: string[];
  issues?: string[];
  projectIssues?: string[];
  selectedFiles?: string[];
  expandReferencedSkills?: boolean;
  sidebarOrder?: Partial<SquadPortabilitySidebarOrder>;
}
