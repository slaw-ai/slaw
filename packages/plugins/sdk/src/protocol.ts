/**
 * JSON-RPC 2.0 message types and protocol helpers for the host ↔ worker IPC
 * channel.
 *
 * The Slaw plugin runtime uses JSON-RPC 2.0 over stdio to communicate
 * between the host process and each plugin worker process. This module defines:
 *
 * - Core JSON-RPC 2.0 envelope types (request, response, notification, error)
 * - Standard and plugin-specific error codes
 * - Typed method maps for host→worker and worker→host calls
 * - Helper functions for creating well-formed messages
 *
 * @see PLUGIN_SPEC.md §12.1 — Process Model
 * @see PLUGIN_SPEC.md §13 — Host-Worker Protocol
 * @see https://www.jsonrpc.org/specification
 */

import type {
  SlawPluginManifestV1,
  PluginLauncherBounds,
  PluginLauncherRenderContextSnapshot,
  PluginLauncherRenderEnvironment,
  PluginStateScopeKind,
  Squad,
  Project,
  Issue,
  IssueComment,
  IssueDocument,
  IssueDocumentSummary,
  IssueAssigneeAdapterOverrides,
  IssueThreadInteraction,
  CreateIssueThreadInteraction,
  PluginManagedAgentResolution,
  PluginManagedProjectResolution,
  PluginManagedRoutineResolution,
  PluginManagedSkillResolution,
  Routine,
  RoutineRun,
  Agent,
  Goal,
  PluginLocalFolderDeclaration,
  PrincipalPermissionGrant,
} from "@slaw/shared";
export type { PluginLauncherRenderContextSnapshot } from "@slaw/shared";

import type {
  PluginEvent,
  PluginIssueCheckoutOwnership,
  PluginIssueOrchestrationSummary,
  PluginIssueRelationSummary,
  PluginIssueSubtree,
  PluginIssueWakeupBatchResult,
  PluginIssueWakeupResult,
  PluginJobContext,
  PluginExecutionWorkspaceMetadata,
  PluginWorkspace,
  ToolRunContext,
  ToolResult,
  PluginLocalFolderListing,
  PluginLocalFolderStatus,
  PluginAccessInvite,
  PluginAccessMember,
  PluginAssignmentPreviewInput,
  PluginAuthorizationAuditEntry,
  PluginAuthorizationDecisionResult,
  PluginAuthorizationPolicyRecord,
  PluginAuthorizationPolicySummary,
} from "./types.js";
import type {
  PluginHealthDiagnostics,
  PluginApiRequestInput,
  PluginApiResponse,
  PluginConfigValidationResult,
  PluginWebhookInput,
} from "./define-plugin.js";

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 — Core Protocol Types
// ---------------------------------------------------------------------------

/** The JSON-RPC protocol version. Always `"2.0"`. */
export const JSONRPC_VERSION = "2.0" as const;

/**
 * A unique request identifier. JSON-RPC 2.0 allows strings or numbers;
 * we use strings (UUIDs or monotonic counters) for all Slaw messages.
 */
export type JsonRpcId = string | number;

/**
 * Host-owned scope attached to a host→worker invocation. Workers may echo the
 * invocation id on nested worker→host calls, but they never author this scope.
 */
export interface JsonRpcInvocationScope {
  readonly squadId?: string | null;
}

export interface JsonRpcInvocationContext {
  readonly id: string;
  readonly scope: JsonRpcInvocationScope;
}

/**
 * A JSON-RPC 2.0 request message.
 *
 * The host sends requests to the worker (or vice versa) and expects a
 * matching response with the same `id`.
 */
export interface JsonRpcRequest<
  TMethod extends string = string,
  TParams = unknown,
> {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  /** Unique request identifier. Must be echoed in the response. */
  readonly id: JsonRpcId;
  /** The RPC method name to invoke. */
  readonly method: TMethod;
  /** Structured parameters for the method call. */
  readonly params: TParams;
  /**
   * Host-issued metadata for the top-level plugin invocation that is currently
   * executing. The worker treats this as opaque and echoes only the id on
   * worker→host calls made from the same async execution context.
   */
  readonly slawInvocation?: PluginInvocationContext;
  /** Opaque top-level invocation id echoed by worker→host requests. */
  readonly slawInvocationId?: string;
}

/**
 * A JSON-RPC 2.0 success response.
 */
export interface JsonRpcSuccessResponse<TResult = unknown> {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  /** Echoed request identifier. */
  readonly id: JsonRpcId;
  /** The method return value. */
  readonly result: TResult;
  readonly error?: never;
}

/**
 * A JSON-RPC 2.0 error object embedded in an error response.
 */
export interface JsonRpcError<TData = unknown> {
  /** Machine-readable error code. */
  readonly code: number;
  /** Human-readable error message. */
  readonly message: string;
  /** Optional structured error data. */
  readonly data?: TData;
}

/**
 * A JSON-RPC 2.0 error response.
 */
export interface JsonRpcErrorResponse<TData = unknown> {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  /** Echoed request identifier. */
  readonly id: JsonRpcId | null;
  readonly result?: never;
  /** The error object. */
  readonly error: JsonRpcError<TData>;
}

/**
 * A JSON-RPC 2.0 response — either success or error.
 */
export type JsonRpcResponse<TResult = unknown, TData = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse<TData>;

/**
 * A JSON-RPC 2.0 notification (a request with no `id`).
 *
 * Notifications are fire-and-forget — no response is expected.
 */
export interface JsonRpcNotification<
  TMethod extends string = string,
  TParams = unknown,
> {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id?: never;
  /** The notification method name. */
  readonly method: TMethod;
  /** Structured parameters for the notification. */
  readonly params: TParams;
  /**
   * Host-issued metadata for host→worker push notifications such as events.
   * Worker→host notifications echo only `slawInvocationId`.
   */
  readonly slawInvocation?: PluginInvocationContext;
  /** Opaque top-level invocation id echoed by worker→host notifications. */
  readonly slawInvocationId?: string;
}

