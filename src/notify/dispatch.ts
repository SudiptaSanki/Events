/**
 * Notification dispatch (Phase 5, spec 49/50/65/66). Queue + send pipeline:
 * - queueEligibleAlerts: VERIFIED/UPDATED + Tier A/B + publishing gate pass.
 *   Tier C/D/E never queue. Deduplicates per (event, target); an UPDATED event
 *   after a SENT alert queues a CORRECTION instead of a duplicate alert.
 * - dispatchPending: re-checks the gate from the CURRENT row at send time,
 *   sends via channel adapters, marks SENT/FAILED. 429s stay QUEUED for the
 *   next run (backoff by the sender, no uncontrolled retries — spec 28).
 * Store-based: identical logic on SQLite and D1.
 */
import { logger } from "../logging.js";
import { publishingGate } from "../verification/scoring.js";
import { formatCorrection, formatEventAlert, verificationLabelFor, type FormattedAlert } from "./templates.js";
import { sendTelegramMessage, type SendResult } from "./telegram.js";
import { sendDiscordWebhook } from "./discord.js";
import { sendWhatsAppMessage } from "./whatsapp.js";
import type { Store } from "../db/store.js";

export interface ChannelTarget {
  targetId: string;
  channel: "TELEGRAM" | "DISCORD" | "WHATSAPP";
  destination: string; // chat_id, webhook URL, or recipient phone number
  /** Optional subscription filter: { categories?: string[], cities?: string[] } */
  filter?: string | null;
}

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  templateName?: string;
}

export interface AdapterOptions {
  telegramBotToken: string | null;
  whatsapp?: WhatsAppConfig | null;
  fetchFn?: typeof fetch;
}

export interface DispatchSummary {
  queued: number;
  sent: number;
  failed: number;
  suppressed: number;
}

interface GateRow {
  event_id: string;
  title: string;
  organizer_name: string | null;
  event_url: string | null;
  city: string | null;
  start_date: string | null;
  registration_deadline: string | null;
  categories: string | null;
  format: string;
  verification_decision: string | null;
  verification_score: number | null;
  publishing_tier: string | null;
  registration_url: string | null;
  registration_unverified_note: string | null;
  status: string;
}

async function gateInputFor(store: Store, row: GateRow): Promise<{ pass: boolean; reasons: string[] }> {
  const crit = await store.queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM security_flags WHERE event_id = ? AND severity = 'critical' AND resolved = 0",
    row.event_id,
  );
  const cats = row.categories ? (JSON.parse(row.categories) as string[]) : [];
  return publishingGate({
    title: row.title,
    organizerOrSource: row.organizer_name,
    eventPageOrSource: row.event_url,
    hasDateOrDeadline: !!(row.start_date || row.registration_deadline),
    classification: cats[0] ?? null,
    verificationDecision: row.verification_decision as never,
    registrationOkOrMarkedUnavailable: !!(row.registration_url || row.registration_unverified_note),
    unresolvedCriticalFlags: (crit?.c ?? 0) > 0,
  });
}

async function loadRow(store: Store, eventId: string): Promise<GateRow | null> {
  return store.queryOne<GateRow>(
    `SELECT event_id,title,organizer_name,event_url,city,start_date,registration_deadline,categories,format,
            verification_decision,verification_score,publishing_tier,registration_url,
            registration_unverified_note,status
     FROM events WHERE event_id = ?`,
    eventId,
  );
}

/**
 * Subscription matching (Phase 8). A target with no/invalid filter receives
 * everything it is otherwise eligible for. Specified dimensions combine with
 * AND; values within a dimension combine with OR.
 */
