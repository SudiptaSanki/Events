import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import {
  CachedThreatIntel,
  GoogleSafeBrowsingProvider,
  NoopThreatIntel,
  providerFromEnv,
  recordDomainVerdict,
  type ThreatIntelProvider,
} from "../src/security/threatIntel.js";

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("threat intel providers (spec 10 check 7)", () => {
  it("noop always returns UNKNOWN (never claims safe, never hits)", async () => {
    const r = await new NoopThreatIntel().checkUrl("https://evil.example/x");
    assert.equal(r.verdict, "UNKNOWN");
    assert.deepEqual(r.threatTypes, []);
  });
  it("safe-browsing maps matches to HIT with threat types", async () => {
    const p = new GoogleSafeBrowsingProvider(
      "KEY",
      fakeFetch({ matches: [{ threatType: "SOCIAL_ENGINEERING" }] }),
    );
    const r = await p.checkUrl("https://evil.example/x");
    assert.equal(r.verdict, "HIT");
    assert.deepEqual(r.threatTypes, ["SOCIAL_ENGINEERING"]);
  });
  it("safe-browsing empty matches and provider errors degrade to UNKNOWN", async () => {
    const empty = new GoogleSafeBrowsingProvider("KEY", fakeFetch({}));
    assert.equal((await empty.checkUrl("https://x.example/")).verdict, "UNKNOWN");
    const http500 = new GoogleSafeBrowsingProvider("KEY", fakeFetch({ error: {} }, 500));
    assert.equal((await http500.checkUrl("https://x.example/")).verdict, "UNKNOWN");
    const down = new GoogleSafeBrowsingProvider("KEY", (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch);
    assert.equal((await down.checkUrl("https://x.example/")).verdict, "UNKNOWN");
  });
  it("cache bounds quota: second identical check makes no request", async () => {
    let calls = 0;
    const counting = {
      name: () => "counting",
      checkUrl: async (url: string) => {
        calls++;
        return { verdict: "UNKNOWN" as const, threatTypes: [], provider: "counting", checkedAt: new Date().toISOString() };
      },
    } satisfies ThreatIntelProvider;
    const cached = new CachedThreatIntel(counting, 60_000);
    await cached.checkUrl("https://x.example/a");
    await cached.checkUrl("https://x.example/a");
    assert.equal(calls, 1);
    assert.equal(cached.cacheSize(), 1);
  });
  it("env without key yields noop; verdicts persist to domain reputation", async () => {
    delete process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    assert.equal(providerFromEnv().name(), "noop");
    process.env.GOOGLE_SAFE_BROWSING_API_KEY = "KEY";
    assert.ok(providerFromEnv().name().includes("google"));
    delete process.env.GOOGLE_SAFE_BROWSING_API_KEY;

    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    await recordDomainVerdict(store, "evil.example", {
      verdict: "HIT", threatTypes: ["MALWARE"], provider: "google-safe-browsing", checkedAt: new Date().toISOString(),
    }, new Date().toISOString());
    const row = db.prepare("SELECT reputation, notes FROM domain_reputation WHERE domain='evil.example'").get() as {
      reputation: number; notes: string;
    };
    assert.equal(row.reputation, 0);
    assert.ok(row.notes.includes("MALWARE"));
    // UNKNOWN verdicts write nothing.
    await recordDomainVerdict(store, "clean.example", {
      verdict: "UNKNOWN", threatTypes: [], provider: "noop", checkedAt: new Date().toISOString(),
    }, new Date().toISOString());
    const missing = db.prepare("SELECT COUNT(*) AS c FROM domain_reputation WHERE domain='clean.example'").get() as { c: number };
    assert.equal(missing.c, 0);
    db.close();
  });
});
