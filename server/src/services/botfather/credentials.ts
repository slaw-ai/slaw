import fs from "node:fs";
import path from "node:path";
import { resolveBotfatherCredentialsPath } from "@slaw-ai/shared";

/**
 * Per-instance botfather credentials, stored outside the squad-scoped secrets
 * vault because this key is instance-level, not squad-level. File mode 0600 at
 * ~/.slaw/instances/<id>/botfather/credentials.json (ARCHITECTURE §6.2).
 */
export interface BotfatherCredentials {
  apiKey: string;
  enrollmentId: string;
  enrolledAt: string;
  url: string;
}

export function readBotfatherCredentials(instanceId?: string): BotfatherCredentials | null {
  const file = resolveBotfatherCredentialsPath({ instanceId });
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<BotfatherCredentials>;
    if (typeof parsed.apiKey === "string" && parsed.apiKey.length > 0) {
      return {
        apiKey: parsed.apiKey,
        enrollmentId: parsed.enrollmentId ?? "",
        enrolledAt: parsed.enrolledAt ?? "",
        url: parsed.url ?? "",
      };
    }
  } catch {
    /* corrupt → treat as not enrolled */
  }
  return null;
}

export function writeBotfatherCredentials(creds: BotfatherCredentials, instanceId?: string): void {
  const file = resolveBotfatherCredentialsPath({ instanceId });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(creds, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function clearBotfatherCredentials(instanceId?: string): void {
  const file = resolveBotfatherCredentialsPath({ instanceId });
  try {
    if (fs.existsSync(file)) fs.rmSync(file);
  } catch {
    /* best effort */
  }
}
