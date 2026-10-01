import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase, tableCounts } from "../src/db/sqlite.js";

describe("sqlite dev mode + schema (spec 39/76)", () => {
  it("migrates and exposes all 16 tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "events-test-"));
    try {
      const db = openDatabase(":memory:");
      const version = migrate(db);
      assert.equal(version, 1);
      const counts = tableCounts(db);
      for (const [table, count] of Object.entries(counts)) {
        assert.equal(count, 0, `table ${table} should exist and be empty`);
      }
      // Evidence trail round-trip (spec 41).
      db.prepare("INSERT INTO organizers(organizer_id,name,normalized_name,official_domain,country,type,verified,reputation_score) VALUES (?,?,?,?,?,?,?,?)")
        .run("org1", "IIT Bombay", "iit bombay", "iitb.ac.in", "IN", "university", 1, 95);
      db.prepare("INSERT INTO events(event_id,title,normalized_title,organizer_id,organizer_name,format,status,verification_score) VALUES (?,?,?,?,?,?,?,?)")
        .run("evt1", "Test Hack", "test hack", "org1", "IIT Bombay", "HYBRID", "DISCOVERED", 80);
      db.prepare("INSERT INTO verification_evidence(event_id,source_url,evidence_type,evidence_text,observed_at,supports_claim) VALUES (?,?,?,?,?,?)")
        .run("evt1", "https://iitb.ac.in/hack", "OFFICIAL_PAGE", "Official page links registration.", new Date().toISOString(), 1);
      const row = db.prepare("SELECT COUNT(*) AS c FROM verification_evidence WHERE event_id=?").get("evt1") as { c: number };
      assert.equal(row.c, 1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
