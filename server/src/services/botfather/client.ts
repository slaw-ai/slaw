import {
  PROTOCOL_VERSION,
  type InstanceIdentity,
  type EnrollResponse,
  type EnrollPollResponse,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type SyncRequest,
  type SyncResponse,
} from "@slaw/shared/botfather/protocol";

/**
 * HTTP client for the botfather tower. The tower's ingest endpoints accept
 * plain JSON (its Zod schemas parse the request body directly), so we send
 * plain JSON with a Bearer token — no gzip envelope. Errors are surfaced as
 * thrown BotfatherHttpError; callers decide whether to spool/back off.
 */
export class BotfatherHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BotfatherHttpError";
  }
}

function joinUrl(base: string, p: string): string {
  return new URL(p, base.endsWith("/") ? base : base + "/").toString();
}

async function postJson<T>(url: string, body: unknown, apiKey?: string, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const code = (parsed as { code?: string } | undefined)?.code;
      throw new BotfatherHttpError(
        (parsed as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`,
        res.status,
        code,
      );
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

export function createBotfatherClient(baseUrl: string) {
  const ingest = (p: string) => joinUrl(baseUrl, `api/ingest/v1/${p}`);
  return {
    /** token-less self-enrollment → pending (or active if an auto-approve rule matches) */
    async enroll(instance: InstanceIdentity, reportIssueTitles: boolean): Promise<EnrollResponse> {
      return postJson<EnrollResponse>(ingest("enroll"), {
        protocolVersion: PROTOCOL_VERSION,
        instance,
        capabilities: { reportIssueTitles, liveStream: false },
      });
    },
    /** poll until approved; returns the per-instance apiKey once active */
    async pollEnrollment(enrollmentId: string): Promise<EnrollPollResponse> {
      return postJson<EnrollPollResponse>(ingest("enroll/poll"), {
        protocolVersion: PROTOCOL_VERSION,
        enrollmentId,
      });
    },
    async heartbeat(apiKey: string, body: HeartbeatRequest): Promise<HeartbeatResponse> {
      return postJson<HeartbeatResponse>(ingest("heartbeat"), body, apiKey);
    },
    async sync(apiKey: string, body: SyncRequest): Promise<SyncResponse> {
      return postJson<SyncResponse>(ingest("sync"), body, apiKey);
    },
  };
}

export type BotfatherClient = ReturnType<typeof createBotfatherClient>;
