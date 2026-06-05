import { PERMISSION_KEYS } from "@slaw/shared";
import type { HumanSquadMembershipRole } from "@slaw/shared";

const HUMAN_SQUAD_MEMBERSHIP_ROLES: HumanSquadMembershipRole[] = [
  "owner",
  "admin",
  "operator",
  "viewer",
];

export function normalizeHumanRole(
  value: unknown,
  fallback: HumanSquadMembershipRole = "operator"
): HumanSquadMembershipRole {
  if (value === "member") return "operator";
  return HUMAN_SQUAD_MEMBERSHIP_ROLES.includes(value as HumanSquadMembershipRole)
    ? (value as HumanSquadMembershipRole)
    : fallback;
}

export function grantsForHumanRole(
  role: HumanSquadMembershipRole
): Array<{
  permissionKey: (typeof PERMISSION_KEYS)[number];
  scope: Record<string, unknown> | null;
}> {
  switch (role) {
    case "owner":
      return [
        { permissionKey: "agents:create", scope: null },
        { permissionKey: "environments:manage", scope: null },
        { permissionKey: "users:invite", scope: null },
        { permissionKey: "users:manage_permissions", scope: null },
        { permissionKey: "tasks:assign", scope: null },
        { permissionKey: "joins:approve", scope: null },
      ];
    case "admin":
      return [
        { permissionKey: "agents:create", scope: null },
        { permissionKey: "environments:manage", scope: null },
        { permissionKey: "users:invite", scope: null },
        { permissionKey: "tasks:assign", scope: null },
        { permissionKey: "joins:approve", scope: null },
      ];
    case "operator":
      return [{ permissionKey: "tasks:assign", scope: null }];
    case "viewer":
      return [];
  }
}

export function resolveHumanInviteRole(
  defaultsPayload: Record<string, unknown> | null | undefined
): HumanSquadMembershipRole {
  if (!defaultsPayload || typeof defaultsPayload !== "object") return "operator";
  const scoped = defaultsPayload.human;
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
    return "operator";
  }
  return normalizeHumanRole((scoped as Record<string, unknown>).role, "operator");
}
