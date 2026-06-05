import os from "node:os";
import { loadOrCreateMachineIdentity, resolveSlawInstanceId } from "@slaw/shared";
import type { InstanceIdentity } from "@slaw/shared/botfather/protocol";
import { serverVersion } from "../../version.js";
import { createBotfatherClient, BotfatherHttpError, type BotfatherClient } from "./client.js";
import {
  readBotfatherCredentials,
  writeBotfatherCredentials,
  clearBotfatherCredentials,
} from "./credentials.js";

/** Gate-facing enrollment state (ARCHITECTURE §6.3). */
export type EnrollmentState =
  | "connecting"
  | "pending"
  | "rejected"
  | "active"
  | "unreachable"
  | "revoked"
  | "standalone"; // no botfather.url configured

export interface EnrollmentStatus {
  state: EnrollmentState;
  url: string | null;
  enforcement: "enforce" | "advisory";
  machineId: string;
  instanceId: string;
  hostname: string;
  /** true once we hold a valid API key (enrolled at least once) */
  enrolled: boolean;
  detail?: string;
}

function osTag(): InstanceIdentity["os"] {
  const p = process.platform;
  return p === "darwin" || p === "win32" ? p : "linux";
}

export function buildIdentity(): InstanceIdentity {
  const machine = loadOrCreateMachineIdentity();
  return {
    machineId: machine.machineId,
    instanceId: resolveSlawInstanceId(),
    hostname: os.hostname(),
    os: osTag(),
    slawVersion: serverVersion,
  };
}

export interface BotfatherSettings {
  url: string | undefined;
  enforcement: "enforce" | "advisory";
  reportIssueTitles: boolean;
}

/**
 * Drives the enrollment lifecycle. Holds the current state in memory so the
 * gate API can report it without re-hitting the network on every poll.
 */
export class BotfatherEnrollment {
  private state: EnrollmentState;
  private enrollmentId: string | null = null;
  private detail: string | undefined;
  private readonly client: BotfatherClient | null;
  readonly identity: InstanceIdentity;

  constructor(private readonly settings: BotfatherSettings) {
    this.identity = buildIdentity();
    if (!settings.url) {
      this.state = "standalone";
      this.client = null;
      return;
    }
    this.client = createBotfatherClient(settings.url);
    const creds = readBotfatherCredentials();
    this.state = creds ? "active" : "connecting";
  }

  get apiKey(): string | null {
    return readBotfatherCredentials()?.apiKey ?? null;
  }

  status(): EnrollmentStatus {
    return {
      state: this.state,
      url: this.settings.url ?? null,
      enforcement: this.settings.enforcement,
      machineId: this.identity.machineId,
      instanceId: this.identity.instanceId,
      hostname: this.identity.hostname,
      enrolled: this.apiKey !== null,
      detail: this.detail,
    };
  }

  /** Should the SLAW UI be blocked behind the gate right now? */
  isGated(): boolean {
    if (this.state === "standalone" || this.state === "active") return false;
    if (this.settings.enforcement === "advisory") return false;
    // enforce: an already-enrolled instance is allowed to run even if the tower
    // is momentarily unreachable (fail-open for the enrolled, §6.4).
    if (this.state === "unreachable" && this.apiKey) return false;
    return true;
  }

  /**
   * One enrollment step. Idempotent + safe to call on an interval until active.
   * Returns the current state after the step.
   */
  async tick(): Promise<EnrollmentState> {
    if (!this.client || this.state === "standalone") return this.state;

    // already have a key → consider ourselves active (heartbeat will detect revocation)
    if (this.apiKey && this.state !== "revoked") {
      this.state = "active";
      return this.state;
    }

    try {
      if (!this.enrollmentId) {
        const res = await this.client.enroll(this.identity, this.settings.reportIssueTitles);
        this.enrollmentId = res.enrollmentId;
        if (res.state === "active" && res.apiKey) {
          this.persistKey(res.apiKey, res.enrollmentId);
          this.state = "active";
          return this.state;
        }
        this.state = res.state === "rejected" ? "rejected" : "pending";
        return this.state;
      }

      const poll = await this.client.pollEnrollment(this.enrollmentId);
      if (poll.state === "active" && poll.apiKey) {
        this.persistKey(poll.apiKey, this.enrollmentId);
        this.state = "active";
      } else if (poll.state === "rejected") {
        this.state = "rejected";
      } else if (poll.state === "revoked") {
        // revoked mid-flight → restart enrollment
        this.enrollmentId = null;
        this.state = "revoked";
      } else {
        this.state = "pending";
      }
      return this.state;
    } catch (err) {
      this.detail = err instanceof Error ? err.message : String(err);
      this.state = "unreachable";
      return this.state;
    }
  }

  /** Called by the reporter when a heartbeat/sync returns 401 (revoked). */
  onRevoked(): void {
    clearBotfatherCredentials();
    this.enrollmentId = null;
    this.state = "revoked";
  }

  /** Force a fresh enrollment (CLI `reenroll`). */
  async reenroll(): Promise<EnrollmentState> {
    clearBotfatherCredentials();
    this.enrollmentId = null;
    this.state = "connecting";
    return this.tick();
  }

  private persistKey(apiKey: string, enrollmentId: string): void {
    writeBotfatherCredentials({
      apiKey,
      enrollmentId,
      enrolledAt: new Date().toISOString(),
      url: this.settings.url ?? "",
    });
    this.detail = undefined;
  }

  static isRevokedError(err: unknown): boolean {
    return (
      err instanceof BotfatherHttpError &&
      (err.status === 401 || err.code === "enrollment_revoked")
    );
  }
}