export function targetMatchesEvent(
  filter: string | null | undefined,
  event: { categories: string | null; city: string | null },
): boolean {
  if (!filter) return true;
  let parsed: { categories?: unknown; cities?: unknown };
  try {
    parsed = JSON.parse(filter) as { categories?: unknown; cities?: unknown };
  } catch {
    return true; // invalid filter never suppresses (fail-open, logged by caller)
  }
  if (parsed.categories !== undefined) {
    if (!Array.isArray(parsed.categories)) return true;
    const cats = event.categories ? (JSON.parse(event.categories) as string[]) : [];
    if (!parsed.categories.some((c) => typeof c === "string" && cats.includes(c))) return false;
  }
  if (parsed.cities !== undefined) {
    if (!Array.isArray(parsed.cities)) return true;
    if (!event.city || !parsed.cities.includes(event.city)) return false;
  }
  return true;
}

function buildAlert(row: GateRow, template: "ALERT" | "CORRECTION", note?: string): FormattedAlert {
  if (template === "CORRECTION") {
    return formatCorrection(row.title, note ?? "Details changed — see the official event page.", row.event_url);
  }
  return formatEventAlert(
    {
      title: row.title,
      organizer_name: row.organizer_name,
      format: row.format as never,
      city: null,
      start_date: row.start_date,
      registration_deadline: row.registration_deadline,
      eligibility: null,
      team_size: null,
      prize: null,
      description: null,
      event_url: row.event_url,
      registration_url: row.registration_url,
    } as never,
    verificationLabelFor(row.verification_decision),
  );
}

/** Load enabled targets with their subscription filters (tolerant of pre-filter DBs). */
export async function loadTargets(store: Store): Promise<ChannelTarget[]> {
  try {
    return await store.query<ChannelTarget>(
      "SELECT target_id AS targetId, channel, destination, filter FROM notification_targets WHERE enabled = 1",
    );
  } catch {
    // Databases created before the filter column existed: no filtering.
    return store.query<ChannelTarget>(
      "SELECT target_id AS targetId, channel, destination FROM notification_targets WHERE enabled = 1",
    );
  }
}
export async function queueEligibleAlerts(store: Store, targets: ChannelTarget[], now: string): Promise<number> {
  let queued = 0;
  const rows = await store.query<{ event_id: string; status: string; publishing_tier: string }>(
    `SELECT event_id,status,publishing_tier FROM events
     WHERE status IN ('VERIFIED','UPDATED') AND publishing_tier IN ('A','B')`,
  );
  for (const row of rows) {
    const full = await loadRow(store, row.event_id);
    if (!full) continue;
    if (!(await gateInputFor(store, full)).pass) continue; // gate re-checked at queue time AND send time
    for (const t of targets) {
      if (!targetMatchesEvent(t.filter, full)) continue; // subscription filter
      const prior = await store.queryOne<{ status: string; template: string }>(
        "SELECT status, template FROM notifications WHERE event_id = ? AND target_id = ? ORDER BY notification_id DESC LIMIT 1",
        row.event_id,
        t.targetId,
      );
      if (prior && prior.status === "SENT") {
        if (row.status === "UPDATED" && prior.template !== "CORRECTION") {
          await store.exec(
            `INSERT INTO notifications(event_id,target_id,template,status,created_at) VALUES (?,?,?, 'QUEUED', ?)`,
            row.event_id,
            t.targetId,
            "CORRECTION",
            now,
          );
          queued++;
        }
        continue; // never double-alert
      }
      if (prior && prior.status === "QUEUED") continue;
      await store.exec(
        `INSERT INTO notifications(event_id,target_id,template,status,created_at) VALUES (?,?,?, 'QUEUED', ?)`,
        row.event_id,
        t.targetId,
        "ALERT",
        now,
      );
      queued++;
    }
  }
  return queued;
}

