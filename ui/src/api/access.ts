import type { AgentAdapterType, JoinRequest, PermissionKey } from "@slaw-ai/shared";
import { api } from "./client";

export type HumanSquadRole = "owner" | "admin" | "operator" | "viewer";

type InviteSummary = {
  id: string;
  squadId: string | null;
  squadName?: string | null;
  squadLogoUrl?: string | null;
  squadBrandColor?: string | null;
  inviteType: "squad_join" | "bootstrap_squad_lead";
  allowedJoinTypes: "human" | "agent" | "both";
  humanRole?: HumanSquadRole | null;
  expiresAt: string;
  onboardingPath?: string;
  onboardingUrl?: string;
  onboardingTextPath?: string;
  onboardingTextUrl?: string;
  skillIndexPath?: string;
  skillIndexUrl?: string;
  inviteMessage?: string | null;
  invitedByUserName?: string | null;
  joinRequestStatus?: JoinRequest["status"] | null;
  joinRequestType?: JoinRequest["requestType"] | null;
};

type AcceptInviteInput =
  | { requestType: "human" }
  | {
    requestType: "agent";
    agentName: string;
    adapterType?: AgentAdapterType;
    capabilities?: string | null;
    agentDefaultsPayload?: Record<string, unknown> | null;
  };

type AgentJoinRequestAccepted = JoinRequest & {
  claimSecret: string;
  claimApiKeyPath: string;
  onboarding?: Record<string, unknown>;
  diagnostics?: Array<{
    code: string;
    level: "info" | "warn";
    message: string;
    hint?: string;
  }>;
};

type InviteOnboardingManifest = {
  invite: InviteSummary;
  onboarding: {
    inviteMessage?: string | null;
    connectivity?: {
      guidance?: string;
      connectionCandidates?: string[];
      testResolutionEndpoint?: {
        method?: string;
        path?: string;
        url?: string;
      };
    };
    textInstructions?: {
      url?: string;
    };
  };
};

type InstanceClaimStatus = {
  status: "available" | "claimed" | "expired";
  requiresSignIn: boolean;
  expiresAt: string | null;
  claimedByUserId: string | null;
};

type CliAuthChallengeStatus = {
  id: string;
  status: "pending" | "approved" | "cancelled" | "expired";
  command: string;
  clientName: string | null;
  requestedAccess: "operator" | "instance_admin_required";
  requestedSquadId: string | null;
  requestedSquadName: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  approvedByUser: { id: string; name: string; email: string } | null;
  requiresSignIn: boolean;
  canApprove: boolean;
  currentUserId: string | null;
};

type SquadInviteCreated = {
  id: string;
  token: string;
  inviteUrl: string;
  expiresAt: string;
  allowedJoinTypes: "human" | "agent" | "both";
  humanRole?: HumanSquadRole | null;
  squadName?: string | null;
  onboardingTextPath?: string;
  onboardingTextUrl?: string;
  inviteMessage?: string | null;
};

export type SquadMemberGrant = {
  id: string;
  squadId: string;
  principalType: "user";
  principalId: string;
  permissionKey: PermissionKey;
  scope: Record<string, unknown> | null;
  grantedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SquadMember = {
  id: string;
  squadId: string;
  principalType: "user";
  principalId: string;
  status: "pending" | "active" | "suspended" | "archived";
  membershipRole: HumanSquadRole | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string | null; name: string | null; image: string | null } | null;
  grants: SquadMemberGrant[];
  removal?: {
    canArchive: boolean;
    reason: string | null;
  };
};

export type ArchiveSquadMemberResponse = {
  member: SquadMember;
  reassignedIssueCount: number;
};

export type SquadMembersResponse = {
  members: SquadMember[];
  access: {
    currentUserRole: HumanSquadRole | null;
    canManageMembers: boolean;
    canInviteUsers: boolean;
    canApproveJoinRequests: boolean;
  };
};

export type SquadUserDirectoryEntry = {
  principalId: string;
  status: "active";
  user: { id: string; email: string | null; name: string | null; image: string | null } | null;
};

export type SquadUserDirectoryResponse = {
  users: SquadUserDirectoryEntry[];
};

