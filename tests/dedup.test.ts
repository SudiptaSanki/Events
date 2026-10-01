import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupeKey, isDuplicate, normalizeCity, normalizeOrganizerName, normalizeTitle } from "../src/normalize/dedup.js";

describe("deduplication (spec 23)", () => {
  it("merges SIH abbreviation with organizer+date evidence", () => {
    const d = isDuplicate(
      { title: "Smart India Hackathon 2026", organizer: "Govt of India", startDate: "2026-12-01", city: null, eventUrl: null, registrationUrl: null },
      { title: "SIH 2026", organizer: "Government of India Official", startDate: "2026-12-01", city: null, eventUrl: null, registrationUrl: null },
    );
    assert.equal(d.duplicate, true);
  });
  it("merges on same canonical registration URL", () => {
    const d = isDuplicate(
      { title: "Totally Different Name A", organizer: null, startDate: null, city: null, eventUrl: null, registrationUrl: "https://devfolio.co/xyz?utm_source=a" },
      { title: "Totally Different Name B", organizer: null, startDate: null, city: null, eventUrl: null, registrationUrl: "https://devfolio.co/xyz" },
    );
    assert.equal(d.duplicate, true);
    assert.equal(d.reason, "SAME_CANONICAL_REGISTRATION_URL");
  });
  it("never merges on similar names alone", () => {
    const d = isDuplicate(
      { title: "AI Hackathon", organizer: "Org A", startDate: "2026-10-01", city: null, eventUrl: null, registrationUrl: null },
      { title: "AI Hackathon", organizer: "Org B", startDate: "2026-11-05", city: null, eventUrl: null, registrationUrl: null },
    );
    assert.equal(d.duplicate, false);
  });
  it("normalizes organizers and cities, keeps originals", () => {
    assert.equal(normalizeOrganizerName("ABC Univ. Official"), normalizeOrganizerName("ABC University"));
    assert.deepEqual(normalizeCity("Bangalore"), { normalized: "Bengaluru", original: "Bangalore" });
    assert.ok(normalizeTitle("SIH 2026!!!").length > 0);
    assert.ok(dedupeKey({ title: "X", organizer: null, startDate: null, city: null, eventUrl: null, registrationUrl: null }).length > 0);
  });
});