async function sendViaAdapter(
  target: ChannelTarget,
  alert: FormattedAlert,
  opts: AdapterOptions,
): Promise<SendResult> {
  if (target.channel === "TELEGRAM") {
    if (!opts.telegramBotToken) {
      return { ok: false, retryable: false, retryAfterSec: 0, error: "TELEGRAM_NOT_CONFIGURED" };
    }
    return sendTelegramMessage({ botToken: opts.telegramBotToken, fetchFn: opts.fetchFn }, target.destination, alert.text);
  }
  if (target.channel === "WHATSAPP") {
    if (!opts.whatsapp) {
      return { ok: false, retryable: false, retryAfterSec: 0, error: "WHATSAPP_NOT_CONFIGURED" };
    }
    return sendWhatsAppMessage({ ...opts.whatsapp, fetchFn: opts.fetchFn }, target.destination, alert);
  }
  return sendDiscordWebhook({ webhookUrl: target.destination, fetchFn: opts.fetchFn }, alert);
}

/** Send all QUEUED notifications. 429/5xx stay QUEUED (retry next run). */
export async function dispatchPending(
  store: Store,
  targets: ChannelTarget[],
  opts: AdapterOptions & { now?: () => string; dryRun?: boolean },
): Promise<DispatchSummary> {
  const now = opts.now ?? (() => new Date().toISOString());
  const summary: DispatchSummary = { queued: 0, sent: 0, failed: 0, suppressed: 0 };
  const pending = await store.query<{ notification_id: number; event_id: string; target_id: string; template: string }>(
    `SELECT notification_id, event_id, target_id, template FROM notifications WHERE status = 'QUEUED' ORDER BY notification_id`,
  );
  const byId = new Map(targets.map((t) => [t.targetId, t]));

  for (const n of pending) {
    const target = byId.get(n.target_id);
    const row = await loadRow(store, n.event_id);
    if (!target || !row) {
      await store.exec("UPDATE notifications SET status='FAILED', error=? WHERE notification_id=?", "UNKNOWN_TARGET_OR_EVENT", n.notification_id);
      summary.failed++;
      continue;
    }
    // Send-time gate: Tier E / critical flags / lost eligibility suppress.
    if (!["VERIFIED", "UPDATED"].includes(row.status) || !["A", "B"].includes(row.publishing_tier ?? "") || !(await gateInputFor(store, row)).pass) {
      await store.exec("UPDATE notifications SET status='SUPPRESSED', error=? WHERE notification_id=?", "GATE_FAILED_AT_SEND_TIME", n.notification_id);
      summary.suppressed++;
      continue;
    }
    // REMINDER_* templates send as urgency-prefixed alerts (spec 49).
    let kind: "ALERT" | "CORRECTION" = "ALERT";
    let note: string | undefined;
    if (n.template === "CORRECTION") {
      kind = "CORRECTION";
      note = "Details for this event changed since our last alert. Please re-check dates and links on the official page.";
    } else if (n.template === "REMINDER_24") {
      note = "⏰ URGENT: registration closes in less than 24 hours.";
    } else if (n.template === "REMINDER_48") {
      note = "⏰ Registration closes in less than 48 hours.";
    } else if (n.template === "REMINDER_START") {
      note = "📅 This event starts within 72 hours.";
    }
    const alert = buildAlert(row, kind, note);
    if (note && kind === "ALERT") {
      alert.text = `${note}\n\n${alert.text}`;
    }
    if (opts.dryRun) {
      logger.info("notify dry-run", { event: n.event_id, target: n.target_id });
      summary.sent++;
      continue; // dry-run neither sends nor marks
    }
    const result = await sendViaAdapter(target, alert, opts);
    if (result.ok) {
      await store.exec("UPDATE notifications SET status='SENT', sent_at=? WHERE notification_id=?", now(), n.notification_id);
      if (row.status === "UPDATED") {
        await store.exec("UPDATE events SET status='VERIFIED' WHERE event_id=? AND status='UPDATED'", n.event_id);
      }
      summary.sent++;
    } else if (result.retryable) {
      await store.exec("UPDATE notifications SET error=? WHERE notification_id=?", result.error, n.notification_id);
      // stays QUEUED for the next run
    } else {
      await store.exec("UPDATE notifications SET status='FAILED', error=? WHERE notification_id=?", result.error, n.notification_id);
      summary.failed++;
    }
  }
  summary.queued = pending.length;
  return summary;
}
