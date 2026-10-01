import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import type { Store } from "../src/db/store.js";
import {
  approveEvent, eventDetail, listReview, recheckEvent, recordFeedback,
  rejectEvent, setSourceEnabled, sourceStatus, stats,
} from "../src/admin/ops.js";

const NOW = "2026-10-01T12:00:00.000Z";

function seedDb(): { db: ReturnType<typeof openDatabase>; store: Store } {
  const db = openDatabase(":memory:");
  migrate(db);
  const store = createSqliteStore(db);
  db.prepare("INSERT INTO source_registry(source_id,name,type,trust_score,enabled,rate_limit_ms) VALUES (?,?,?,?,?,?)").run(
    "s1", "s1", "PLATFORM", 60, 1, 60000,
  );
  db.prepare(
    `INSERT INTO events(event_id,title,normalized_title,format,status,verification_score,first_seen,last_seen)
     VALUES (?,?,?,'ONLINE','NEEDS_REVIEW',50,?,?)`,
  ).run("e1", "E1", "e1", NOW, NOW);
  db.prepare("INSERT INTO event_sources(event_id,source_id,source_url,observed_at) VALUES (?,?,?,?)").run(
    "e1", "s1", "https://s1.example/e1", NOW,
  );
  db.prepare("INSERT INTO review_queue(event_id,reason,score,created_at,resolved) VALUES (?,?,?, ?,0)").run(
    "e1", "TIER_D", 50, NOW,
  );
  return { db, store };
}

describe("admin ops (spec 34/35/52)", () => {
  it("lists, approves, and resolves review items", async () => {
    const { db, store } = seedDb();
    assert.equal((await listReview(store)).length, 1);
    assert.equal(await approveEvent(store, "e1", NOW), true);
    assert.equal((await listReview(store)).length, 0);
    const row = db.prepare("SELECT status FROM events WHERE event_id='e1'").get() as { status: string };
    assert.equal(row.status, "VERIFIED");
    db.close();
  });
  it("rejects and rechecks events", async () => {
    const { db, store } = seedDb();
    assert.equal(await rejectEvent(store, "e1", NOW), true);
    assert.equal(await recheckEvent(store, "e1", NOW), true);
    const row = db.prepare("SELECT status, verification_score FROM events WHERE event_id='e1'").get() as {
      status: string; verification_score: number;
    };
    assert.equal(row.status, "DISCOVERED");
    assert.equal(row.verification_score, 0);
    assert.equal(await approveEvent(store, "missing", NOW), false);
    db.close();
  });
  it("toggles sources and reports status with reputation", async () => {
    const { db, store } = seedDb();
    assert.equal(await setSourceEnabled(store, "s1", false), true);
    assert.equal(await setSourceEnabled(store, "nope", false), false);
    const st = await sourceStatus(store);
    assert.equal(st[0]!["enabled"], 0);
    db.close();
  });
  it("feedback adjusts source trust (false claims down, legitimate up)", async () => {
    const { db, store } = seedDb();
    assert.equal(await recordFeedback(store, "e1", "FALSE_LINK", NOW), true);
    let trust = (db.prepare("SELECT trust_score FROM source_registry WHERE source_id='s1'").get() as { trust_score: number }).trust_score;
    assert.equal(trust, 52);
    assert.equal(await recordFeedback(store, "e1", "LEGITIMATE", NOW), true);
    trust = (db.prepare("SELECT trust_score FROM source_registry WHERE source_id='s1'").get() as { trust_score: number }).trust_score;
    assert.equal(trust, 55);
    assert.equal(await recordFeedback(store, "missing", "LEGITIMATE", NOW), false);
    const detail = await eventDetail(store, "e1");
    assert.ok(detail && Array.isArray(detail["sources"]));
    assert.equal(await eventDetail(store, "missing"), null);
    const s = await stats(store) as { reviewOpen: number };
    assert.equal(s.reviewOpen, 0);
    db.close();
  });
});