/**
 * Any well-formed JSON-RPC 2.0 message (request, response, or notification).
 */
export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

// ---------------------------------------------------------------------------
// Error Codes
// ---------------------------------------------------------------------------

/**
 * Standard JSON-RPC 2.0 error codes.
 *
 * @see https://www.jsonrpc.org/specification#error_object
 */
export const JSONRPC_ERROR_CODES = {
  /** Invalid JSON was received by the server. */
  PARSE_ERROR: -32700,
  /** The JSON sent is not a valid Request object. */
  INVALID_REQUEST: -32600,
  /** The method does not exist or is not available. */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameter(s). */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error. */
  INTERNAL_ERROR: -32603,
} as const;

export type JsonRpcErrorCode =
  (typeof JSONRPC_ERROR_CODES)[keyof typeof JSONRPC_ERROR_CODES];

/**
 * Slaw plugin-specific error codes.
 *
 * These live in the JSON-RPC "server error" reserved range (-32000 to -32099)
 * as specified by JSON-RPC 2.0 for implementation-defined server errors.
 *
 * @see PLUGIN_SPEC.md §19.7 — Error Propagation Through The Bridge
 */
export const PLUGIN_RPC_ERROR_CODES = {
  /** The worker process is not running or not reachable. */
  WORKER_UNAVAILABLE: -32000,
  /** The plugin does not have the required capability for this operation. */
  CAPABILITY_DENIED: -32001,
  /** The worker reported an unhandled error during method execution. */
  WORKER_ERROR: -32002,
  /** The method call timed out waiting for the worker response. */
  TIMEOUT: -32003,
  /** The worker does not implement the requested optional method. */
  METHOD_NOT_IMPLEMENTED: -32004,
  /** The worker→host call attempted to escape the current invocation squad scope. */
  INVOCATION_SCOPE_DENIED: -32005,
  /** A catch-all for errors that do not fit other categories. */
  UNKNOWN: -32099,
} as const;

export type PluginRpcErrorCode =
  (typeof PLUGIN_RPC_ERROR_CODES)[keyof typeof PLUGIN_RPC_ERROR_CODES];

// ---------------------------------------------------------------------------
// Invocation scope metadata
// ---------------------------------------------------------------------------

/**
 * Squad scope attached by the host to one top-level plugin invocation.
 * Absence of this metadata means the invocation is instance/global scoped.
 */
export interface PluginInvocationScope {
  squadId: string;
}

/**
 * Opaque invocation metadata generated by the host. Workers must not derive or
 * mutate this. They only echo the id on nested worker→host RPC calls.
 */
export interface PluginInvocationContext {
  id: string;
  scope: PluginInvocationScope;
}

/**
 * Context provided to host-side worker→host handlers after the worker echoes a
 * host-issued invocation id.
 */
export interface WorkerHostCallContext {
  invocationScope?: PluginInvocationScope | null;
  invalidInvocationScope?: boolean;
}

// ---------------------------------------------------------------------------
// Host → Worker Method Signatures (§13 Host-Worker Protocol)
// ---------------------------------------------------------------------------

/**
 * Input for the `initialize` RPC method.
 *
 * @see PLUGIN_SPEC.md §13.1 — `initialize`
 */
export interface InitializeParams {
  /** Full plugin manifest snapshot. */
  manifest: SlawPluginManifestV1;
  /** Resolved operator configuration (validated against `instanceConfigSchema`). */
  config: Record<string, unknown>;
  /** Instance-level metadata. */
  instanceInfo: {
    /** UUID of this Slaw instance. */
    instanceId: string;
    /** Semver version of the running Slaw host. */
    hostVersion: string;
  };
  /** Host API version. */
  apiVersion: number;
  /** Host-derived plugin database namespace, when the manifest declares database access. */
  databaseNamespace?: string | null;
}

/**
 * Result returned by the `initialize` RPC method.
 */
export interface InitializeResult {
  /** Whether initialization succeeded. */
  ok: boolean;
  /** Optional methods the worker has implemented (e.g. "validateConfig", "onEvent"). */
  supportedMethods?: string[];
}

/**
 * Input for the `configChanged` RPC method.
 *
 * @see PLUGIN_SPEC.md §13.4 — `configChanged`
 */
export interface ConfigChangedParams {
  /** The newly resolved configuration. */
  config: Record<string, unknown>;
}

/**
 * Input for the `validateConfig` RPC method.
 *
 * @see PLUGIN_SPEC.md §13.3 — `validateConfig`
 */
export interface ValidateConfigParams {
  /** The configuration to validate. */
  config: Record<string, unknown>;
}

/**
 * Input for the `onEvent` RPC method.
 *
 * @see PLUGIN_SPEC.md §13.5 — `onEvent`
 */
export interface OnEventParams {
  /** The domain event to deliver. */
  event: PluginEvent;
}

/**
 * Input for the `runJob` RPC method.
 *
 * @see PLUGIN_SPEC.md §13.6 — `runJob`
 */
export interface RunJobParams {
  /** Job execution context. */
  job: PluginJobContext;
}

/**
 * Input for the `getData` RPC method.
 *
 * @see PLUGIN_SPEC.md §13.8 — `getData`
 */
export interface GetDataParams {
  /** Plugin-defined data key (e.g. `"sync-health"`). */
  key: string;
  /** Host-authorized active squad scope, when this bridge call is squad-scoped. */
  squadId?: string | null;
  /** Context and query parameters from the UI. */
  params: Record<string, unknown>;
  /** Optional launcher/container metadata from the host render environment. */
  renderEnvironment?: PluginLauncherRenderContextSnapshot | null;
}

/**
 * Input for the `performAction` RPC method.
 *
 * @see PLUGIN_SPEC.md §13.9 — `performAction`
 */
