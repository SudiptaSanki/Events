import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { queueReminders } from "../src/notify/reminders.js";

const NOW = "2026-10-01T12:00:00.000Z";
const TARGETS = [{ targetId: "telegram:t", channel: "TELEGRAM" as const, destination: "42" }];

function seedEvent(db: ReturnType<typeof openDatabase>, id: string, deadline: string | null, start: string | null): void {
  db.prepare(
    `INSERT INTO events(event_id,title,normalized_title,format,status,verification_score,publishing_tier,
      registration_deadline,start_date,first_seen,last_seen)
     VALUES (?,?,?,'ONLINE','VERIFIED',80,'A',?,?,?,?)`,
  ).run(id, "T", "t", deadline, start, NOW, NOW);
}

describe("deadline reminders (spec 49)", () => {
  it("queues 24h/48h/start reminders exactly once each", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    db.prepare("INSERT INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)").run(
      "telegram:t", "TELEGRAM", "42",
    );
    seedEvent(db, "urgent", "2026-10-01T20:00:00.000Z", null); // ~8h
    seedEvent(db, "soon", "2026-10-02T18:00:00.000Z", null); // ~30h
    seedEvent(db, "later", "2026-10-10T12:00:00.000Z", "2026-10-02T12:00:00.000Z"); // start <72h
    seedEvent(db, "far", "2026-11-01T12:00:00.000Z", null); // nothing due
    const s = await queueReminders(store, TARGETS, NOW);
    assert.equal(s.reminder24, 1);
    assert.equal(s.reminder48, 1);
    assert.equal(s.reminderStart, 1);
    const again = await queueReminders(store, TARGETS, NOW); // idempotent
    assert.deepEqual([again.reminder24, again.reminder48, again.reminderStart], [0, 0, 0]);
    db.close();
  });
});
