const OPERATOR_ROUTE_ROOTS = new Set([
  "dashboard",
  "squads",
  "squad",
  "skills",
  "org",
  "agents",
  "projects",
  "workspaces",
  "execution-workspaces",
  "issues",
  "routines",
  "goals",
  "approvals",
  "costs",
  "usage",
  "activity",
  "inbox",
  "u",
  "design-guide",
  "search",
]);

const GLOBAL_ROUTE_ROOTS = new Set(["auth", "invite", "instance-claim", "cli-auth", "docs", "instance"]);

export function normalizeSquadPrefix(prefix: string): string {
  return prefix.trim().toUpperCase();
}

function splitPath(path: string): { pathname: string; search: string; hash: string } {
  const match = path.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  return {
    pathname: match?.[1] ?? path,
    search: match?.[2] ?? "",
    hash: match?.[3] ?? "",
  };
}

function getRootSegment(pathname: string): string | null {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment ?? null;
}

export function isGlobalPath(pathname: string): boolean {
  if (pathname === "/") return true;
  const root = getRootSegment(pathname);
  if (!root) return true;
  return GLOBAL_ROUTE_ROOTS.has(root.toLowerCase());
}

export function isOperatorPathWithoutPrefix(pathname: string): boolean {
  const root = getRootSegment(pathname);
  if (!root) return false;
  return OPERATOR_ROUTE_ROOTS.has(root.toLowerCase());
}

export function extractSquadPrefixFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0]!.toLowerCase();
  if (GLOBAL_ROUTE_ROOTS.has(first) || OPERATOR_ROUTE_ROOTS.has(first)) {
    return null;
  }
  return normalizeSquadPrefix(segments[0]!);
}

export function applySquadPrefix(path: string, squadPrefix: string | null | undefined): string {
  const { pathname, search, hash } = splitPath(path);
  if (!pathname.startsWith("/")) return path;
  if (isGlobalPath(pathname)) return path;
  if (!squadPrefix) return path;

  const prefix = normalizeSquadPrefix(squadPrefix);
  const activePrefix = extractSquadPrefixFromPath(pathname);
  if (activePrefix) return path;

  return `/${prefix}${pathname}${search}${hash}`;
}

export function toSquadRelativePath(path: string): string {
  const { pathname, search, hash } = splitPath(path);
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length >= 2) {
    const second = segments[1]!.toLowerCase();
    if (!GLOBAL_ROUTE_ROOTS.has(segments[0]!.toLowerCase()) && OPERATOR_ROUTE_ROOTS.has(second)) {
      return `/${segments.slice(1).join("/")}${search}${hash}`;
    }
  }

  return `${pathname}${search}${hash}`;
}