export type PluginPerformActionActorType = "user" | "agent" | "system";

export interface PluginPerformActionActorContext {
  /** Authenticated principal type resolved by the Slaw host. */
  type: PluginPerformActionActorType;
  /** Authenticated operator user id when `type === "user"`, otherwise null. */
  userId: string | null;
  /** Authenticated agent id when `type === "agent"`, otherwise null. */
  agentId: string | null;
  /** Authenticated heartbeat/run id when available. */
  runId: string | null;
  /** Squad id authorized by the host bridge for this action, when applicable. */
  squadId: string | null;
}

export interface PluginPerformActionContext {
  /** Immutable authenticated actor context supplied by the host. */
  actor: Readonly<PluginPerformActionActorContext>;
  /** Convenience alias for `actor.squadId`. */
  squadId: string | null;
}

export interface PerformActionParams {
  /** Plugin-defined action key (e.g. `"resync"`). */
  key: string;
  /** Host-authorized active squad scope, when this bridge call is squad-scoped. */
  squadId?: string | null;
  /** Action parameters from the UI. */
  params: Record<string, unknown>;
  /** Authenticated actor context resolved by the host, never by caller params. */
  actorContext?: PluginPerformActionActorContext | null;
  /** Optional launcher/container metadata from the host render environment. */
  renderEnvironment?: PluginLauncherRenderContextSnapshot | null;
}

/**
 * Input for the `executeTool` RPC method.
 *
 * @see PLUGIN_SPEC.md §13.10 — `executeTool`
 */
export interface ExecuteToolParams {
  /** Tool name (without plugin namespace prefix). */
  toolName: string;
  /** Parsed parameters matching the tool's declared schema. */
  parameters: unknown;
  /** Agent run context. */
  runContext: ToolRunContext;
}