export type SquadInviteRecord = {
  id: string;
  squadId: string | null;
  squadName: string | null;
  inviteType: "squad_join" | "bootstrap_squad_lead";
  allowedJoinTypes: "human" | "agent" | "both";
  humanRole: HumanSquadRole | null;
  defaultsPayload: Record<string, unknown> | null;
  expiresAt: string;
  invitedByUserId: string | null;
  revokedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
  inviteMessage: string | null;
  state: "active" | "revoked" | "accepted" | "expired";
  invitedByUser: { id: string; email: string | null; name: string | null; image: string | null } | null;
  relatedJoinRequestId: string | null;
};

export type SquadInviteListResponse = {
  invites: SquadInviteRecord[];
  nextOffset: number | null;
};

export type SquadJoinRequest = JoinRequest & {
  requesterUser: { id: string; email: string | null; name: string | null; image: string | null } | null;
  approvedByUser: { id: string; email: string | null; name: string | null; image: string | null } | null;
  rejectedByUser: { id: string; email: string | null; name: string | null; image: string | null } | null;
  invite: {
    id: string;
    inviteType: "squad_join" | "bootstrap_squad_lead";
    allowedJoinTypes: "human" | "agent" | "both";
    humanRole: HumanSquadRole | null;
    inviteMessage: string | null;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
    acceptedAt: string | null;
    invitedByUser: { id: string; email: string | null; name: string | null; image: string | null } | null;
  } | null;
};

export type AdminUserDirectoryEntry = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  isInstanceAdmin: boolean;
  activeSquadMembershipCount: number;
};

export type UserSquadAccessEntry = {
  id: string;
  squadId: string;
  principalType: "user";
  principalId: string;
  status: "pending" | "active" | "suspended" | "archived";
  membershipRole: HumanSquadRole | "member" | null;
  createdAt: string;
  updatedAt: string;
  squadName: string | null;
  squadStatus: "active" | "paused" | "archived" | null;
};

export type UserSquadAccessResponse = {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    image: string | null;
    isInstanceAdmin: boolean;
  } | null;
  squadAccess: UserSquadAccessEntry[];
};

export type CurrentOperatorAccess = {
  user: { id: string; email: string | null; name: string | null; image: string | null } | null;
  userId: string;
  isInstanceAdmin: boolean;
  squadIds: string[];
  memberships?: Array<{
    squadId: string;
    membershipRole: HumanSquadRole | "member" | null;
    status: "pending" | "active" | "suspended" | "archived";
  }>;
  source: string;
  keyId: string | null;
};

