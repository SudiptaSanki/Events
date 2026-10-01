/**
 * Maintenance (Phase 4, spec 22/51): expire stale events + print quality
 * metrics. Run daily (Phase 6 cron); safe to run manually anytime.
 */
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { isStale } from "../src/quality/freshness.js";

const now = new Date().toISOString();
const db = openDatabase();
migrate(db);
const store = createSqliteStore(db);

const candidates = await store.query<{ event_id: string; status: string; end_date: string | null; registration_deadline: string | null }>(
  `SELECT event_id, status, end_date, registration_deadline FROM events
   WHERE status NOT IN ('EXPIRED','CANCELLED','REJECTED')`,
);

let expired = 0;
for (const c of candidates) {
  const { stale } = isStale({ status: c.status, endDate: c.end_date, deadline: c.registration_deadline, now });
  if (stale) {
    await store.exec("UPDATE events SET status='EXPIRED', last_seen=? WHERE event_id=?", now, c.event_id);
    await store.exec("INSERT INTO event_changes(event_id,field,old_value,new_value,detected_at) VALUES (?,?,?,?,?)",
      c.event_id, "status", c.status, "EXPIRED", now,
    );
    expired++;
  }
}

const byStatus = await store.query("SELECT status, COUNT(*) AS c FROM events GROUP BY status");
const byDecision = await store.query("SELECT COALESCE(verification_decision,'NONE') AS d, COUNT(*) AS c FROM events GROUP BY d");
const reviewOpen = await store.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM review_queue WHERE resolved = 0");
const dlq = await store.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM dead_letter_queue");
const flaggedLinks = await store.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM event_links WHERE security_status = 'FLAGGED'");

console.log(JSON.stringify({
  ok: true, expired_now: expired,
  quality: { byStatus, byDecision, review_open: reviewOpen?.c ?? 0, dlq_depth: dlq?.c ?? 0, flagged_links: flaggedLinks?.c ?? 0 },
}, null, 2));
db.close();
