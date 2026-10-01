import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateScore, emptySignals, publishingGate } from "../src/verification/scoring.js";

describe("verification scoring (spec 15/65/66)", () => {
  it("official page + official link + social + platform scores >= threshold (Tier A)", () => {
    const r = calculateScore({
      ...emptySignals(), officialOrganizerPage: true, officialRegistrationLink: true,
      organizerSocialConfirmation: true, trustedEventPlatform: true, secondIndependentSource: true,
      validHttps: true, consistentDates: true, consistentOrganizer: true, recentConfirmation: true,
    });
    assert.equal(r.decision, "VERIFIED_OFFICIAL");
    assert.equal(r.tier, "A");
    assert.ok(r.score >= 70);
  });
  it("confirmed malicious forces REJECTED/Tier E regardless of positives", () => {
    const r = calculateScore({ ...emptySignals(), officialOrganizerPage: true, confirmedMalicious: true });
    assert.equal(r.decision, "REJECTED");
    assert.equal(r.tier, "E");
  });
  it("social-only discovery stays UNVERIFIED/Tier D", () => {
    const r = calculateScore({ ...emptySignals(), validHttps: true });
    assert.equal(r.decision, "UNVERIFIED");
    assert.equal(r.tier, "D");
  });
  it("publishing gate blocks missing date, missing decision, critical flags", () => {
    const g = publishingGate({
      title: "X", organizerOrSource: "Y", eventPageOrSource: "Z",
      hasDateOrDeadline: false, classification: "Hackathon",
      verificationDecision: "LIKELY_LEGITIMATE",
      registrationOkOrMarkedUnavailable: true, unresolvedCriticalFlags: false,
    });
    assert.equal(g.pass, false);
    assert.ok(g.reasons.includes("MISSING_DATE_AND_DEADLINE"));
  });
});
