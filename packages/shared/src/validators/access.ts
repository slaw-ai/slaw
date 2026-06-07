import { z } from "zod";
import {
  AGENT_ADAPTER_TYPES,
  HUMAN_SQUAD_MEMBERSHIP_ROLES,
  INVITE_JOIN_TYPES,
  JOIN_REQUEST_STATUSES,
  JOIN_REQUEST_TYPES,
  PERMISSION_KEYS,
} from "../constants.js";
import { optionalAgentAdapterTypeSchema } from "../adapter-type.js";

export const createSquadInviteSchema = z.object({
  allowedJoinTypes: z.enum(INVITE_JOIN_TYPES).default("both"),
  humanRole: z.enum(HUMAN_SQUAD_MEMBERSHIP_ROLES).optional().nullable(),
  defaultsPayload: z.record(z.string(), z.unknown()).optional().nullable(),
  agentMessage: z.string().max(4000).optional().nullable(),
});

export type CreateSquadInvite = z.infer<typeof createSquadInviteSchema>;

export const acceptInviteSchema = z.object({
  requestType: z.enum(JOIN_REQUEST_TYPES),
  agentName: z.string().min(1).max(120).optional(),
  adapterType: optionalAgentAdapterTypeSchema,
  capabilities: z.string().max(4000).optional().nullable(),
  agentDefaultsPayload: z.record(z.string(), z.unknown()).optional().nullable(),
  slawApiUrl: z.string().max(4000).optional().nullable(),
});

export type AcceptInvite = z.infer<typeof acceptInviteSchema>;

export const listJoinRequestsQuerySchema = z.object({
  status: z.enum(JOIN_REQUEST_STATUSES).optional(),
  requestType: z.enum(JOIN_REQUEST_TYPES).optional(),
});

export type ListJoinRequestsQuery = z.infer<typeof listJoinRequestsQuerySchema>;

export const listSquadInvitesQuerySchema = z.object({
  state: z.enum(["active", "revoked", "accepted", "expired"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ListSquadInvitesQuery = z.infer<typeof listSquadInvitesQuerySchema>;

export const claimJoinRequestApiKeySchema = z.object({
  claimSecret: z.string().min(16).max(256),
});

export type ClaimJoinRequestApiKey = z.infer<typeof claimJoinRequestApiKeySchema>;

export const operatorCliAuthAccessLevelSchema = z.enum([
  "operator",
  "instance_admin_required",
]);

export type OperatorCliAuthAccessLevel = z.infer<typeof operatorCliAuthAccessLevelSchema>;

export const createCliAuthChallengeSchema = z.object({
  command: z.string().min(1).max(240),
  clientName: z.string().max(120).optional().nullable(),
  requestedAccess: operatorCliAuthAccessLevelSchema.default("operator"),
  requestedSquadId: z.string().uuid().optional().nullable(),
});

export type CreateCliAuthChallenge = z.infer<typeof createCliAuthChallengeSchema>;

export const resolveCliAuthChallengeSchema = z.object({
  token: z.string().min(16).max(256),
});

export type ResolveCliAuthChallenge = z.infer<typeof resolveCliAuthChallengeSchema>;

export const createOperatorApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120).default("slaw cli"),
  expiresAt: z.coerce.date().optional().nullable(),
  requestedSquadId: z.string().uuid().optional().nullable(),
});

export type CreateOperatorApiKey = z.infer<typeof createOperatorApiKeySchema>;

export const updateMemberPermissionsSchema = z.object({
  grants: z.array(
    z.object({
      permissionKey: z.enum(PERMISSION_KEYS),
      scope: z.record(z.string(), z.unknown()).optional().nullable(),
    }),
  ),
});

export type UpdateMemberPermissions = z.infer<typeof updateMemberPermissionsSchema>;

const editableMembershipStatuses = ["pending", "active", "suspended"] as const;

export const updateSquadMemberSchema = z.object({
  membershipRole: z.enum(HUMAN_SQUAD_MEMBERSHIP_ROLES).optional().nullable(),
  status: z.enum(editableMembershipStatuses).optional(),
}).refine((value) => value.membershipRole !== undefined || value.status !== undefined, {
  message: "membershipRole or status is required",
});

export type UpdateSquadMember = z.infer<typeof updateSquadMemberSchema>;

export const updateSquadMemberWithPermissionsSchema = z.object({
  membershipRole: z.enum(HUMAN_SQUAD_MEMBERSHIP_ROLES).optional().nullable(),
  status: z.enum(editableMembershipStatuses).optional(),
  grants: updateMemberPermissionsSchema.shape.grants.default([]),
}).refine((value) => value.membershipRole !== undefined || value.status !== undefined, {
  message: "membershipRole or status is required",
});

export type UpdateSquadMemberWithPermissions = z.infer<typeof updateSquadMemberWithPermissionsSchema>;

export const archiveSquadMemberSchema = z.object({
  reassignment: z
    .object({
      assigneeAgentId: z.string().uuid().optional().nullable(),
      assigneeUserId: z.string().uuid().optional().nullable(),
    })
    .optional()
    .nullable(),
}).superRefine((value, ctx) => {
  if (value.reassignment?.assigneeAgentId && value.reassignment.assigneeUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose either an agent or user reassignment target",
      path: ["reassignment"],
    });
  }
});

export type ArchiveSquadMember = z.infer<typeof archiveSquadMemberSchema>;

export const updateUserSquadAccessSchema = z.object({
  squadIds: z.array(z.string().uuid()).default([]),
});

export type UpdateUserSquadAccess = z.infer<typeof updateUserSquadAccessSchema>;

export const searchAdminUsersQuerySchema = z.object({
  query: z.string().trim().max(120).optional().default(""),
});

export type SearchAdminUsersQuery = z.infer<typeof searchAdminUsersQuerySchema>;

const profileImageAssetPathPattern = /^\/api\/assets\/[^/?#]+\/content(?:\?[^#]*)?(?:#.*)?$/;

function isValidProfileImage(value: string): boolean {
  if (profileImageAssetPathPattern.test(value)) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const profileImageSchema = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine(isValidProfileImage, { message: "Invalid profile image URL" });

export const currentUserProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().nullable(),
  name: z.string().min(1).max(120).nullable(),
  image: profileImageSchema.nullable(),
});

export type CurrentUserProfile = z.infer<typeof currentUserProfileSchema>;

export const authSessionSchema = z.object({
  session: z.object({
    id: z.string().min(1),
    userId: z.string().min(1),
  }),
  user: currentUserProfileSchema,
});

export type AuthSession = z.infer<typeof authSessionSchema>;

export const updateCurrentUserProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  image: z
    .union([profileImageSchema, z.literal(""), z.null()])
    .optional()
    .transform((value) => value === "" ? null : value),
});

export type UpdateCurrentUserProfile = z.infer<typeof updateCurrentUserProfileSchema>;
