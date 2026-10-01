/**
 * Deadline / event-date reminders (spec 49). Queues REMINDER notifications:
 * - registration deadline < 48h  -> REMINDER_48 (high priority),
 * - registration deadline < 24h  -> REMINDER_24 (urgent),
 * - event start < 72h            -> REMINDER_START (optional),
 * one per event per template (no duplicates). Closed/cancelled/expired events
 * never remind. Dispatch treats REMINDER_* like ALERT at send time.
 */
import type { Store } from "../db/store.js";
import { targetMatchesEvent, type ChannelTarget } from "../notify/dispatch.js";

export interface ReminderSummary {
  reminder48: number;
  reminder24: number;
  reminderStart: number;
}

export async function queueReminders(store: Store, targets: ChannelTarget[], nowIso: string): Promise<ReminderSummary> {
  const summary: ReminderSummary = { reminder48: 0, reminder24: 0, reminderStart: 0 };
  const nowMs = Date.parse(nowIso);
  const rows = await store.query<{ event_id: string; registration_deadline: string | null; start_date: string | null; categories: string | null; city: string | null }>(
    `SELECT event_id, registration_deadline, start_date, categories, city FROM events
     WHERE status IN ('VERIFIED','PUBLISHED','UPDATED')`,
  );

  for (const row of rows) {
    const due: Array<"REMINDER_24" | "REMINDER_48" | "REMINDER_START"> = [];
    if (row.registration_deadline) {
      const t = Date.parse(row.registration_deadline);
      if (!Number.isNaN(t) && t > nowMs) {
        const hrs = (t - nowMs) / 3_600_000;
        if (hrs < 24) due.push("REMINDER_24");
        else if (hrs < 48) due.push("REMINDER_48");
      }
    }
    if (row.start_date) {
      const t = Date.parse(row.start_date);
      if (!Number.isNaN(t) && t > nowMs && (t - nowMs) / 3_600_000 < 72) {
        due.push("REMINDER_START");
      }
    }
    for (const template of due) {
      for (const target of targets) {
        if (!targetMatchesEvent(target.filter, row)) continue;
        const prior = await store.queryOne<{ one: number }>(
          "SELECT 1 AS one FROM notifications WHERE event_id=? AND target_id=? AND template=? LIMIT 1",
          row.event_id,
          target.targetId,
          template,
        );
        if (prior) continue;
        await store.exec(
          `INSERT INTO notifications(event_id,target_id,template,status,created_at) VALUES (?,?,?, 'QUEUED', ?)`,
          row.event_id,
          target.targetId,
          template,
          nowIso,
        );
        if (template === "REMINDER_24") summary.reminder24++;
        else if (template === "REMINDER_48") summary.reminder48++;
        else summary.reminderStart++;
      }
    }
  }
  return summary;
}