export interface PluginEnvironmentDiagnostic {
  severity: "info" | "warning" | "error";
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface PluginEnvironmentDriverBaseParams {
  driverKey: string;
  squadId: string;
  environmentId: string;
  issueId?: string | null;
  config: Record<string, unknown>;
}

export interface PluginEnvironmentValidateConfigParams {
  driverKey: string;
  config: Record<string, unknown>;
}

export interface PluginEnvironmentValidationResult {
  ok: boolean;
  warnings?: string[];
  errors?: string[];
  normalizedConfig?: Record<string, unknown>;
}

export interface PluginEnvironmentProbeParams extends PluginEnvironmentDriverBaseParams {}

export interface PluginEnvironmentProbeResult {
  ok: boolean;
  summary?: string;
  diagnostics?: PluginEnvironmentDiagnostic[];
  metadata?: Record<string, unknown>;
}

export interface PluginEnvironmentLease {
  providerLeaseId: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
}

export interface PluginEnvironmentAcquireLeaseParams extends PluginEnvironmentDriverBaseParams {
  runId: string;
  workspaceMode?: string;
  requestedCwd?: string;
}

export interface PluginEnvironmentResumeLeaseParams extends PluginEnvironmentDriverBaseParams {
  providerLeaseId: string;
  leaseMetadata?: Record<string, unknown>;
}

export interface PluginEnvironmentReleaseLeaseParams extends PluginEnvironmentDriverBaseParams {
  providerLeaseId: string | null;
  leaseMetadata?: Record<string, unknown>;
}

export interface PluginEnvironmentDestroyLeaseParams extends PluginEnvironmentReleaseLeaseParams {}

export interface PluginEnvironmentRealizeWorkspaceParams extends PluginEnvironmentDriverBaseParams {
  lease: PluginEnvironmentLease;
  workspace: {
    localPath?: string;
    remotePath?: string;
    mode?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface PluginEnvironmentRealizeWorkspaceResult {
  cwd: string;
  metadata?: Record<string, unknown>;
}

export interface PluginEnvironmentExecuteParams extends PluginEnvironmentDriverBaseParams {
  lease: PluginEnvironmentLease;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
}

export interface PluginEnvironmentExecuteResult {
  exitCode: number | null;
  signal?: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// UI launcher / modal host interaction payloads
// ---------------------------------------------------------------------------

/**
 * Bounds request issued by a plugin UI running inside a host-managed launcher
 * container such as a modal, drawer, or popover.
 */
export interface PluginModalBoundsRequest {
  /** High-level size preset requested from the host. */
  bounds: PluginLauncherBounds;
  /** Optional explicit width override in CSS pixels. */
  width?: number;
  /** Optional explicit height override in CSS pixels. */
  height?: number;
  /** Optional lower bounds for host resizing decisions. */
  minWidth?: number;
  minHeight?: number;
  /** Optional upper bounds for host resizing decisions. */
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Reason metadata supplied by host-managed close lifecycle callbacks.
 */
export interface PluginRenderCloseEvent {
  reason:
    | "escapeKey"
    | "backdrop"
    | "hostNavigation"
    | "programmatic"
    | "submit"
    | "unknown";
  nativeEvent?: unknown;
}

/**
 * Map of host→worker RPC method names to their `[params, result]` types.
 *
 * This type is the single source of truth for all methods the host can call
 * on a worker. Used by both the host dispatcher and the worker handler to
 * ensure type safety across the IPC boundary.
 */
export interface HostToWorkerMethods {
  /** @see PLUGIN_SPEC.md §13.1 */
  initialize: [params: InitializeParams, result: InitializeResult];
  /** @see PLUGIN_SPEC.md §13.2 */
  health: [params: Record<string, never>, result: PluginHealthDiagnostics];
  /** @see PLUGIN_SPEC.md §12.5 */
  shutdown: [params: Record<string, never>, result: void];
  /** @see PLUGIN_SPEC.md §13.3 */
  validateConfig: [params: ValidateConfigParams, result: PluginConfigValidationResult];
  /** @see PLUGIN_SPEC.md §13.4 */
  configChanged: [params: ConfigChangedParams, result: void];
  /** @see PLUGIN_SPEC.md §13.5 */
  onEvent: [params: OnEventParams, result: void];
  /** @see PLUGIN_SPEC.md §13.6 */
  runJob: [params: RunJobParams, result: void];
  /** @see PLUGIN_SPEC.md §13.7 */
  handleWebhook: [params: PluginWebhookInput, result: void];
  /** Scoped plugin API route dispatch. */
  handleApiRequest: [params: PluginApiRequestInput, result: PluginApiResponse];
  /** @see PLUGIN_SPEC.md §13.8 */
  getData: [params: GetDataParams, result: unknown];
  /** @see PLUGIN_SPEC.md §13.9 */
  performAction: [params: PerformActionParams, result: unknown];
  /** @see PLUGIN_SPEC.md §13.10 */
  executeTool: [params: ExecuteToolParams, result: ToolResult];
  environmentValidateConfig: [
    params: PluginEnvironmentValidateConfigParams,
    result: PluginEnvironmentValidationResult,
  ];
  environmentProbe: [
    params: PluginEnvironmentProbeParams,
    result: PluginEnvironmentProbeResult,
  ];
  environmentAcquireLease: [
    params: PluginEnvironmentAcquireLeaseParams,
    result: PluginEnvironmentLease,
  ];
  environmentResumeLease: [
    params: PluginEnvironmentResumeLeaseParams,
    result: PluginEnvironmentLease,
  ];
  environmentReleaseLease: [
    params: PluginEnvironmentReleaseLeaseParams,
    result: void,
  ];
  environmentDestroyLease: [
    params: PluginEnvironmentDestroyLeaseParams,
    result: void,
  ];
  environmentRealizeWorkspace: [
    params: PluginEnvironmentRealizeWorkspaceParams,
    result: PluginEnvironmentRealizeWorkspaceResult,
  ];
  environmentExecute: [
    params: PluginEnvironmentExecuteParams,
    result: PluginEnvironmentExecuteResult,
  ];
}

/** Union of all host→worker method names. */
export type HostToWorkerMethodName = keyof HostToWorkerMethods;

/** Required methods the worker MUST implement. */
export const HOST_TO_WORKER_REQUIRED_METHODS: readonly HostToWorkerMethodName[] = [
  "initialize",
  "health",
  "shutdown",
] as const;

/** Optional methods the worker MAY implement. */
export const HOST_TO_WORKER_OPTIONAL_METHODS: readonly HostToWorkerMethodName[] = [
  "validateConfig",
  "configChanged",
  "onEvent",
  "runJob",
  "handleWebhook",
  "handleApiRequest",
  "getData",
  "performAction",
  "executeTool",
  "environmentValidateConfig",
  "environmentProbe",
  "environmentAcquireLease",
  "environmentResumeLease",
  "environmentReleaseLease",
  "environmentDestroyLease",
  "environmentRealizeWorkspace",
  "environmentExecute",
] as const;

// ---------------------------------------------------------------------------
// Worker → Host Method Signatures (SDK client calls)
// ---------------------------------------------------------------------------

/**
 * Map of worker→host RPC method names to their `[params, result]` types.
 *
 * These represent the SDK client calls that the worker makes back to the
 * host to access platform services (state, entities, config, etc.).
 */
export interface WorkerToHostMethods {
  // Config
  "config.get": [params: Record<string, never>, result: Record<string, unknown>];

  // Trusted local folders
  "localFolders.declarations": [
    params: Record<string, never>,
    result: PluginLocalFolderDeclaration[],
  ];
  "localFolders.configure": [
    params: {
      squadId: string;
      folderKey: string;
      path: string;
      access?: "read" | "readWrite";
      requiredDirectories?: string[];
      requiredFiles?: string[];
    },
    result: PluginLocalFolderStatus,
  ];
  "localFolders.status": [
    params: { squadId: string; folderKey: string },
    result: PluginLocalFolderStatus,
  ];
  "localFolders.list": [
    params: { squadId: string; folderKey: string; relativePath?: string | null; recursive?: boolean; maxEntries?: number },
    result: PluginLocalFolderListing,
  ];
  "localFolders.readText": [
    params: { squadId: string; folderKey: string; relativePath: string },
    result: string,
  ];
  "localFolders.writeTextAtomic": [
    params: {
      squadId: string;
      folderKey: string;
      relativePath: string;
      contents: string;
    },
    result: PluginLocalFolderStatus,
  ];
  "localFolders.deleteFile": [
    params: { squadId: string; folderKey: string; relativePath: string },
    result: PluginLocalFolderStatus,
  ];

  // State
  "state.get": [
    params: { scopeKind: string; scopeId?: string; namespace?: string; stateKey: string },
    result: unknown,
  ];
  "state.set": [
    params: { scopeKind: string; scopeId?: string; namespace?: string; stateKey: string; value: unknown },
    result: void,
  ];
  "state.delete": [
    params: { scopeKind: string; scopeId?: string; namespace?: string; stateKey: string },
    result: void,
  ];

  // Restricted plugin database namespace
  "db.namespace": [
    params: Record<string, never>,
    result: string,
  ];
  "db.query": [
    params: { sql: string; params?: unknown[] },
    result: unknown[],
  ];
  "db.execute": [
    params: { sql: string; params?: unknown[] },
    result: { rowCount: number },
  ];

  // Entities
  "entities.upsert": [
    params: {
      entityType: string;
      scopeKind: PluginStateScopeKind;
      scopeId?: string;
      externalId?: string;
      title?: string;
      status?: string;
      data: Record<string, unknown>;
    },
    result: {
      id: string;
      entityType: string;
      scopeKind: PluginStateScopeKind;
      scopeId: string | null;
      externalId: string | null;
      title: string | null;
      status: string | null;
      data: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    },
  ];
  "entities.list": [
    params: {
      entityType?: string;
      scopeKind?: PluginStateScopeKind;
      scopeId?: string;
      externalId?: string;
      limit?: number;
      offset?: number;
    },
    result: Array<{
      id: string;
      entityType: string;
      scopeKind: PluginStateScopeKind;
      scopeId: string | null;
      externalId: string | null;
      title: string | null;
      status: string | null;
      data: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }>,
  ];

  // Events
  "events.emit": [
    params: { name: string; squadId: string; payload: unknown },
    result: void,
  ];
  "events.subscribe": [
    params: { eventPattern: string; filter?: Record<string, unknown> | null },
    result: void,
  ];

  // HTTP
  "http.fetch": [
    params: { url: string; init?: Record<string, unknown> },
    result: { status: number; statusText: string; headers: Record<string, string>; body: string },
  ];

  // Secrets
  "secrets.resolve": [
    params: { secretRef: string },
    result: string,
  ];

  // Activity
  "activity.log": [
    params: {
      squadId: string;
      message: string;
      entityType?: string;
      entityId?: string;
      metadata?: Record<string, unknown>;
    },
    result: void,
  ];

  // Metrics
  "metrics.write": [
    params: { name: string; value: number; tags?: Record<string, string> },
    result: void,
  ];

  // Logger
  "log": [
    params: { level: "info" | "warn" | "error" | "debug"; message: string; meta?: Record<string, unknown> },
    result: void,
  ];

  // Squads (read)
  "squads.list": [
    params: { limit?: number; offset?: number },
    result: Squad[],
  ];
  "squads.get": [
    params: { squadId: string },
    result: Squad | null,
  ];

  // Projects (read)
  "projects.list": [
    params: { squadId: string; limit?: number; offset?: number },
    result: Project[],
  ];
  "projects.get": [
    params: { projectId: string; squadId: string },
    result: Project | null,
  ];
  "projects.listWorkspaces": [
    params: { projectId: string; squadId: string },
    result: PluginWorkspace[],
  ];
  "projects.getPrimaryWorkspace": [
    params: { projectId: string; squadId: string },
    result: PluginWorkspace | null,
  ];
  "projects.getWorkspaceForIssue": [
    params: { issueId: string; squadId: string },
    result: PluginWorkspace | null,
  ];
  "executionWorkspaces.get": [
    params: {
      workspaceId: string;
      squadId: string;
    },
    result: PluginExecutionWorkspaceMetadata | null,
  ];
  "projects.managed.get": [
    params: { projectKey: string; squadId: string },
    result: PluginManagedProjectResolution,
  ];
  "projects.managed.reconcile": [
    params: { projectKey: string; squadId: string },
    result: PluginManagedProjectResolution,
  ];
  "projects.managed.reset": [
    params: { projectKey: string; squadId: string },
    result: PluginManagedProjectResolution,
  ];
  "routines.managed.get": [
    params: { routineKey: string; squadId: string },
    result: PluginManagedRoutineResolution,
  ];
  "routines.managed.reconcile": [
    params: {
      routineKey: string;
      squadId: string;
      assigneeAgentId?: string | null;
      projectId?: string | null;
    },
    result: PluginManagedRoutineResolution,
  ];
  "routines.managed.reset": [
    params: {
      routineKey: string;
      squadId: string;
      assigneeAgentId?: string | null;
      projectId?: string | null;
    },
    result: PluginManagedRoutineResolution,
  ];
  "routines.managed.update": [
    params: {
      routineKey: string;
      squadId: string;
      status?: string;
    },
    result: Routine,
  ];
  "routines.managed.run": [
    params: {
      routineKey: string;
      squadId: string;
      assigneeAgentId?: string | null;
      projectId?: string | null;
    },
    result: RoutineRun,
  ];
  "skills.managed.get": [
    params: { skillKey: string; squadId: string },
    result: PluginManagedSkillResolution,
  ];
  "skills.managed.reconcile": [
    params: { skillKey: string; squadId: string },
    result: PluginManagedSkillResolution,
  ];
  "skills.managed.reset": [
    params: { skillKey: string; squadId: string },
    result: PluginManagedSkillResolution,
  ];

  // Issues
  "issues.list": [
    params: {
      squadId: string;
      projectId?: string;
      assigneeAgentId?: string;
      originKind?: string;
      originKindPrefix?: string;
      originId?: string;
      status?: string;
      includePluginOperations?: boolean;
      limit?: number;
      offset?: number;
    },
    result: Issue[],
  ];
  "issues.get": [
    params: { issueId: string; squadId: string },
    result: Issue | null,
  ];
  "issues.create": [
    params: {
      squadId: string;
      projectId?: string;
      goalId?: string;
      parentId?: string;
      inheritExecutionWorkspaceFromIssueId?: string;
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      assigneeAgentId?: string;
      assigneeUserId?: string | null;
      requestDepth?: number;
      billingCode?: string | null;
      assigneeAdapterOverrides?: IssueAssigneeAdapterOverrides | null;
      surfaceVisibility?: string | null;
      originKind?: string | null;
      originId?: string | null;
      originRunId?: string | null;
      blockedByIssueIds?: string[];
      labelIds?: string[];
      executionWorkspaceId?: string | null;
      executionWorkspacePreference?: string | null;
      executionWorkspaceSettings?: Record<string, unknown> | null;
      actorAgentId?: string | null;
      actorUserId?: string | null;
      actorRunId?: string | null;
    },
    result: Issue,
  ];
  "issues.update": [
    params: {
      issueId: string;
      patch: Record<string, unknown>;
      squadId: string;
    },
    result: Issue,
  ];
  "issues.relations.get": [
    params: { issueId: string; squadId: string },
    result: PluginIssueRelationSummary,
  ];
  "issues.relations.setBlockedBy": [
    params: {
      issueId: string;
      squadId: string;
      blockedByIssueIds: string[];
      actorAgentId?: string | null;
      actorUserId?: string | null;
      actorRunId?: string | null;
    },
    result: PluginIssueRelationSummary,
  ];
  "issues.relations.addBlockers": [
    params: {
      issueId: string;
      squadId: string;
      blockerIssueIds: string[];
      actorAgentId?: string | null;
      actorUserId?: string | null;
      actorRunId?: string | null;
    },
    result: PluginIssueRelationSummary,
  ];
  "issues.relations.removeBlockers": [
    params: {
      issueId: string;
      squadId: string;
      blockerIssueIds: string[];
      actorAgentId?: string | null;
      actorUserId?: string | null;
      actorRunId?: string | null;
    },
    result: PluginIssueRelationSummary,
  ];
  "issues.assertCheckoutOwner": [
    params: {
      issueId: string;
      squadId: string;
      actorAgentId: string;
      actorRunId: string;
    },
    result: PluginIssueCheckoutOwnership,
  ];
  "issues.getSubtree": [
    params: {
      issueId: string;
      squadId: string;
      includeRoot?: boolean;
      includeRelations?: boolean;
      includeDocuments?: boolean;
      includeActiveRuns?: boolean;
      includeAssignees?: boolean;
    },
    result: PluginIssueSubtree,
  ];
  "issues.requestWakeup": [
    params: {
      issueId: string;
      squadId: string;
      reason?: string;
      contextSource?: string;
      idempotencyKey?: string | null;
      actorAgentId?: string | null;
      actorUserId?: string | null;
      actorRunId?: string | null;
    },
    result: PluginIssueWakeupResult,
  ];
  "issues.requestWakeups": [
    params: {
      issueIds: string[];
      squadId: string;
      reason?: string;
      contextSource?: string;
      idempotencyKeyPrefix?: string | null;
      actorAgentId?: string | null;
      actorUserId?: string | null;
      actorRunId?: string | null;
    },
    result: PluginIssueWakeupBatchResult[],
  ];
  "issues.summaries.getOrchestration": [
    params: {
      issueId: string;
      squadId: string;
      includeSubtree?: boolean;
      billingCode?: string | null;
    },
    result: PluginIssueOrchestrationSummary,
  ];
  "issues.listComments": [
    params: { issueId: string; squadId: string },
    result: IssueComment[],
  ];
  "issues.createComment": [
    params: { issueId: string; body: string; squadId: string; authorAgentId?: string },
    result: IssueComment,
  ];
  "issues.createInteraction": [
    params: {
      issueId: string;
      squadId: string;
      interaction: CreateIssueThreadInteraction;
      authorAgentId?: string | null;
    },
    result: IssueThreadInteraction,
  ];

  // Issue Documents
  "issues.documents.list": [
    params: { issueId: string; squadId: string },
    result: IssueDocumentSummary[],
  ];
  "issues.documents.get": [
    params: { issueId: string; key: string; squadId: string },
    result: IssueDocument | null,
  ];
  "issues.documents.upsert": [
    params: {
      issueId: string;
      key: string;
      body: string;
      squadId: string;
      title?: string;
      format?: string;
      changeSummary?: string;
    },
    result: IssueDocument,
  ];
  "issues.documents.delete": [
    params: { issueId: string; key: string; squadId: string },
    result: void,
  ];

  // Agents (read)
  "agents.list": [
    params: { squadId: string; status?: string; limit?: number; offset?: number },
    result: Agent[],
  ];
  "agents.get": [
    params: { agentId: string; squadId: string },
    result: Agent | null,
  ];

  // Agents (write)
  "agents.pause": [
    params: { agentId: string; squadId: string },
    result: Agent,
  ];
  "agents.resume": [
    params: { agentId: string; squadId: string },
    result: Agent,
  ];
  "agents.invoke": [
    params: { agentId: string; squadId: string; prompt: string; reason?: string },
    result: { runId: string },
  ];
  "agents.managed.get": [
    params: { agentKey: string; squadId: string },
    result: PluginManagedAgentResolution,
  ];
  "agents.managed.reconcile": [
    params: { agentKey: string; squadId: string },
    result: PluginManagedAgentResolution,
  ];
  "agents.managed.reset": [
    params: { agentKey: string; squadId: string },
    result: PluginManagedAgentResolution,
  ];

  // Agent Sessions
  "agents.sessions.create": [
    params: { agentId: string; squadId: string; taskKey?: string; reason?: string },
    result: { sessionId: string; agentId: string; squadId: string; status: "active" | "closed"; createdAt: string },
  ];
  "agents.sessions.list": [
    params: { agentId: string; squadId: string },
    result: Array<{ sessionId: string; agentId: string; squadId: string; status: "active" | "closed"; createdAt: string }>,
  ];
  "agents.sessions.sendMessage": [
    params: { sessionId: string; squadId: string; prompt: string; reason?: string },
    result: { runId: string },
  ];
  "agents.sessions.close": [
    params: { sessionId: string; squadId: string },
    result: void,
  ];

  // Goals
  "goals.list": [
    params: { squadId: string; level?: string; status?: string; limit?: number; offset?: number },
    result: Goal[],
  ];
  "goals.get": [
    params: { goalId: string; squadId: string },
    result: Goal | null,
  ];
  "goals.create": [
    params: {
      squadId: string;
      title: string;
      description?: string;
      level?: string;
      status?: string;
      parentId?: string;
      ownerAgentId?: string;
    },
    result: Goal,
  ];
  "goals.update": [
    params: {
      goalId: string;
      patch: Record<string, unknown>;
      squadId: string;
    },
    result: Goal,
  ];

  // Access
  "access.members.list": [
    params: { squadId: string; includeArchived?: boolean },
    result: PluginAccessMember[],
  ];
  "access.members.get": [
    params: { memberId: string; squadId: string },
    result: PluginAccessMember | null,
  ];
  "access.members.update": [
    params: {
      memberId: string;
      squadId: string;
      patch: {
        membershipRole?: string | null;
        status?: "pending" | "active" | "suspended";
      };
    },
    result: PluginAccessMember,
  ];
  "access.invites.list": [
    params: {
      squadId: string;
      state?: "active" | "revoked" | "accepted" | "expired";
      limit?: number;
      offset?: number;
    },
    result: { invites: PluginAccessInvite[]; nextOffset: number | null },
  ];
  "access.invites.create": [
    params: {
      squadId: string;
      allowedJoinTypes?: "human" | "agent" | "both";
      humanRole?: string | null;
      defaultsPayload?: Record<string, unknown> | null;
      agentMessage?: string | null;
    },
    result: PluginAccessInvite & { token: string },
  ];
  "access.invites.revoke": [
    params: { inviteId: string; squadId: string },
    result: PluginAccessInvite,
  ];

  // Authorization
  "authorization.grants.list": [
    params: { squadId: string; principalType?: string; principalId?: string },
    result: PrincipalPermissionGrant[],
  ];
  "authorization.grants.set": [
    params: {
      squadId: string;
      principalType: string;
      principalId: string;
      grants: Array<{ permissionKey: string; scope?: Record<string, unknown> | null }>;
      grantedByUserId?: string | null;
    },
    result: PrincipalPermissionGrant[],
  ];
  "authorization.policies.summary": [
    params: { squadId: string },
    result: PluginAuthorizationPolicySummary,
  ];
  "authorization.policies.get": [
    params: { squadId: string; resourceType: "squad" | "agent" | "project" | "issue"; resourceId: string },
    result: PluginAuthorizationPolicyRecord | null,
  ];
  "authorization.policies.update": [
    params: {
      squadId: string;
      resourceType: "squad" | "agent" | "project" | "issue";
      resourceId: string;
      policy: Record<string, unknown> | null;
    },
    result: PluginAuthorizationPolicyRecord,
  ];
  "authorization.policies.previewAssignment": [
    params: PluginAssignmentPreviewInput,
    result: PluginAuthorizationDecisionResult,
  ];
  "authorization.policies.explainAssignment": [
    params: PluginAssignmentPreviewInput,
    result: PluginAuthorizationDecisionResult,
  ];
  "authorization.audit.search": [
    params: {
      squadId: string;
      action?: string;
      actorType?: string;
      actorId?: string;
      entityType?: string;
      entityId?: string;
      decision?: string;
      limit?: number;
      offset?: number;
    },
    result: PluginAuthorizationAuditEntry[],
  ];
}

/** Union of all worker→host method names. */
export type WorkerToHostMethodName = keyof WorkerToHostMethods;

// ---------------------------------------------------------------------------
// Worker→Host Notification Types (fire-and-forget, no response)
// ---------------------------------------------------------------------------

/**
 * Typed parameter shapes for worker→host JSON-RPC notifications.
 *
 * Notifications are fire-and-forget — the worker does not wait for a response.
 * These are used for streaming events and logging, not for request-response RPCs.
 */
export interface WorkerToHostNotifications {
  /**
   * Forward a stream event to connected SSE clients.
   *
   * Emitted by the worker for each event on a stream channel. The host
   * publishes to the PluginStreamBus, which fans out to all SSE clients
   * subscribed to the (pluginId, channel, squadId) tuple.
   *
   * The `event` payload is JSON-serializable and sent as SSE `data:`.
   * The default SSE event type is `"message"`.
   */
  "streams.emit": {
    channel: string;
    squadId: string;
    event: unknown;
  };

  /**
   * Signal that a stream channel has been opened.
   *
   * Emitted when the worker calls `ctx.streams.open(channel, squadId)`.
   * UI clients may use this to display a "connected" indicator or begin
   * buffering input. The host tracks open channels so it can emit synthetic
   * close events if the worker crashes.
   */
  "streams.open": {
    channel: string;
    squadId: string;
  };

  /**
   * Signal that a stream channel has been closed.
   *
   * Emitted when the worker calls `ctx.streams.close(channel)`, or
   * synthetically by the host when a worker process exits with channels
   * still open. UI clients should treat this as terminal and disconnect
   * the SSE connection.
   */
  "streams.close": {
    channel: string;
    squadId: string;
  };
}

/** Union of all worker→host notification method names. */
export type WorkerToHostNotificationName = keyof WorkerToHostNotifications;

// ---------------------------------------------------------------------------
// Typed Request / Response Helpers
// ---------------------------------------------------------------------------

/**
 * A typed JSON-RPC request for a specific host→worker method.
 */
export type HostToWorkerRequest<M extends HostToWorkerMethodName> =
  JsonRpcRequest<M, HostToWorkerMethods[M][0]>;

/**
 * A typed JSON-RPC success response for a specific host→worker method.
 */
export type HostToWorkerResponse<M extends HostToWorkerMethodName> =
  JsonRpcSuccessResponse<HostToWorkerMethods[M][1]>;

/**
 * A typed JSON-RPC request for a specific worker→host method.
 */
export type WorkerToHostRequest<M extends WorkerToHostMethodName> =
  JsonRpcRequest<M, WorkerToHostMethods[M][0]>;

/**
 * A typed JSON-RPC success response for a specific worker→host method.
 */
export type WorkerToHostResponse<M extends WorkerToHostMethodName> =
  JsonRpcSuccessResponse<WorkerToHostMethods[M][1]>;

// ---------------------------------------------------------------------------
// Message Factory Functions
// ---------------------------------------------------------------------------

/** Counter for generating unique request IDs when no explicit ID is provided. */
let _nextId = 1;

/** Wrap around before reaching Number.MAX_SAFE_INTEGER to prevent precision loss. */
const MAX_SAFE_RPC_ID = Number.MAX_SAFE_INTEGER - 1;

/**
 * Create a JSON-RPC 2.0 request message.
 *
 * @param method - The RPC method name
 * @param params - Structured parameters
 * @param id - Optional explicit request ID (auto-generated if omitted)
 */
export function createRequest<TMethod extends string>(
  method: TMethod,
  params: unknown,
  id?: JsonRpcId,
): JsonRpcRequest<TMethod> {
  if (_nextId >= MAX_SAFE_RPC_ID) {
    _nextId = 1;
  }
  return {
    jsonrpc: JSONRPC_VERSION,
    id: id ?? _nextId++,
    method,
    params,
  };
}

/**
 * Create a JSON-RPC 2.0 success response.
 *
 * @param id - The request ID being responded to
 * @param result - The result value
 */
export function createSuccessResponse<TResult>(
  id: JsonRpcId,
  result: TResult,
): JsonRpcSuccessResponse<TResult> {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    result,
  };
}

/**
 * Create a JSON-RPC 2.0 error response.
 *
 * @param id - The request ID being responded to (null if the request ID could not be determined)
 * @param code - Machine-readable error code
 * @param message - Human-readable error message
 * @param data - Optional structured error data
 */
export function createErrorResponse<TData = unknown>(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: TData,
): JsonRpcErrorResponse<TData> {
  const response: JsonRpcErrorResponse<TData> = {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: data !== undefined
      ? { code, message, data }
      : { code, message } as JsonRpcError<TData>,
  };
  return response;
}

/**
 * Create a JSON-RPC 2.0 notification (fire-and-forget, no response expected).
 *
 * @param method - The notification method name
 * @param params - Structured parameters
 */
export function createNotification<TMethod extends string>(
  method: TMethod,
  params: unknown,
): JsonRpcNotification<TMethod> {
  return {
    jsonrpc: JSONRPC_VERSION,
    method,
    params,
  };
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

/**
 * Check whether a value is a well-formed JSON-RPC 2.0 request.
 *
 * A request has `jsonrpc: "2.0"`, a string `method`, and an `id`.
 */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.jsonrpc === JSONRPC_VERSION &&
    typeof obj.method === "string" &&
    "id" in obj &&
    obj.id !== undefined &&
    obj.id !== null
  );
}

/**
 * Check whether a value is a well-formed JSON-RPC 2.0 notification.
 *
 * A notification has `jsonrpc: "2.0"`, a string `method`, but no `id`.
 */
export function isJsonRpcNotification(
  value: unknown,
): value is JsonRpcNotification {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.jsonrpc === JSONRPC_VERSION &&
    typeof obj.method === "string" &&
    !("id" in obj)
  );
}

/**
 * Check whether a value is a well-formed JSON-RPC 2.0 response (success or error).
 */
export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.jsonrpc === JSONRPC_VERSION &&
    "id" in obj &&
    ("result" in obj || "error" in obj)
  );
}

