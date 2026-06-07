import type { Db } from "@slaw/db";
import type { BotfatherConfig } from "@slaw/shared";
import { createBotfatherClient } from "./client.js";
import { installCatalogSkill, syncSkillCatalog } from "./skill-catalog.js";
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

  /**
   * Manually sync everything to the tower right now (Settings → Control Tower →
   * Force Sync). Drains the delta cursor (loops sync() until no more rows), then
   * runs a full reconcile (heartbeat + recent costs + all entity state) so the
   * tower converges even on rows the forward-only cursor skipped. Idempotent —
   * the tower upserts. Returns aggregate counts for UI feedback.
   */
  async forceSync(): Promise<{
    upserts: number;
    facts: number;
    healed: number;
    entities: number;
    iterations: number;
  }> {
    if (!this.enabled || !this.reporter) {
      throw new Error("no_control_tower_configured");
    }
    if (!this.enrollment.apiKey) {
      throw new Error("not_enrolled");
    }
    // Serialise against the background sync loop to avoid cursor races.
    while (this.syncing) await new Promise((r) => setTimeout(r, 50));
    this.syncing = true;
    try {
      let upserts = 0;
      let facts = 0;
      let iterations = 0;
      // Drain the delta cursor. sync() pulls up to one batch (500/entity) per
      // call, so loop until a pass sends nothing. Cap to avoid a runaway loop.
      const MAX_ITERATIONS = 50;
      for (; iterations < MAX_ITERATIONS; iterations++) {
        const r = await this.reporter.sync();
        upserts += r.upserts;
        facts += r.facts;
        if (r.skipped) throw new Error(r.skipped);
        if (r.upserts === 0 && r.facts === 0) break;
      }
      // Liveness + full reconcile so the tower self-heals stale/skipped rows.
      await this.reporter.heartbeat();
      const healed = await this.reporter.reconcileRecentCosts();
      const entities = await this.reporter.reconcileEntities();
      this.logger.info(
        { upserts, facts, healed, entities, iterations },
        "botfather force sync complete",
      );
      return { upserts, facts, healed, entities, iterations };
    } finally {
      this.syncing = false;
    }
  }

  /* ── skill registry (tower-mastered) ──
   * The instance pulls the tower's published catalog and installs chosen skills
   * onto a local squad. Reuses the same client + per-instance apiKey as sync. */

  /** List the tower's published skill catalog (descriptors only). */
  async listSkillCatalog() {
    if (!this.enabled || !this.config.url) throw new Error("no_control_tower_configured");
    if (!this.enrollment.apiKey) throw new Error("not_enrolled");
    return createBotfatherClient(this.config.url).skillCatalog(this.enrollment.apiKey);
  }

  /** Install one catalog skill onto a chosen local squad (pulls full content). */
  async installSkill(squadId: string, key: string) {
    if (!this.enabled || !this.config.url) throw new Error("no_control_tower_configured");
    if (!this.enrollment.apiKey) throw new Error("not_enrolled");
    const client = createBotfatherClient(this.config.url);
    return installCatalogSkill(this.db, client, this.enrollment.apiKey, squadId, key);
  }

  /** Manually re-pull the catalog and refresh installed managed skills. */
  async refreshSkills() {
    if (!this.enabled || !this.config.url) throw new Error("no_control_tower_configured");
    if (!this.enrollment.apiKey) throw new Error("not_enrolled");
    const client = createBotfatherClient(this.config.url);
    return syncSkillCatalog(this.db, client, this.enrollment.apiKey);
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
