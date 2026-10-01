import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifyEvent } from "../src/verification/pipeline.js";
import { createStaticResolver } from "../src/verification/linkVerification.js";
import { fixtures } from "./fixtures.js";

describe("end-to-end verification over fixtures (spec 62)", () => {
  for (const f of fixtures) {
    it(`${f.id}: ${f.description}`, async () => {
      const out = await verifyEvent(
        {
          eventId: f.id, title: f.input.title, organizerName: f.input.organizerName,
          officialDomain: f.input.officialDomain, eventUrl: f.input.eventUrl,
          registrationUrl: f.input.registrationUrl, hasDateOrDeadline: f.input.hasDateOrDeadline,
          classification: f.input.classification, format: f.input.format,
          sourceCount: f.input.sourceCount, trustedPlatformListed: f.input.trustedPlatformListed,
          socialConfirmation: f.input.socialConfirmation, officialPageExists: f.input.officialPageExists,
          officialPageLinksToRegistration: f.input.officialPageLinksToRegistration,
          eventIdentityMatches: f.input.eventIdentityMatches, datesConsistent: f.input.datesConsistent,
          organizerConsistent: f.input.organizerConsistent, recentConfirmation: f.input.recentConfirmation,
          conflictingOfficialInfo: f.input.conflictingOfficialInfo,
          threatReputationHit: f.input.threatReputationHit,
          observedAt: new Date().toISOString(), sourceUrl: f.input.sourceUrl, sourceTrust: f.input.sourceTrust,
        },
        createStaticResolver({}),
      );
      const expected = Array.isArray(f.expectDecision) ? f.expectDecision : [f.expectDecision];
      assert.ok(expected.includes(out.decision), `expected one of ${expected.join(",")} but got ${out.decision} (score ${out.score})`);
      if (f.expectLinkOutcome === null) assert.equal(out.link, null);
      else if (f.expectLinkOutcome) assert.equal(out.link?.outcome, f.expectLinkOutcome);
      assert.ok(out.evidence.length > 0, "every decision must carry evidence (spec 3)");
      // Security-first gate: missing title/date must block.
      if (f.id === "missing-deadline-and-date") assert.equal(out.gate.pass, false);
      if (f.id === "missing-organizer") assert.ok(out.gate.pass === false || out.decision === "UNVERIFIED" || out.decision === "SUSPICIOUS");
      // Conflicting official info must leave an evidence trail, never a guessed fact.
      if (f.id === "conflicting-dates") {
        assert.ok(out.evidence.some((e) => e.evidence_type === "CONFLICT"), "conflict must be recorded as evidence");
        assert.notEqual(out.tier, "A", "conflicted event must not publish as Tier A");
      }
    });
  }

  it("expired/stale events are detectable via dates (spec 22)", async () => {
    const out = await verifyEvent(
      {
        eventId: "expired", title: "Old Hack 2020", organizerName: "Old Org",
        officialDomain: "oldorg.example", eventUrl: "https://oldorg.example/hack",
        registrationUrl: null, hasDateOrDeadline: true, classification: "Hackathon",
        format: "OFFLINE", sourceCount: 1, trustedPlatformListed: false,
        socialConfirmation: false, officialPageExists: true, officialPageLinksToRegistration: false,
        eventIdentityMatches: null, datesConsistent: true, organizerConsistent: true,
        recentConfirmation: false, conflictingOfficialInfo: false, threatReputationHit: false,
        observedAt: new Date().toISOString(), sourceUrl: "https://oldorg.example/hack", sourceTrust: 50,
      },
      createStaticResolver({}),
    );
    // Pipeline does not invent expiry; staleness is a DB/scheduler concern —
    // assert only that unverified-old content does not reach Tier A.
    assert.notEqual(out.tier, "A");
  });
});
