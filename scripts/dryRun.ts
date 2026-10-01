/**
 * DRY_RUN harness (spec 64): discover -> extract -> verify -> dedupe,
 * never publishes. Outputs EVENT / SCORE / SOURCE / REG URL / LINK / REASON.
 */
import { verifyEvent } from "../src/verification/pipeline.js";
import { createStaticResolver } from "../src/verification/linkVerification.js";
import { isDuplicate } from "../src/normalize/dedup.js";
import { fixtures } from "../tests/fixtures.js";

const resolve = createStaticResolver({});

for (const f of fixtures) {
  const out = await verifyEvent(
    {
      eventId: f.id,
      title: f.input.title,
      organizerName: f.input.organizerName,
      officialDomain: f.input.officialDomain,
      eventUrl: f.input.eventUrl,
      registrationUrl: f.input.registrationUrl,
      hasDateOrDeadline: f.input.hasDateOrDeadline,
      classification: f.input.classification,
      format: f.input.format,
      sourceCount: f.input.sourceCount,
      trustedPlatformListed: f.input.trustedPlatformListed,
      socialConfirmation: f.input.socialConfirmation,
      officialPageExists: f.input.officialPageExists,
      officialPageLinksToRegistration: f.input.officialPageLinksToRegistration,
      eventIdentityMatches: f.input.eventIdentityMatches,
      datesConsistent: f.input.datesConsistent,
      organizerConsistent: f.input.organizerConsistent,
      recentConfirmation: f.input.recentConfirmation,
      conflictingOfficialInfo: f.input.conflictingOfficialInfo,
      threatReputationHit: f.input.threatReputationHit,
      observedAt: new Date().toISOString(),
      sourceUrl: f.input.sourceUrl,
      sourceTrust: f.input.sourceTrust,
    },
    resolve,
  );
  console.log([
    `EVENT: ${f.input.title ?? "(untitled)"}`,
    `SCORE: ${out.score} (${out.decision} / Tier ${out.tier})`,
    `SOURCE: ${f.input.sourceUrl}`,
    `REG_URL: ${f.input.registrationUrl ?? "(none)"}`,
    `LINK: ${out.link ? `${out.link.outcome} conf=${out.link.confidence} flags=[${out.link.securityFlags.join(",")}]` : "NO_LINK"}`,
    `REASON: ${out.link?.reason ?? "no registration link"} | gate=${out.gate.pass ? "PASS" : "BLOCKED:" + out.gate.reasons.join(",")}`,
    `DUPECHECK: ${isDuplicate({ title: f.input.title ?? "", organizer: f.input.organizerName, startDate: null, city: null, eventUrl: f.input.eventUrl, registrationUrl: f.input.registrationUrl }, { title: "Smart India Hackathon 2026", organizer: "Govt of India", startDate: null, city: null, eventUrl: null, registrationUrl: null }).reason}`,
    `---`,
  ].join("\n"));
}
