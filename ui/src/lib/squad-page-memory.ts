import {
  extractSquadPrefixFromPath,
  normalizeSquadPrefix,
  toSquadRelativePath,
} from "./squad-routes";

const GLOBAL_SEGMENTS = new Set(["auth", "invite", "board-claim", "cli-auth", "docs"]);

export function isRememberableSquadPath(path: string): boolean {
  const pathname = path.split("?")[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  const [root] = segments;
  if (GLOBAL_SEGMENTS.has(root!)) return false;
  return true;
}

function findSquadByPrefix<T extends { id: string; issuePrefix: string }>(params: {
  squads: T[];
  squadPrefix: string;
}): T | null {
  const normalizedPrefix = normalizeSquadPrefix(params.squadPrefix);
  return params.squads.find((squad) => normalizeSquadPrefix(squad.issuePrefix) === normalizedPrefix) ?? null;
}

export function getRememberedPathOwnerSquadId<T extends { id: string; issuePrefix: string }>(params: {
  squads: T[];
  pathname: string;
  fallbackSquadId: string | null;
}): string | null {
  const routeSquadPrefix = extractSquadPrefixFromPath(params.pathname);
  if (!routeSquadPrefix) {
    return params.fallbackSquadId;
  }

  return findSquadByPrefix({
    squads: params.squads,
    squadPrefix: routeSquadPrefix,
  })?.id ?? null;
}

export function sanitizeRememberedPathForSquad(params: {
  path: string | null | undefined;
  squadPrefix: string;
}): string {
  const relativePath = params.path ? toSquadRelativePath(params.path) : "/dashboard";
  if (!isRememberableSquadPath(relativePath)) {
    return "/dashboard";
  }

  const pathname = relativePath.split("?")[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  const [root, entityId] = segments;
  if (root === "issues" && entityId) {
    const identifierMatch = /^([A-Za-z]+)-\d+$/.exec(entityId);
    if (
      identifierMatch &&
      normalizeSquadPrefix(identifierMatch[1] ?? "") !== normalizeSquadPrefix(params.squadPrefix)
    ) {
      return "/dashboard";
    }
  }

  return relativePath;
}
