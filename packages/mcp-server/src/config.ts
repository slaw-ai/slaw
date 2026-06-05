export interface SlawMcpConfig {
  apiUrl: string;
  apiKey: string;
  squadId: string | null;
  agentId: string | null;
  runId: string | null;
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeApiUrl(apiUrl: string): string {
  const trimmed = stripTrailingSlash(apiUrl.trim());
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SlawMcpConfig {
  const apiUrl = nonEmpty(env.SLAW_API_URL);
  if (!apiUrl) {
    throw new Error("Missing SLAW_API_URL");
  }
  const apiKey = nonEmpty(env.SLAW_API_KEY);
  if (!apiKey) {
    throw new Error("Missing SLAW_API_KEY");
  }

  return {
    apiUrl: normalizeApiUrl(apiUrl),
    apiKey,
    squadId: nonEmpty(env.SLAW_SQUAD_ID),
    agentId: nonEmpty(env.SLAW_AGENT_ID),
    runId: nonEmpty(env.SLAW_RUN_ID),
  };
}
