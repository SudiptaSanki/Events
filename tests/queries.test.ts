import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateSearchQueries } from "../src/discovery/queries.js";

describe("search query generator (spec 7)", () => {
  it("builds deduplicated base + city queries", () => {
    const q = generateSearchQueries({ year: 2026, maxQueries: 500 });
    assert.ok(q.includes("hackathon India"));
    assert.ok(q.includes("hackathon Kolkata"));
    assert.ok(q.includes("AI hackathon Bengaluru"));
    assert.equal(new Set(q.map((s) => s.toLowerCase())).size, q.length);
  });
  it("respects maxQueries cap", () => {
    assert.ok(generateSearchQueries({ maxQueries: 5 }).length <= 5);
  });
});