/**
 * Check whether a JSON-RPC response is a success response.
 */
export function isJsonRpcSuccessResponse(
  response: JsonRpcResponse,
): response is JsonRpcSuccessResponse {
  return "result" in response && !("error" in response && response.error !== undefined);
}

/**
 * Check whether a JSON-RPC response is an error response.
 */
export function isJsonRpcErrorResponse(
  response: JsonRpcResponse,
): response is JsonRpcErrorResponse {
  return "error" in response && response.error !== undefined;
}

// ---------------------------------------------------------------------------
// Serialization Helpers
// ---------------------------------------------------------------------------

/**
 * Line delimiter for JSON-RPC messages over stdio.
 *
 * Each message is a single line of JSON terminated by a newline character.
 * This follows the newline-delimited JSON (NDJSON) convention.
 */
export const MESSAGE_DELIMITER = "\n" as const;

/**
 * Serialize a JSON-RPC message to a newline-delimited string for transmission
 * over stdio.
 *
 * @param message - Any JSON-RPC message (request, response, or notification)
 * @returns The JSON string terminated with a newline
 */
export function serializeMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message) + MESSAGE_DELIMITER;
}

/**
 * Parse a JSON string into a JSON-RPC message.
 *
 * Returns the parsed message or throws a `JsonRpcParseError` if the input
 * is not valid JSON or does not conform to the JSON-RPC 2.0 structure.
 *
 * @param line - A single line of JSON text (with or without trailing newline)
 * @returns The parsed JSON-RPC message
 * @throws {JsonRpcParseError} If parsing fails
 */
