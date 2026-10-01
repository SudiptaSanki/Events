/**
 * Store parity (Phase 8): SqliteStore and D1Store (over a fake D1 binding)
 * must behave identically for the pipeline's core flows. Plus Worker
 * entrypoint smoke tests (health + offline scheduled dry-run).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { createD1Store, type D1Like } from "../src/db/d1Store.js";
import type { Store } from "../src/db/store.js";
import { insertDiscoveredEvent, findEventByDedupeKey, attachSource } from "../src/db/events.js";
import { recordSourceOutcome } from "../src/quality/reputation.js";
import { approveEvent, listReview } from "../src/admin/ops.js";
import worker, { type Env } from "../src/worker.js";

const NOW = "2026-10-01T12:00:00.000Z";

/** Minimal in-memory D1 binding backed by node:sqlite (test-only). */
export function createFakeD1(db: DatabaseSync): D1Like {
  return {
    prepare: (query: string) => ({
      bind: (...params: unknown[]) => {
        const args = params as never[];
        return {
          first: async <T,>(): Promise<T | null> =>
            (db.prepare(query).get(...args) as T | undefined) ?? null,
          all: async <T,>(): Promise<{ results: T[] }> => ({
            results: db.prepare(query).all(...args) as T[],
          }),
          run: async () => {
            const info = db.prepare(query).run(...args);
            return {
              success: true,
              meta: {
                changes: Number(info.changes ?? 0),
                last_row_id: (info.lastInsertRowid as number | null) ?? null,
              },
            };
          },
        };
      },
    }),
  };
}

async function coreFlow(store: Store): Promise<Record<string, number | string | boolean>> {
  await store.exec(
    "INSERT INTO source_registry(source_id,name,type,trust_score,enabled,rate_limit_ms) VALUES (?,?,?,?,?,?)",
    "s1", "s1", "PLATFORM", 60, 1, 60000,
  );
  const eventId = await insertDiscoveredEvent(
    store,
    {
      title: "Parity Hack", organizer: "Parity Org", startDate: "2026-12-01T00:00:00.000Z",
      city: null, eventUrl: "https://parity.example/hack", registrationUrl: null,
      description: null, format: "ONLINE", categories: ["Hackathon"],
    },
    { sourceId: "s1", sourceUrl: "https://parity.example/hack", sourceLevel: 5 },
    NOW,
  );
  await attachSource(store, eventId, { sourceId: "s2", sourceUrl: "https://agg.example/p", sourceLevel: 5 }, NOW);
  const found = await findEventByDedupeKey(store, (await store.queryOne<{ dedupe_key: string }>(
    "SELECT dedupe_key FROM events WHERE event_id=?", eventId,
  ))?.dedupe_key ?? "none");
  await recordSourceOutcome(store, "s1", "valid", NOW);
  const trust = await store.queryOne<{ trust_score: number }>("SELECT trust_score FROM source_registry WHERE source_id='s1'");
  const sources = await store.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM event_sources WHERE event_id=?", eventId);
  const links = await store.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM event_links WHERE event_id=?", eventId);
  return {
    foundPresent: typeof found?.event_id === "string" && found.event_id.length > 10,
    trust: trust?.trust_score ?? -1,
    sources: sources?.c ?? -1,
    links: links?.c ?? -1,
  };
}

describe("store parity (Phase 8)", () => {
  it("sqlite and D1 stores produce identical pipeline results", async () => {
    const sqliteDb = openDatabase(":memory:");
    migrate(sqliteDb);
    const sqliteResult = await coreFlow(createSqliteStore(sqliteDb));
    sqliteDb.close();

    const d1Db = openDatabase(":memory:");
    migrate(d1Db);
    const d1Result = await coreFlow(createD1Store(createFakeD1(d1Db)));
    d1Db.close();

    assert.deepEqual(d1Result, sqliteResult);
    assert.equal(sqliteResult.foundPresent, true);
    assert.equal(sqliteResult.trust, 63);
    assert.equal(sqliteResult.sources, 2);
    assert.equal(sqliteResult.links, 1); // only EVENT_PAGE (no registration URL)
  });

  it("admin ops work identically on the D1 store", async () => {
    const d1Db = openDatabase(":memory:");
    migrate(d1Db);
    const store = createD1Store(createFakeD1(d1Db));
    await store.exec(
      "INSERT INTO events(event_id,title,normalized_title,format,status,verification_score,first_seen,last_seen) VALUES (?,?,?,'ONLINE','NEEDS_REVIEW',50,?,?)",
      "e1", "E1", "e1", NOW, NOW,
    );
    await store.exec("INSERT INTO review_queue(event_id,reason,score,created_at,resolved) VALUES (?,?,?, ?,0)", "e1", "R", 50, NOW);
    assert.equal((await listReview(store)).length, 1);
    assert.equal(await approveEvent(store, "e1", NOW), true);
    d1Db.close();
  });
});

describe("worker entrypoint (Phase 8)", () => {
  it("serves /health without a database", async () => {
    const res = await worker.fetch(new Request("https://x.example/health"), { DB: createFakeD1(openDatabase(":memory:")) } as Env);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it("scheduled dry-run completes offline with stubbed fetch", async () => {
    const d1Db = openDatabase(":memory:");
    migrate(d1Db);
    const realFetch = globalThis.fetch;
    // Offline stub: robots allow, everything else 404 (no sitemaps anywhere).
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow:\n", { status: 200 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    try {
      const env = { DB: createFakeD1(d1Db), DRY_RUN: "true" } as Env;
      await worker.scheduled({ cron: "*/30 * * * *", scheduledTime: Date.now() } as ScheduledEvent, env);
      const runs = await createD1Store(createFakeD1(d1Db)).queryOne<{ c: number }>(
        "SELECT COUNT(*) AS c FROM source_runs",
      );
      assert.equal(runs?.c ?? 0, 0); // dry-run writes nothing
    } finally {
      globalThis.fetch = realFetch;
      d1Db.close();
    }
  });
});
