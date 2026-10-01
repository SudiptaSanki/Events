import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { runDiscovery } from "../src/discovery/runner.js";
import { MVP_SOURCES, buildConnector, validateSeeds } from "../src/sources/seeds.js";
import type { DiscoveredItem, SourceConnector } from "../src/sources/types.js";

function fakeSource(slug: string, items: DiscoveredItem[] | Error): SourceConnector {
  return {
    name: () => slug,
    type: () => "PLATFORM",
    level: () => 5,
    discover: async () => {
      if (items instanceof Error) throw items;
      return items;
    },
    parse: () => ({}),
    normalize: (e) => e,
    getRateLimit: () => ({ requestDelayMs: 0, maxRequestsPerRun: 10, concurrentRequests: 1, retryLimit: 0, backoffMs: 0 }),
    getTrustScore: () => 60,
  };
}

const item = (title: string | null, sourceUrl = "https://x.example/e1", eventUrl: string | null = "https://x.example/e1"): DiscoveredItem => ({
  sourceUrl,
  rawContent: "raw",
  extracted: { title, event_url: eventUrl, confidence: 0.5 },
  fetchedAt: new Date().toISOString(),
});

describe("discovery runner (spec 29/47/51)", () => {
  it("inserts new events, clusters repeats, skips title-less items", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const src = fakeSource("s1", [item("AI Hack"), item(null)]);
    const first = await runDiscovery(store, [src]);
    assert.equal(first.totals.inserted, 1);
    assert.equal(first.sources[0]!.skippedNoTitle, 1);
    const events = db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number };
    assert.equal(events.c, 1);
    const second = await runDiscovery(store, [src]);
    assert.equal(second.sources[0]!.status, "SKIPPED_RATE_LIMIT");
    // Same event seen via a DIFFERENT discovery URL attaches provenance (spec 47)...
    const src2 = fakeSource("s2", [item("AI Hack", "https://agg2.example/p9")]);
    const third = await runDiscovery(store, [src2]);
    assert.equal(third.totals.attached, 1);
    assert.equal(third.totals.inserted, 0);
    const srcs = db.prepare("SELECT COUNT(*) AS c FROM event_sources").get() as { c: number };
    assert.equal(srcs.c, 2); // one event, two provenance rows (spec 47)
    // ...while the identical source+URL pair is idempotent (no dup rows).
    db.prepare("UPDATE source_registry SET last_run = NULL WHERE source_id = 's1'").run();
    await runDiscovery(store, [src]);
    const srcs2 = db.prepare("SELECT COUNT(*) AS c FROM event_sources").get() as { c: number };
    assert.equal(srcs2.c, 2);
    db.close();
  });
  it("routes failures to source_runs + dead-letter queue, never silently", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const bad = fakeSource("boom", new Error("BLOCKED_HTTP_403"));
    const summary = await runDiscovery(store, [bad]);
    assert.equal(summary.totals.failed, 1);
    const dlq = db.prepare("SELECT COUNT(*) AS c FROM dead_letter_queue WHERE queue='discovery'").get() as { c: number };
    assert.equal(dlq.c, 1);
    const runs = db.prepare("SELECT error FROM source_runs WHERE source_id='boom'").get() as { error: string };
    assert.ok(runs.error.includes("403"));
    db.close();
  });
  it("dry-run discovers without writing", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const src = fakeSource("s1", [item("AI Hack")]);
    const summary = await runDiscovery(store, [src], { dryRun: true });
    assert.equal(summary.totals.discovered, 1);
    assert.equal(summary.totals.inserted, 0);
    const events = db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number };
    assert.equal(events.c, 0);
    db.close();
  });
});

describe("MVP seeds (spec 72)", () => {
  it("seeds validate: unique slugs, https bases, sane trust + intervals", () => {
    assert.deepEqual(validateSeeds(MVP_SOURCES), []);
    assert.ok(MVP_SOURCES.filter((s) => s.enabled).length >= 10);
  });
  it("every seed builds a working connector object", () => {
    for (const s of MVP_SOURCES) {
      const c = buildConnector(s);
      assert.equal(c.name(), s.slug);
      assert.equal(c.level(), s.level);
    }
  });
});
