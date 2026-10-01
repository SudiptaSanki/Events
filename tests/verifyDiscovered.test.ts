import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { insertDiscoveredEvent } from "../src/db/events.js";
import { clearRobotsCache } from "../src/discovery/robots.js";
import { createStaticResolver } from "../src/verification/linkVerification.js";
import { verifyDiscoveredEvent } from "../src/verification/verifyDiscovered.js";
import { fakeWeb } from "./helpers.js";

const NOW = "2026-09-30T00:00:00.000Z";

async function seedEvent(
  db: ReturnType<typeof openDatabase>,
  overrides: Partial<{ title: string; eventUrl: string; regUrl: string | null; start: string | null; level: number; sourceUrl: string }> = {},
) {
  const store = createSqliteStore(db);
  const eventId = await insertDiscoveredEvent(
    store,
    {
      title: overrides.title ?? "Example AI Hack 2026",
      organizer: "Example University",
      startDate: overrides.start ?? "2026-12-12T09:00:00.000Z",
      city: null,
      eventUrl: overrides.eventUrl ?? "https://example.edu.in/ai-hack",
      registrationUrl: overrides.regUrl ?? "https://register.example.edu.in/form",
      description: null,
      format: "HYBRID",
      categories: ["Hackathon"],
    },
    { sourceId: "test-src", sourceUrl: overrides.sourceUrl ?? "https://example.edu.in/ai-hack", sourceLevel: overrides.level ?? 3 },
    NOW,
  );
  const row = db.prepare(
    "SELECT event_id, title, organizer_name, event_url, registration_url, start_date, registration_deadline, categories, format, status, first_seen, last_seen FROM events WHERE event_id = ?",
  ).get(eventId) as never;
  return row;
}

const EVENT_PAGE = `<html><body><h1>Example AI Hack 2026</h1>
<a href="https://register.example.edu.in/form">Register</a></body></html>`;
const REG_PAGE = `<html><body><h1>Example AI Hack 2026 Registration</h1><p>Example University</p></body></html>`;

describe("verifyDiscovered end-to-end (Phase 3)", () => {
  beforeEach(() => clearRobotsCache());

  it("official L3 event verifies, persists evidence, sets registration URL", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const event = await seedEvent(db);
    const fetchFn = fakeWeb({
      "example.edu.in/ai-hack": { body: EVENT_PAGE },
      "register.example.edu.in/form": { body: REG_PAGE },
    });
    const result = await verifyDiscoveredEvent(store, event, {
      fetchFn, redirectResolver: createStaticResolver({}), now: () => NOW,
    });
    assert.equal(result.newStatus, "VERIFIED");
    assert.equal(result.output.decision, "VERIFIED_OFFICIAL");
    assert.equal(result.wrote, true);
    const row = db.prepare("SELECT status, verification_score, registration_url FROM events WHERE event_id=?").get(
      result.eventId,
    ) as { status: string; verification_score: number; registration_url: string | null };
    assert.equal(row.status, "VERIFIED");
    assert.ok((row.verification_score ?? 0) >= 60); // Tier A threshold (single pristine official source ≈ 65)
    assert.equal(row.registration_url, "https://register.example.edu.in/form");
    const ev = db.prepare("SELECT evidence_type FROM verification_evidence WHERE event_id=?").all(result.eventId) as Array<{ evidence_type: string }>;
    const types = ev.map((e) => e.evidence_type);
    assert.ok(types.includes("LINK_VERIFICATION"), "link decision must be evidenced");
    assert.ok(types.includes("OFFICIAL_PAGE"), "official-page claim must be evidenced");
    const rq = db.prepare("SELECT COUNT(*) AS c FROM review_queue WHERE event_id=?").get(result.eventId) as { c: number };
    assert.equal(rq.c, 0);
    db.close();
  });

  it("impersonating registration goes SUSPICIOUS with flags + review row", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const event = await seedEvent(db, {
      eventUrl: "https://example.edu.in/ai-hack",
      regUrl: "https://xn--exmple-cua.example/register",
    });
    const fetchFn = fakeWeb({
      "example.edu.in/ai-hack": { body: `<html><body><h1>Example AI Hack</h1></body></html>` },
      "xn--exmple-cua.example/register": { body: `<html><body><p>Register now prizes</p></body></html>` },
    });
    const result = await verifyDiscoveredEvent(store, event, {
      fetchFn, redirectResolver: createStaticResolver({}), now: () => NOW,
    });
    assert.ok(["SUSPICIOUS", "REJECTED"].includes(result.newStatus));
    const flags = db.prepare("SELECT COUNT(*) AS c FROM security_flags WHERE event_id=?").get(result.eventId) as { c: number };
    assert.ok(flags.c >= 1);
    const stored = db.prepare("SELECT registration_url, registration_unverified_note FROM events WHERE event_id=?").get(
      result.eventId,
    ) as { registration_url: string | null; registration_unverified_note: string | null };
    assert.equal(stored.registration_url, null); // never publish unverified reg links (spec 2)
    assert.ok(stored.registration_unverified_note);
    db.close();
  });

  it("missing date AND deadline lands in NEEDS_REVIEW, never VERIFIED", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const event = await seedEvent(db, { start: null });
    db.prepare("UPDATE events SET start_date = NULL, registration_deadline = NULL WHERE event_id = ?").run(
      (event as { event_id: string }).event_id,
    );
    const row = {
      ...(event as object),
      start_date: null,
      registration_deadline: null,
    } as never;
    const fetchFn = fakeWeb({
      "example.edu.in/ai-hack": { body: EVENT_PAGE },
      "register.example.edu.in/form": { body: REG_PAGE },
    });
    const result = await verifyDiscoveredEvent(store, row, {
      fetchFn, redirectResolver: createStaticResolver({}), now: () => NOW,
    });
    assert.equal(result.newStatus, "NEEDS_REVIEW");
    assert.equal(result.output.gate.pass, false);
    db.close();
  });

  it("dry-run resolves and scores but writes nothing", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const event = await seedEvent(db);
    const fetchFn = fakeWeb({
      "example.edu.in/ai-hack": { body: EVENT_PAGE },
      "register.example.edu.in/form": { body: REG_PAGE },
    });
    const result = await verifyDiscoveredEvent(store, event, {
      fetchFn, redirectResolver: createStaticResolver({}), now: () => NOW, dryRun: true,
    });
    assert.equal(result.wrote, false);
    const row = db.prepare("SELECT status FROM events WHERE event_id=?").get(result.eventId) as { status: string };
    assert.equal(row.status, "DISCOVERED");
    db.close();
  });
});
