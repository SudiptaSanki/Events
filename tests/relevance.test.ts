import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { indiaRelevance } from "../src/india/relevance.js";

describe("india relevance (spec 24)", () => {
  it("scores Indian university event as Indian", () => {
    const r = indiaRelevance({ country: "IN", city: "Bengaluru", organizerName: "IIT", organizerDomain: "iitb.ac.in", eligibility: "Open to Indian students", currencyHint: "₹10 lakh prizes", timezone: "Asia/Kolkata", onlineFromIndia: true });
    assert.equal(r.indian, true);
    assert.ok(r.score >= 30);
  });
  it("treats .ac.in organizer domains as near-certain Indian", () => {
    const r = indiaRelevance({ country: null, city: null, organizerName: "Example University", organizerDomain: "example.edu.in", eligibility: null, currencyHint: null, timezone: null, onlineFromIndia: null });
    assert.equal(r.indian, true);
    assert.ok(r.reasons.includes("INDIAN_ACADEMIC_OR_GOV_DOMAIN"));
  });
  it("does not label foreign events as Indian", () => {
    const r = indiaRelevance({ country: "US", city: "Boston", organizerName: "MIT", organizerDomain: "mit.edu", eligibility: "US only", currencyHint: "$5000", timezone: "America/New_York", onlineFromIndia: false });
    assert.equal(r.indian, false);
  });
});
