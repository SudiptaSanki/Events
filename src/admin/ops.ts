/**
 * Admin operations (spec 34, 35, 52). Pure store operations behind a local CLI
 * (scripts/admin.ts). Chat-based admin with per-user auth is deferred until
 * live bot credentials exist — these functions will back those commands.
 * Store-based: identical logic on SQLite and D1.
 */
import type { Store } from "../db/store.js";

export type FeedbackLabel = "FALSE_POSITIVE" | "FALSE_LINK" | "WRONG_EVENT" | "WRONG_DATE" | "DUPLICATE" | "LEGITIMATE";

export async function listReview(store: Store, limit = 20): Promise<Array<Record<string, unknown>>> {
  return store.query<Record<string, unknown>>(
    `SELECT r.review_id, r.event_id, e.title, r.reason, r.score, r.created_at
     FROM review_queue r JOIN events e ON e.event_id = r.event_id
     WHERE r.resolved = 0 ORDER BY r.created_at DESC LIMIT ?`,
    limit,
  );
}

export async function approveEvent(store: Store, eventId: string, now: string): Promise<boolean> {
  const info = await store.exec("UPDATE events SET status='VERIFIED', last_seen=? WHERE event_id=? AND status IN ('NEEDS_REVIEW','SUSPICIOUS','DISCOVERED')", now, eventId);
  if (info.changes === 0) return false;
  await store.exec("UPDATE review_queue SET resolved=1, resolution='APPROVED' WHERE event_id=? AND resolved=0", eventId);
  return true;
}

export async function rejectEvent(store: Store, eventId: string, now: string, reason = "REJECTED_BY_ADMIN"): Promise<boolean> {
  const info = await store.exec("UPDATE events SET status='REJECTED', last_seen=? WHERE event_id=?", now, eventId);
  if (info.changes === 0) return false;
  await store.exec("UPDATE review_queue SET resolved=1, resolution=? WHERE event_id=? AND resolved=0", reason, eventId);
  return true;
}

/** Send an event back through verification from scratch. */
export async function recheckEvent(store: Store, eventId: string, now: string): Promise<boolean> {
  const info = await store.exec(
    "UPDATE events SET status='DISCOVERED', verification_decision=NULL, verification_score=0, last_seen=? WHERE event_id=?",
    now,
    eventId,
  );
  return info.changes > 0;
}

export async function setSourceEnabled(store: Store, sourceId: string, enabled: boolean): Promise<boolean> {
  const info = await store.exec("UPDATE source_registry SET enabled=? WHERE source_id=?", enabled ? 1 : 0, sourceId);
  return info.changes > 0;
}

export async function sourceStatus(store: Store): Promise<Array<Record<string, unknown>>> {
  return store.query<Record<string, unknown>>(
    `SELECT r.source_id, r.type, r.trust_score, r.enabled, r.last_run, r.last_status,
            COALESCE(s.valid_events,0) AS valid_events, COALESCE(s.dead_links,0) AS dead_links,
            COALESCE(s.fake_events,0) AS fake_events, COALESCE(s.duplicates,0) AS duplicates
     FROM source_registry r LEFT JOIN source_reputation s ON s.source_id = r.source_id
     ORDER BY r.source_id`,
  );
}

export async function eventDetail(store: Store, eventId: string): Promise<Record<string, unknown> | null> {
  const event = await store.queryOne<Record<string, unknown>>("SELECT * FROM events WHERE event_id=?", eventId);
  if (!event) return null;
  const sources = await store.query("SELECT source_id, source_url, observed_at FROM event_sources WHERE event_id=?", eventId);
  const evidence = await store.query("SELECT evidence_type, evidence_text, supports_claim FROM verification_evidence WHERE event_id=?", eventId);
  const flags = await store.query("SELECT flag_type, severity, resolved FROM security_flags WHERE event_id=?", eventId);
  return { event, sources, evidence, flags };
}

/** Administrator feedback improves future processing (spec 52). */
export async function recordFeedback(store: Store, eventId: string, label: FeedbackLabel, now: string): Promise<boolean> {
  const row = await store.queryOne<{ event_id: string }>("SELECT event_id FROM events WHERE event_id=?", eventId);
  if (!row) return false;
  await store.exec("UPDATE review_queue SET resolved=1, resolution=? WHERE event_id=? AND resolved=0", label, eventId);
  if (label === "FALSE_POSITIVE" || label === "FALSE_LINK" || label === "WRONG_EVENT" || label === "WRONG_DATE") {
    const sources = await store.query<{ source_id: string }>("SELECT DISTINCT source_id FROM event_sources WHERE event_id=?", eventId);
    for (const s of sources) {
      await store.exec(
        `INSERT INTO source_reputation(source_id,valid_events,dead_links,fake_events,duplicates,updated_at)
         VALUES (?,0,0,1,0,?) ON CONFLICT(source_id) DO UPDATE SET fake_events = fake_events + 1, updated_at = excluded.updated_at`,
        s.source_id,
        now,
      );
      await store.exec("UPDATE source_registry SET trust_score = MAX(0, trust_score - 8) WHERE source_id=?", s.source_id);
    }
  } else if (label === "LEGITIMATE") {
    const sources = await store.query<{ source_id: string }>("SELECT DISTINCT source_id FROM event_sources WHERE event_id=?", eventId);
    for (const s of sources) {
      await store.exec(
        `INSERT INTO source_reputation(source_id,valid_events,dead_links,fake_events,duplicates,updated_at)
         VALUES (?,1,0,0,0,?) ON CONFLICT(source_id) DO UPDATE SET valid_events = valid_events + 1, updated_at = excluded.updated_at`,
        s.source_id,
        now,
      );
      await store.exec("UPDATE source_registry SET trust_score = MIN(100, trust_score + 3) WHERE source_id=?", s.source_id);
    }
  }
  // DUPLICATE: no reputation change (dedupe is the system's job, spec 23).
  return true;
}

export async function stats(store: Store): Promise<Record<string, unknown>> {
  const byStatus = await store.query("SELECT status, COUNT(*) AS c FROM events GROUP BY status");
  const byTier = await store.query("SELECT COALESCE(publishing_tier,'NONE') AS t, COUNT(*) AS c FROM events GROUP BY t");
  const reviewOpen = await store.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM review_queue WHERE resolved=0");
  const dlq = await store.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM dead_letter_queue");
  const sent = await store.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM notifications WHERE status='SENT'");
  return { byStatus, byTier, reviewOpen: reviewOpen?.c ?? 0, dlq: dlq?.c ?? 0, sent: sent?.c ?? 0 };
}
