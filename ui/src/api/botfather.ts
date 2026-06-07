export type BotfatherState =
  | "connecting"
  | "pending"
  | "rejected"
  | "active"
  | "unreachable"
  | "revoked"
  | "standalone";

export type BotfatherStatus = {
  state: BotfatherState;
  url: string | null;
  enforcement?: "enforce" | "advisory";
  machineId?: string;
  instanceId?: string;
  hostname?: string;
  enrolled: boolean;
  gated: boolean;
  detail?: string;
};

async function req(path: string, method: "GET" | "POST" = "GET"): Promise<BotfatherStatus> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `botfather ${path} failed (${res.status})`);
  }
  return res.json();
}

async function postJson(path: string, body: unknown): Promise<BotfatherStatus> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `botfather ${path} failed (${res.status})`);
  }
  return res.json();
}

export type ForceSyncResult = {
  ok: true;
  upserts: number;
  facts: number;
  healed: number;
  entities: number;
  iterations: number;
};

async function forceSync(): Promise<ForceSyncResult> {
  const res = await fetch("/api/botfather/force-sync", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `force sync failed (${res.status})`);
  }
  return res.json();
}

export type SkillCatalogEntry = {
  key: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  trustLevel: string;
  version: number;
  contentHash: string;
  hasFiles: boolean;
  updatedAt: string;
};
export type SkillCatalogResult = { catalogVersion: number; skills: SkillCatalogEntry[] };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `botfather ${path} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function postBody<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `botfather ${path} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const botfatherApi = {
  status: () => req("/botfather/status"),
  connect: (url: string, enforcement: "enforce" | "advisory") =>
    postJson("/botfather/connect", { url, enforcement }),
  reenroll: () => req("/botfather/reenroll", "POST"),
  disconnect: () => req("/botfather/disconnect", "POST"),
  forceSync,
  /** list the control tower's published skill catalog */
  skillCatalog: () => getJson<SkillCatalogResult>("/botfather/skills/catalog"),
  /** install a catalog skill onto a chosen local squad */
  installSkill: (squadId: string, key: string) =>
    postBody<{ ok: true; skill: unknown }>("/botfather/skills/install", { squadId, key }),
  /** re-pull the catalog and refresh installed managed skills */
  refreshSkills: () =>
    postBody<{ ok: true; catalogVersion: number; refreshed: number; checked: number }>(
      "/botfather/skills/refresh",
      {},
    ),
};
