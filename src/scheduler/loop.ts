/**
 * Shared automation loop (Phase 6/8): discovery -> verification -> link health
 * -> reminders -> maintenance -> notifications. Runtime-agnostic: runs on a
 * Store (SQLite locally, D1 in Workers). Budget-capped per stage so free-tier
 * overruns degrade gracefully instead of failing (spec 28).
 */
import { runDiscovery, type DiscoverySummary } from "../discovery/runner.js";
import type { SourceConnector } from "../sources/types.js";
import { verifyDiscoveredEvent, type StoredEvent } from "../verification/verifyDiscovered.js";
import { recheckLinks, type RecheckSummary } from "../quality/linkHealth.js";
import { createHttpResolver, type RedirectResolver } from "../verification/linkVerification.js";
import { queueReminders, type ReminderSummary } from "../notify/reminders.js";
import { dispatchPending, queueEligibleAlerts, type ChannelTarget, type DispatchSummary, type WhatsAppConfig } from "../notify/dispatch.js";
import { isStale } from "../quality/freshness.js";
import { logger } from "../logging.js";
import type { ThreatIntelProvider } from "../security/threatIntel.js";
import type { Store } from "../db/store.js";

export interface LoopOptions {
  connectors: SourceConnector[];
  targets: ChannelTarget[];
  verifyLimit?: number;
  /** Re-check oldest published events for changes (spec 20). Default 5. */
  reverifyLimit?: number;
  linkLimit?: number;
  dryRun?: boolean;
  now?: () => string;
  fetchFn?: typeof fetch;
  redirectResolver?: RedirectResolver;
  threatIntel?: ThreatIntelProvider;
  telegramBotToken?: string | null;
  whatsapp?: WhatsAppConfig | null;
  /** Skip heavy stages (maintenance cron runs link-health + reminders only). */
  stages?: { discovery?: boolean; verification?: boolean; linkHealth?: boolean; reminders?: boolean; maintenance?: boolean; notify?: boolean };
}

export interface LoopReport {
  dryRun: boolean;
  at: string;
  discovery?: DiscoverySummary;
  verification?: { pending: number; verified: number; decisions: Record<string, number> };
  reverification?: { checked: number; decisions: Record<string, number> };
  linkHealth?: RecheckSummary;
  reminders?: ReminderSummary | "preview-skipped";
  maintenance?: { expired: number };
  notify?: DispatchSummary;
}

export async function runLoopStages(store: Store, opts: LoopOptions): Promise<LoopReport> {
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const dryRun = opts.dryRun ?? true;
  const stages = { discovery: true, verification: true, linkHealth: true, reminders: true, maintenance: true, notify: true, ...opts.stages };
  const report: LoopReport = { dryRun, at };

  if (stages.discovery) {
    report.discovery = await runDiscovery(store, opts.connectors, { dryRun });
  }

  if (stages.verification) {
    const pending = await store.query<StoredEvent>(
      `SELECT event_id,title,organizer_name,event_url,registration_url,start_date,
              registration_deadline,categories,format,status,first_seen,last_seen
       FROM events WHERE status='DISCOVERED' ORDER BY first_seen ASC LIMIT ?`,
      opts.verifyLimit ?? 10,
    );
    let verified = 0;
    const decisions: Record<string, number> = {};
    for (const row of pending) {
      try {
        const r = await verifyDiscoveredEvent(store, row, {
          dryRun,
          fetchFn: opts.fetchFn,
          redirectResolver: opts.redirectResolver,
          threatIntel: opts.threatIntel,
          now,
        });
        verified++;
        decisions[r.newStatus] = (decisions[r.newStatus] ?? 0) + 1;
      } catch {
        logger.warn("loop verify failed", { event: row.event_id });
      }
    }
    report.verification = { pending: pending.length, verified, decisions };

    // Re-verify oldest published events to catch changes (spec 20). Only
    // VERIFIED/PUBLISHED are revisited — review/rejected items stay put
    // until an admin acts, so the review queue can never flood itself.
    const recheck = await store.query<StoredEvent>(
      `SELECT event_id,title,organizer_name,event_url,registration_url,start_date,
              registration_deadline,categories,format,status,first_seen,last_seen
       FROM events WHERE status IN ('VERIFIED','PUBLISHED')
       ORDER BY COALESCE(last_verified,'') ASC LIMIT ?`,
      opts.reverifyLimit ?? 5,
    );
    const reDecisions: Record<string, number> = {};
    for (const row of recheck) {
      try {
        const r = await verifyDiscoveredEvent(store, row, {
          dryRun,
          fetchFn: opts.fetchFn,
          redirectResolver: opts.redirectResolver,
          threatIntel: opts.threatIntel,
          now,
        });
        reDecisions[r.newStatus] = (reDecisions[r.newStatus] ?? 0) + 1;
      } catch {
        logger.warn("loop reverify failed", { event: row.event_id });
      }
    }
    report.reverification = { checked: recheck.length, decisions: reDecisions };
  }

  if (stages.linkHealth) {
    report.linkHealth = await recheckLinks(store, {
      redirectResolver: opts.redirectResolver ?? createHttpResolver({ fetchFn: opts.fetchFn }),
      now,
      limit: dryRun ? 0 : (opts.linkLimit ?? 50),
    });
  }

  if (stages.reminders) {
    report.reminders = dryRun ? "preview-skipped" : await queueReminders(store, opts.targets, at);
  }

  if (stages.maintenance) {
    let expired = 0;
    if (!dryRun) {
      const candidates = await store.query<{ event_id: string; status: string; end_date: string | null; registration_deadline: string | null }>(
        `SELECT event_id,status,end_date,registration_deadline FROM events
         WHERE status NOT IN ('EXPIRED','CANCELLED','REJECTED')`,
      );
      for (const c of candidates) {
        if (isStale({ status: c.status, endDate: c.end_date, deadline: c.registration_deadline, now: at }).stale) {
          await store.exec("UPDATE events SET status='EXPIRED', last_seen=? WHERE event_id=?", at, c.event_id);
          expired++;
        }
      }
    }
    report.maintenance = { expired };
  }

  if (stages.notify) {
    if (!dryRun) await queueEligibleAlerts(store, opts.targets, at);
    report.notify = await dispatchPending(store, opts.targets, {
      telegramBotToken: opts.telegramBotToken ?? null,
      whatsapp: opts.whatsapp ?? null,
      fetchFn: opts.fetchFn,
      dryRun,
      now,
    });
  }

  return report;
}
