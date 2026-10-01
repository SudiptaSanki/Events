import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { runLoopStages } from "../src/scheduler/loop.js";
import { insertDiscoveredEvent } from "../src/db/events.js";
import { createStaticResolver } from "../src/verification/linkVerification.js";
import { clearRobotsCache } from "../src/discovery/robots.js";
import { fakeWeb } from "./helpers.js";
import type { SourceConnector } from "../src/sources/types.js";

const NOW = "2026-10-01T12:00:00.000Z";

function emptyConnector(slug: string): SourceConnector {
  return {
    name: () => slug,
    type: () => "PLATFORM",
    level: () => 5,
    discover: async () => [],
    parse: () => ({}),
    normalize: (e) => e,
    getRateLimit: () => ({ requestDelayMs: 0, maxRequestsPerRun: 10, concurrentRequests: 1, retryLimit: 0, backoffMs: 0 }),
    getTrustScore: () => 60,
  };
}

describe("scheduler loop stages", () => {
  it("verifies pending and re-verifies published events in one run", async () => {
    clearRobotsCache();
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    await store.exec(
      "INSERT INTO source_registry(source_id,name,type,trust_score,enabled,rate_limit_ms) VALUES (?,?,?,?,?,?)",
      "s1", "s1", "PLATFORM", 60, 1, 60000,
    );
    // One DISCOVERED (goes through verification) + one VERIFIED (reverified).
    await insertDiscoveredEvent(
      store,
      {
        title: "Loop Hack", organizer: "Loop Org", startDate: "2026-12-01T00:00:00.000Z",
        city: null, eventUrl: "https://loop.example/hack", registrationUrl: null,
        description: null, format: "ONLINE", categories: ["Hackathon"],
      },
      { sourceId: "s1", sourceUrl: "https://loop.example/hack", sourceLevel: 5 },
      NOW,
    );
    await store.exec(
      `INSERT INTO events(event_id,title,normalized_title,format,status,verification_score,publishing_tier,
        verification_decision,start_date,last_verified,first_seen,last_seen)
       VALUES (?,?,?,'ONLINE','VERIFIED',80,'B','VERIFIED_BY_MULTIPLE_SOURCES','2026-12-02T00:00:00.000Z',?,?,?)`,
      "old1", "Old Hack", "old hack", "2026-01-01T00:00:00.000Z", NOW, NOW,
    );
    await store.exec("INSERT INTO event_sources(event_id,source_id,source_url,observed_at) VALUES (?,?,?,?)",
      "old1", "s1", "https://loop.example/old", NOW);
    const fetchFn = fakeWeb({
      "loop.example/hack": { body: "<html><body><h1>Loop Hack</h1></body></html>" },
      "loop.example/old": { body: "<html><body><h1>Old Hack</h1></body></html>" },
    });
    const report = await runLoopStages(store, {
      connectors: [emptyConnector("s1")],
      targets: [],
      verifyLimit: 10,
      reverifyLimit: 10,
      dryRun: false,
      now: () => NOW,
      fetchFn,
      redirectResolver: createStaticResolver({}),
    });
    assert.equal(report.verification?.pending, 1);
    assert.equal(report.reverification?.checked, 1);
    // No-churn: thin re-resolution must not demote a published event.
    assert.deepEqual(report.reverification?.decisions, { VERIFIED: 1 });
    // Live run wrote statuses + separate confidence signals (spec 17).
    const row = await store.queryOne<{
      status: string; india_relevance_score: number | null; freshness_score: number | null; source_trust_score: number | null;
    }>("SELECT status, india_relevance_score, freshness_score, source_trust_score FROM events WHERE title='Loop Hack'");
    assert.ok(row && ["VERIFIED", "NEEDS_REVIEW", "SUSPICIOUS"].includes(row.status));
    assert.equal(typeof row?.india_relevance_score, "number");
    assert.equal(typeof row?.freshness_score, "number");
    assert.equal(row?.source_trust_score, 60); // learned registry trust wired through
    db.close();
  });
});
