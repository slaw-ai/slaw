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

export const botfatherApi = {
  status: () => req("/botfather/status"),
  reenroll: () => req("/botfather/reenroll", "POST"),
  disconnect: () => req("/botfather/disconnect", "POST"),
};
