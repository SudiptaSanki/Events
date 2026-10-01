import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { freshnessScore, isStale } from "../src/quality/freshness.js";
import { diffTrackedFields, resolveFieldConflict } from "../src/quality/changes.js";
import { applyReputationStep, recordSourceOutcome } from "../src/quality/reputation.js";

const NOW = "2026-09-30T12:00:00.000Z";

describe("freshness + staleness (spec 22/48)", () => {
  it("freshly verified scores 100, decays with age, caps unverified at 40", () => {
    assert.equal(freshnessScore({ firstSeen: NOW, lastSeen: NOW, lastVerified: NOW, now: NOW }), 100);
    assert.ok(freshnessScore({ firstSeen: NOW, lastSeen: NOW, lastVerified: "2026-09-20T12:00:00.000Z", now: NOW }) < 100);
    assert.equal(freshnessScore({ firstSeen: NOW, lastSeen: NOW, lastVerified: null, now: NOW }), 40);
    assert.equal(freshnessScore({ firstSeen: null, lastSeen: null, lastVerified: null, now: NOW }), 0);
  });
  it("expires past events/deadlines with grace, never terminal states twice", () => {
    assert.deepEqual(
      isStale({ status: "VERIFIED", endDate: "2026-09-01T00:00:00.000Z", deadline: null, now: NOW }),
      { stale: true, reason: "PAST_END_DATE" },
    );
    assert.deepEqual(
      isStale({ status: "VERIFIED", endDate: null, deadline: "2026-09-29T00:00:00.000Z", now: NOW }),
      { stale: true, reason: "PAST_DEADLINE" },
    );
    assert.equal(isStale({ status: "VERIFIED", endDate: "2026-12-01T00:00:00.000Z", deadline: null, now: NOW }).stale, false);
    assert.equal(isStale({ status: "EXPIRED", endDate: "2020-01-01T00:00:00.000Z", deadline: null, now: NOW }).stale, false);
  });
});

describe("field consistency (spec 13/14)", () => {
  it("diffs only tracked fields", () => {
    const diffs = diffTrackedFields(
      { title: "A", start_date: "2026-10-01", city: null },
      { title: "A", start_date: "2026-10-05", city: "Pune" },
    );
    assert.equal(diffs.length, 2);
  });
  it("adopts one-sided values, reviews genuine conflicts, trusts newest official", () => {
    assert.deepEqual(resolveFieldConflict(null, "2026-10-05", false), { value: "2026-10-05", needsReview: false });
    assert.deepEqual(resolveFieldConflict("2026-10-01", null, false), { value: "2026-10-01", needsReview: false });
    assert.deepEqual(resolveFieldConflict("2026-10-01", "2026-10-05", false), { value: "2026-10-01", needsReview: true });
    assert.deepEqual(resolveFieldConflict("2026-10-01", "2026-10-05", true), { value: "2026-10-05", needsReview: false });
  });
});

describe("source reputation (spec 53)", () => {
  it("rewards valid, penalizes fake, never a one-strike blacklist", () => {
    assert.equal(applyReputationStep(60, "valid"), 63);
    assert.equal(applyReputationStep(60, "fake"), 52);
    assert.equal(applyReputationStep(60, "duplicate"), 59);
    assert.equal(applyReputationStep(2, "fake"), 0); // clamped, not negative
    assert.equal(applyReputationStep(99, "valid"), 100); // damped at the top
  });
  it("persists counters + trust in the database", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    db.prepare("INSERT INTO source_registry(source_id,name,type,trust_score,enabled,rate_limit_ms) VALUES (?,?,?,?,?,?)").run(
      "s1", "s1", "PLATFORM", 60, 1, 60000,
    );
    await recordSourceOutcome(store, "s1", "valid", NOW);
    await recordSourceOutcome(store, "s1", "fake", NOW);
    const rep = db.prepare("SELECT valid_events, fake_events FROM source_reputation WHERE source_id='s1'").get() as {
      valid_events: number; fake_events: number;
    };
    assert.equal(rep.valid_events, 1);
    assert.equal(rep.fake_events, 1);
    const reg = db.prepare("SELECT trust_score FROM source_registry WHERE source_id='s1'").get() as { trust_score: number };
    assert.equal(reg.trust_score, 60 + 3 - 8);
    db.close();
  });
});