export function parseMessage(line: string): JsonRpcMessage {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    throw new JsonRpcParseError("Empty message");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new JsonRpcParseError(`Invalid JSON: ${trimmed.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new JsonRpcParseError("Message must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.jsonrpc !== JSONRPC_VERSION) {
    throw new JsonRpcParseError(
      `Invalid or missing jsonrpc version (expected "${JSONRPC_VERSION}", got ${JSON.stringify(obj.jsonrpc)})`,
    );
  }

  // It's a valid JSON-RPC 2.0 envelope — return as-is and let the caller
  // use the type guards for more specific classification.
  return parsed as JsonRpcMessage;
}

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

/**
 * Error thrown when a JSON-RPC message cannot be parsed.
 */
export class JsonRpcParseError extends Error {
  override readonly name = "JsonRpcParseError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Error thrown when a JSON-RPC call fails with a structured error response.
 *
 * Captures the full `JsonRpcError` so callers can inspect the code and data.
 */
export class JsonRpcCallError extends Error {
  override readonly name = "JsonRpcCallError";
  /** The JSON-RPC error code. */
  readonly code: number;
  /** Optional structured error data from the response. */
  readonly data: unknown;

  constructor(error: JsonRpcError) {
    super(error.message);
    this.code = error.code;
    this.data = error.data;
  }
}

// ---------------------------------------------------------------------------
// Reset helper (testing only)
// ---------------------------------------------------------------------------

/**
 * Reset the internal request ID counter. **For testing only.**
 *
 * @internal
 */
export function _resetIdCounter(): void {
  _nextId = 1;
}
