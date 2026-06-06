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
  enrollment: BotfatherEnrollment;
  private reporter: BotfatherReporter | null;
  private timers: NodeJS.Timeout[] = [];
  private syncing = false;
  private started = false;

  constructor(
    private readonly db: Db,
    private config: BotfatherConfig,
    private readonly logger: BotfatherServiceLogger,
    /** persists a config patch to disk so the connection survives restart */
    private readonly persistConfig?: (patch: BotfatherConfig) => void,
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

  /**
   * Attach a running instance to a control tower (Settings → Control Tower).
   * Persists the url+enforcement, rebuilds enrollment+reporter, and starts the
   * loops live — no restart needed. Re-connecting to a new url clears the old
   * credentials so a fresh enrollment is forced.
   */
  connect(url: string, enforcement: "enforce" | "advisory"): EnrollmentStatus {
    const changedUrl = url !== this.config.url;
    this.stop();
    this.config = { ...this.config, url, enforcement };
    this.persistConfig?.(this.config);

    this.enrollment = new BotfatherEnrollment({
      url,
      enforcement,
      reportIssueTitles: this.config.reportIssueTitles,
    });
    if (changedUrl) this.enrollment.onRevoked(); // drop any stale key for a new tower
    this.reporter = new BotfatherReporter({
      db: this.db,
      client: createBotfatherClient(url),
      enrollment: this.enrollment,
      reportIssueTitles: this.config.reportIssueTitles,
    });
    this.started = false;
    this.start();
    return this.enrollment.status();
  }

  /** Detach from the tower (advisory only — see route guard). */
  disconnect(): EnrollmentStatus {
    this.stop();
    this.enrollment.onRevoked();
    this.config = { ...this.config, url: undefined };
    this.persistConfig?.(this.config);
    this.enrollment = new BotfatherEnrollment({
      url: undefined,
      enforcement: this.config.enforcement,
      reportIssueTitles: this.config.reportIssueTitles,
    });
    this.reporter = null;
    return this.enrollment.status();
  }

  status(): EnrollmentStatus {
    return this.enrollment.status();
  }

  isGated(): boolean {
    return this.enrollment.isGated();
  }

  /** Start enrollment + the heartbeat/sync loops. Safe no-op when standalone. */
  start(): void {
    if (this.started) return;
    if (!this.enabled || !this.reporter) {
      this.logger.info({}, "botfather: standalone (no url configured); reporter disabled");
      return;
    }
    this.started = true;
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

    // Sync loop (guarded against overlap). Every Nth tick also re-sends recent
    // cost_events so the tower's token/cost totals self-heal (stale 0-token
    // facts, pre-enrollment history). Cheap + idempotent (tower upserts).
    let tick = 0;
    const RECONCILE_EVERY = 10; // ~every 10 minutes at 60s interval
    this.timers.push(
      setInterval(() => {
        if (!this.enrollment.apiKey || this.syncing) return;
        this.syncing = true;
        const doReconcile = tick++ % RECONCILE_EVERY === 0;
        void this.reporter!
          .sync()
          .then(async (r) => {
            if (r.upserts > 0 || r.facts > 0) {
              this.logger.info({ upserts: r.upserts, facts: r.facts }, "botfather sync sent deltas");
            }
            if (doReconcile) {
              const healed = await this.reporter!.reconcileRecentCosts();
              if (healed > 0) this.logger.info({ healed }, "botfather reconciled recent cost facts");
              const entities = await this.reporter!.reconcileEntities();
              if (entities > 0) this.logger.info({ entities }, "botfather reconciled entity state");
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
    this.started = false;
  }
}
