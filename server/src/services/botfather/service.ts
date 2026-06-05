import type { Db } from "@slaw/db";
import type { BotfatherConfig } from "@slaw/shared";
import { createBotfatherClient } from "./client.js";
import { BotfatherEnrollment, type EnrollmentStatus } from "./enrollment.js";
import { BotfatherReporter } from "./reporter.js";

export interface BotfatherServiceLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/**
 * Long-running orchestrator for the botfather integration (ARCHITECTURE §6/§4).
 * Owns the enrollment state machine and two interval loops (heartbeat + sync).
 * Constructed once at startup; the gate API reads status() and isGated().
 * A no-op shell is returned when no botfather.url is configured (standalone).
 */
export class BotfatherService {
  readonly enrollment: BotfatherEnrollment;
  private readonly reporter: BotfatherReporter | null;
  private timers: NodeJS.Timeout[] = [];
  private syncing = false;

  constructor(
    private readonly db: Db,
    private readonly config: BotfatherConfig,
    private readonly logger: BotfatherServiceLogger,
  ) {
    this.enrollment = new BotfatherEnrollment({
      url: config.url,
      enforcement: config.enforcement,
      reportIssueTitles: config.reportIssueTitles,
    });
    this.reporter = config.url
      ? new BotfatherReporter({
          db,
          client: createBotfatherClient(config.url),
          enrollment: this.enrollment,
          reportIssueTitles: config.reportIssueTitles,
        })
      : null;
  }

  get enabled(): boolean {
    return !!this.config.url;
  }

  status(): EnrollmentStatus {
    return this.enrollment.status();
  }

  isGated(): boolean {
    return this.enrollment.isGated();
  }

  /** Start enrollment + the heartbeat/sync loops. Safe no-op when standalone. */
  start(): void {
    if (!this.enabled || !this.reporter) {
      this.logger.info({}, "botfather: standalone (no url configured); reporter disabled");
      return;
    }
    this.logger.info(
      { url: this.config.url, enforcement: this.config.enforcement },
      "botfather: starting reporter",
    );

    // Enrollment loop: drive to active, then keep checking for revocation recovery.
    const enrollTick = () => {
      void this.enrollment.tick().catch((err) => this.logger.error({ err }, "botfather enrollment tick failed"));
    };
    enrollTick();
    this.timers.push(setInterval(enrollTick, 10_000));

    // Heartbeat loop.
    this.timers.push(
      setInterval(() => {
        if (!this.enrollment.apiKey) return;
        void this.reporter!.heartbeat().catch((err) =>
          this.logger.warn({ err: String(err) }, "botfather heartbeat failed"),
        );
      }, this.config.heartbeatIntervalSec * 1000),
    );

    // Sync loop (guarded against overlap).
    this.timers.push(
      setInterval(() => {
        if (!this.enrollment.apiKey || this.syncing) return;
        this.syncing = true;
        void this.reporter!
          .sync()
          .then((r) => {
            if (r.upserts > 0 || r.facts > 0) {
              this.logger.info({ upserts: r.upserts, facts: r.facts }, "botfather sync sent deltas");
            }
          })
          .catch((err) => this.logger.warn({ err: String(err) }, "botfather sync failed"))
          .finally(() => {
            this.syncing = false;
          });
      }, this.config.syncIntervalSec * 1000),
    );

    for (const t of this.timers) t.unref?.();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