function buildInviteListQuery(options: {
  state?: "active" | "revoked" | "accepted" | "expired";
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (options.state) params.set("state", options.state);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const accessApi = {
  createSquadInvite: (
    squadId: string,
    input: {
      allowedJoinTypes?: "human" | "agent" | "both";
      humanRole?: HumanSquadRole | null;
      defaultsPayload?: Record<string, unknown> | null;
      agentMessage?: string | null;
    } = {},
  ) =>
    api.post<SquadInviteCreated>(`/squads/${squadId}/invites`, input),

  getInvite: (token: string) => api.get<InviteSummary>(`/invites/${token}`),
  getInviteOnboarding: (token: string) =>
    api.get<InviteOnboardingManifest>(`/invites/${token}/onboarding`),

  acceptInvite: (token: string, input: AcceptInviteInput) =>
    api.post<AgentJoinRequestAccepted | JoinRequest | { bootstrapAccepted: true; userId: string }>(
      `/invites/${token}/accept`,
      input,
    ),

  listInvites: (
    squadId: string,
    options: {
      state?: "active" | "revoked" | "accepted" | "expired";
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    api.get<SquadInviteListResponse>(
      `/squads/${squadId}/invites${buildInviteListQuery(options)}`,
    ),

  revokeInvite: (inviteId: string) => api.post(`/invites/${inviteId}/revoke`, {}),

  listJoinRequests: (
    squadId: string,
    status: "pending_approval" | "approved" | "rejected" = "pending_approval",
    requestType?: "human" | "agent",
  ) =>
    api.get<SquadJoinRequest[]>(
      `/squads/${squadId}/join-requests?status=${status}${requestType ? `&requestType=${requestType}` : ""}`,
    ),

  listMembers: (squadId: string) =>
    api.get<SquadMembersResponse>(`/squads/${squadId}/members`),

  listUserDirectory: (squadId: string) =>
    api.get<SquadUserDirectoryResponse>(`/squads/${squadId}/user-directory`),

  updateMember: (
    squadId: string,
    memberId: string,
    input: {
      membershipRole?: HumanSquadRole | null;
      status?: "pending" | "active" | "suspended";
    },
  ) => api.patch<SquadMember>(`/squads/${squadId}/members/${memberId}`, input),

  updateMemberPermissions: (
    squadId: string,
    memberId: string,
    input: {
      grants: Array<{
        permissionKey: PermissionKey;
        scope?: Record<string, unknown> | null;
      }>;
    },
  ) => api.patch<SquadMember>(`/squads/${squadId}/members/${memberId}/permissions`, input),

  updateMemberAccess: (
    squadId: string,
    memberId: string,
    input: {
      membershipRole?: HumanSquadRole | null;
      status?: "pending" | "active" | "suspended";
      grants: Array<{
        permissionKey: PermissionKey;
        scope?: Record<string, unknown> | null;
      }>;
    },
  ) => api.patch<SquadMember>(`/squads/${squadId}/members/${memberId}/role-and-grants`, input),

  archiveMember: (
    squadId: string,
    memberId: string,
    input: {
      reassignment?: {
        assigneeAgentId?: string | null;
        assigneeUserId?: string | null;
      } | null;
    } = {},
  ) => api.post<ArchiveSquadMemberResponse>(`/squads/${squadId}/members/${memberId}/archive`, input),

  approveJoinRequest: (squadId: string, requestId: string) =>
    api.post<JoinRequest>(`/squads/${squadId}/join-requests/${requestId}/approve`, {}),

  rejectJoinRequest: (squadId: string, requestId: string) =>
    api.post<JoinRequest>(`/squads/${squadId}/join-requests/${requestId}/reject`, {}),

  claimJoinRequestApiKey: (requestId: string, claimSecret: string) =>
    api.post<{ keyId: string; token: string; agentId: string; createdAt: string }>(
      `/join-requests/${requestId}/claim-api-key`,
      { claimSecret },
    ),

  getInstanceClaimStatus: (token: string, code: string) =>
    api.get<InstanceClaimStatus>(`/instance-claim/${token}?code=${encodeURIComponent(code)}`),

  claimInstance: (token: string, code: string) =>
    api.post<{ claimed: true; userId: string }>(`/instance-claim/${token}/claim`, { code }),

  claimBootstrapAdmin: () =>
    api.post<{ claimed: true; userId: string }>("/bootstrap/claim", {}),

  getCliAuthChallenge: (id: string, token: string) =>
    api.get<CliAuthChallengeStatus>(`/cli-auth/challenges/${id}?token=${encodeURIComponent(token)}`),

  approveCliAuthChallenge: (id: string, token: string) =>
    api.post<{ approved: boolean; status: string; userId: string; keyId: string | null; expiresAt: string }>(
      `/cli-auth/challenges/${id}/approve`,
      { token },
    ),

  cancelCliAuthChallenge: (id: string, token: string) =>
    api.post<{ cancelled: boolean; status: string }>(`/cli-auth/challenges/${id}/cancel`, { token }),

  searchAdminUsers: (query: string) =>
    api.get<AdminUserDirectoryEntry[]>(`/admin/users?query=${encodeURIComponent(query)}`),

  promoteInstanceAdmin: (userId: string) =>
    api.post(`/admin/users/${userId}/promote-instance-admin`, {}),

  demoteInstanceAdmin: (userId: string) =>
    api.post(`/admin/users/${userId}/demote-instance-admin`, {}),

  getUserSquadAccess: (userId: string) =>
    api.get<UserSquadAccessResponse>(`/admin/users/${userId}/squad-access`),

  setUserSquadAccess: (userId: string, squadIds: string[]) =>
    api.put<UserSquadAccessResponse>(`/admin/users/${userId}/squad-access`, { squadIds }),

  getCurrentOperatorAccess: () =>
    api.get<CurrentOperatorAccess>("/cli-auth/me"),
};
