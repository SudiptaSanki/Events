import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { createStaticResolver } from "../src/verification/linkVerification.js";
import { recheckLinks } from "../src/quality/linkHealth.js";

const NOW = "2026-10-01T12:00:00.000Z";
const OLD = "2026-09-20T12:00:00.000Z"; // older than both recheck windows

function seedLink(
  db: ReturnType<typeof openDatabase>,
  opts: { finalUrl: string; lastChecked?: string | null; urlType?: string },
): { eventId: string; linkId: number } {
  const eventId = `e-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO events(event_id,title,normalized_title,format,status,verification_score,registration_url,first_seen,last_seen)
     VALUES (?,?,?,'UNKNOWN','VERIFIED',80,?, ?, ?)`,
  ).run(eventId, "T", "t", opts.finalUrl, NOW, NOW);
  const info = db.prepare(
    `INSERT INTO event_links(event_id,url_type,original_url,canonical_url,final_url,domain,is_https,
      redirect_count,security_status,verification_status,last_checked,first_seen)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    eventId, opts.urlType ?? "REGISTRATION", opts.finalUrl, opts.finalUrl, opts.finalUrl,
    new URL(opts.finalUrl).hostname, 1, 0, "CLEAR_LOCAL_CHECKS", "VERIFIED",
    opts.lastChecked === undefined ? OLD : opts.lastChecked, OLD,
  );
  return { eventId, linkId: Number(info.lastInsertRowid) };
}

describe("link health monitoring (spec 21)", () => {
  it("leaves fresh links alone, passes unchanged destinations", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    seedLink(db, { finalUrl: "https://register.example.edu.in/f", lastChecked: NOW });
    const s = await recheckLinks(store, {
      redirectResolver: createStaticResolver({
        "https://register.example.edu.in/f": {
          finalUrl: "https://register.example.edu.in/f",
          chain: [{ url: "https://register.example.edu.in/f", status: 200 }],
          redirectCount: 0, error: null,
        },
      }),
      now: () => NOW,
    });
    assert.equal(s.checked, 0); // within the 6h window — not due
    db.close();
  });

  it("flags host changes, stops advertising the old link, queues review", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const { eventId } = seedLink(db, { finalUrl: "https://register.example.edu.in/f" });
    const s = await recheckLinks(store, {
      redirectResolver: createStaticResolver({
        "https://register.example.edu.in/f": {
          finalUrl: "https://evil.example/f",
          chain: [
            { url: "https://register.example.edu.in/f", status: 301 },
            { url: "https://evil.example/f", status: 200 },
          ],
          redirectCount: 1, error: null,
        },
      }),
      now: () => NOW,
    });
    assert.equal(s.hostChanged, 1);
    const link = db.prepare("SELECT verification_status, security_status FROM event_links WHERE event_id=?").get(eventId) as {
      verification_status: string; security_status: string;
    };
    assert.equal(link.verification_status, "REVIEW");
    const evt = db.prepare("SELECT registration_url, status FROM events WHERE event_id=?").get(eventId) as {
      registration_url: string | null; status: string;
    };
    assert.equal(evt.registration_url, null); // old link withdrawn (spec 21)
    assert.equal(evt.status, "NEEDS_REVIEW");
    const rq = db.prepare("SELECT reason FROM review_queue WHERE event_id=?").get(eventId) as { reason: string };
    assert.ok(rq.reason.includes("LINK_REVIEW_REQUIRED"));
    db.close();
  });

  it("marks unresolvable links UNREACHABLE with review + audit row", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const { eventId } = seedLink(db, { finalUrl: "https://gone.example/f" });
    const s = await recheckLinks(store, {
      redirectResolver: async () => ({ finalUrl: null, chain: [], redirectCount: 0, error: "DNS_FAILED" }),
      now: () => NOW,
    });
    assert.equal(s.unreachable, 1);
    const link = db.prepare("SELECT security_status, verification_status FROM event_links WHERE event_id=?").get(eventId) as {
      security_status: string; verification_status: string;
    };
    assert.equal(link.security_status, "UNREACHABLE");
    assert.equal(link.verification_status, "REVIEW");
    const rq = db.prepare("SELECT COUNT(*) AS c FROM review_queue WHERE event_id=?").get(eventId) as { c: number };
    assert.equal(rq.c, 1);
    db.close();
  });

  it("records resolution failures as UNREACHABLE", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const { eventId } = seedLink(db, { finalUrl: "https://down.example/f" });
    const failing = async (): Promise<never> => {
      throw new Error("boom");
    };
    const s = await recheckLinks(store, { redirectResolver: failing, now: () => NOW });
    assert.equal(s.errors, 1);
    const checks = db.prepare("SELECT COUNT(*) AS c FROM link_checks WHERE link_id IN (SELECT link_id FROM event_links WHERE event_id=?)").get(eventId) as { c: number };
    assert.equal(checks.c, 1);
    db.close();
  });
});
