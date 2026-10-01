/**
 * Event verification pipeline (spec 74, first verification stages).
 * Pure orchestration over deterministic modules — no network, no AI calls.
 * Every decision is accompanied by evidence entries (spec 41).
 */
import { calculateScore, emptySignals, publishingGate, type ScoreSignals } from "./scoring.js";
import type {
  EventFormat,
  PublishingTier,
  VerificationDecision,
  VerificationEvidence,
} from "../types.js";
import { verifyLink, type LinkVerificationResult, type RedirectResolver } from "./linkVerification.js";

export interface VerificationInput {
  eventId: string;
  title: string | null;
  organizerName: string | null;
  officialDomain: string | null;
  eventUrl: string | null;
  registrationUrl: string | null;
  hasDateOrDeadline: boolean;
  classification: string | null;
  format: EventFormat | null;
  sourceCount: number;
  trustedPlatformListed: boolean;
  socialConfirmation: boolean;
  officialPageExists: boolean;
  officialPageLinksToRegistration: boolean;
  eventIdentityMatches: boolean | null;
  datesConsistent: boolean;
  organizerConsistent: boolean;
  recentConfirmation: boolean;
  conflictingOfficialInfo: boolean;
  threatReputationHit: boolean;
  observedAt: string;
  sourceUrl: string;
  sourceTrust: number | null;
}

export interface VerificationOutput {
  score: number;
  decision: VerificationDecision;
  tier: PublishingTier;
  breakdown: Array<{ signal: string; delta: number }>;
  gate: { pass: boolean; reasons: string[] };
  link: LinkVerificationResult | null;
  evidence: Omit<VerificationEvidence, "evidence_id">[];
  securityFlags: string[];
}

export async function verifyEvent(
  input: VerificationInput,
  resolve: RedirectResolver,
): Promise<VerificationOutput> {
  const evidence: Omit<VerificationEvidence, "evidence_id">[] = [];
  const addEvidence = (
    type: string,
    text: string,
    supports: boolean,
  ): void => {
    evidence.push({
      event_id: input.eventId,
      source_url: input.sourceUrl,
      evidence_type: type,
      evidence_text: text,
      observed_at: input.observedAt,
      source_trust: input.sourceTrust,
      supports_claim: supports ? 1 : 0,
    });
  };

  // --- Link verification (spec 45) ---
  let link: LinkVerificationResult | null = null;
  const securityFlags: string[] = [];
  if (input.registrationUrl) {
    link = await verifyLink(
      {
        rawUrl: input.registrationUrl,
        officialDomain: input.officialDomain,
        officialPageLinksToUrl: input.officialPageLinksToRegistration,
        eventIdentityMatches: input.eventIdentityMatches,
        threatReputationHit: input.threatReputationHit,
      },
      resolve,
    );
    securityFlags.push(...link.securityFlags);
    addEvidence(
      "LINK_VERIFICATION",
      `Registration link ${link.outcome} (confidence ${link.confidence}): ${link.reason}. final=${link.finalUrl ?? "null"}`,
      link.outcome === "APPROVE",
    );
    if (link.lookalikeSignals.length > 0) {
      addEvidence("LOOKALIKE_DOMAIN", `Lookalike signals: ${link.lookalikeSignals.join(", ")}`, false);
    }
  } else {
    addEvidence("LINK_VERIFICATION", "No registration URL provided; event may publish without one.", true);
  }

  // --- Score signals (spec 15) ---
  const signals: ScoreSignals = {
    ...emptySignals(),
    officialOrganizerPage: input.officialPageExists,
    officialRegistrationLink:
      !!link && link.outcome === "APPROVE" && input.officialPageLinksToRegistration,
    organizerSocialConfirmation: input.socialConfirmation,
    trustedEventPlatform: input.trustedPlatformListed,
    secondIndependentSource: input.sourceCount >= 2,
    validHttps: link ? link.isHttps : (input.eventUrl?.startsWith("https://") ?? false),
    consistentDates: input.datesConsistent,
    consistentOrganizer: input.organizerConsistent,
    recentConfirmation: input.recentConfirmation,
    suspiciousRedirect:
      securityFlags.some((f) => f === "EXCESSIVE_REDIRECTS" || f === "SHORT_URL" || f.startsWith("LOOKALIKE")) ||
      (link?.redirectCount ?? 0) >= 4,
    unknownRegistrationDomain: securityFlags.includes("UNKNOWN_REGISTRATION_DOMAIN"),
    conflictingOfficialInfo: input.conflictingOfficialInfo,
    phishingMalwareReputation: input.threatReputationHit,
    impersonationIndicators: link?.lookalikeSignals.length ? link.lookalikeSignals.length > 0 : false,
    confirmedMalicious: false, // only set by external confirmation, never heuristics
  };

  if (input.officialPageExists) addEvidence("OFFICIAL_PAGE", "Official organizer page located.", true);
  if (input.socialConfirmation) addEvidence("SOCIAL_CONFIRMATION", "Organizer social account confirms event.", true);
  if (input.trustedPlatformListed) addEvidence("PLATFORM_LISTING", "Listed on trusted event platform.", true);
  if (input.sourceCount >= 2) addEvidence("CROSS_SOURCE", `${input.sourceCount} independent sources agree.`, true);
  if (input.conflictingOfficialInfo) addEvidence("CONFLICT", "Official sources conflict; value withheld as fact.", false);

  const { score, decision, tier, breakdown } = calculateScore(signals);

  const gate = publishingGate({
    title: input.title,
    organizerOrSource: input.organizerName ?? input.sourceUrl,
    eventPageOrSource: input.eventUrl ?? input.sourceUrl,
    hasDateOrDeadline: input.hasDateOrDeadline,
    classification: input.classification,
    verificationDecision: decision,
    registrationOkOrMarkedUnavailable: !input.registrationUrl || !!link,
    unresolvedCriticalFlags:
      securityFlags.includes("THREAT_REPUTATION_HIT") || (link?.lookalikeSignals.includes("PUNYCODE") ?? false),
  });

  return { score, decision, tier, breakdown, gate, link, evidence, securityFlags };
}
