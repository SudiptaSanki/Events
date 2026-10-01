/**
 * Verification scoring (spec 15) + publishing tiers (spec 66) +
 * security-first publishing gate (spec 65). Deterministic.
 */
import { DEFAULT_WEIGHTS, PUBLISH_THRESHOLD, REVIEW_THRESHOLD, type ScoreWeights } from "../config.js";
import type { PublishingTier, VerificationDecision } from "../types.js";

export interface ScoreSignals {
  officialOrganizerPage: boolean;
  officialRegistrationLink: boolean;
  organizerSocialConfirmation: boolean;
  trustedEventPlatform: boolean;
  secondIndependentSource: boolean;
  validHttps: boolean;
  consistentDates: boolean;
  consistentOrganizer: boolean;
  recentConfirmation: boolean;
  suspiciousRedirect: boolean;
  unknownRegistrationDomain: boolean;
  conflictingOfficialInfo: boolean;
  phishingMalwareReputation: boolean;
  impersonationIndicators: boolean;
  confirmedMalicious: boolean;
}

export interface ScoreResult {
  score: number;
  decision: VerificationDecision;
  tier: PublishingTier;
  breakdown: Array<{ signal: string; delta: number }>;
}

export function emptySignals(): ScoreSignals {
  return {
    officialOrganizerPage: false,
    officialRegistrationLink: false,
    organizerSocialConfirmation: false,
    trustedEventPlatform: false,
    secondIndependentSource: false,
    validHttps: false,
    consistentDates: false,
    consistentOrganizer: false,
    recentConfirmation: false,
    suspiciousRedirect: false,
    unknownRegistrationDomain: false,
    conflictingOfficialInfo: false,
    phishingMalwareReputation: false,
    impersonationIndicators: false,
    confirmedMalicious: false,
  };
}

const SIGNAL_TO_WEIGHT: Record<keyof ScoreSignals, keyof ScoreWeights> = {
  officialOrganizerPage: "officialOrganizerPage",
  officialRegistrationLink: "officialRegistrationLink",
  organizerSocialConfirmation: "organizerSocialConfirmation",
  trustedEventPlatform: "trustedEventPlatform",
  secondIndependentSource: "secondIndependentSource",
  validHttps: "validHttps",
  consistentDates: "consistentDates",
  consistentOrganizer: "consistentOrganizer",
  recentConfirmation: "recentConfirmation",
  suspiciousRedirect: "suspiciousRedirect",
  unknownRegistrationDomain: "unknownRegistrationDomain",
  conflictingOfficialInfo: "conflictingOfficialInfo",
  phishingMalwareReputation: "phishingMalwareReputation",
  impersonationIndicators: "impersonationIndicators",
  confirmedMalicious: "confirmedMalicious",
};

export function calculateScore(signals: ScoreSignals, weights: ScoreWeights = DEFAULT_WEIGHTS): ScoreResult {
  const breakdown: Array<{ signal: string; delta: number }> = [];
  let score = 0;
  for (const [signal, weightKey] of Object.entries(SIGNAL_TO_WEIGHT) as Array<[keyof ScoreSignals, keyof ScoreWeights]>) {
    if (signals[signal]) {
      const delta = weights[weightKey];
      score += delta;
      breakdown.push({ signal, delta });
    }
  }
  score = Math.max(-100, Math.min(100, score));

  let decision: VerificationDecision;
  let tier: PublishingTier;
  if (signals.confirmedMalicious || signals.phishingMalwareReputation) {
    decision = "REJECTED";
    tier = "E";
  } else if (signals.impersonationIndicators || signals.suspiciousRedirect) {
    decision = signals.officialOrganizerPage ? "SUSPICIOUS" : "SUSPICIOUS";
    tier = "E";
    if (signals.officialOrganizerPage && score >= REVIEW_THRESHOLD) {
      decision = "SUSPICIOUS";
    }
  } else if (signals.officialOrganizerPage && signals.officialRegistrationLink && score >= 60) {
    // Tier A: official page + officially-referenced registration. Threshold is
    // 60 (not 70) because a single pristine official source yields ~65
    // (25+20+5+5+5+5) without needing social/platform corroboration.
    decision = "VERIFIED_OFFICIAL";
    tier = "A";
  } else if (score >= PUBLISH_THRESHOLD && signals.secondIndependentSource) {
    decision = "VERIFIED_BY_MULTIPLE_SOURCES";
    tier = "B";
  } else if (score >= PUBLISH_THRESHOLD) {
    decision = "LIKELY_LEGITIMATE";
    tier = signals.trustedEventPlatform ? "C" : "B";
  } else if (score >= REVIEW_THRESHOLD) {
    decision = "UNVERIFIED";
    tier = signals.trustedEventPlatform ? "C" : "D";
  } else {
    decision = score < 0 ? "SUSPICIOUS" : "UNVERIFIED";
    tier = score < 0 ? "E" : "D";
    if (score < REVIEW_THRESHOLD && score >= 0 && !signals.trustedEventPlatform) {
      // borderline with no trusted platform => manual review, tier D
    }
    if (score < 10 && signals.unknownRegistrationDomain) {
      decision = "SUSPICIOUS";
      tier = "E";
    }
  }
  // Tier D (social/community only) always requires manual review.
  if (tier === "D" && decision !== "SUSPICIOUS" && decision !== "REJECTED") decision = "UNVERIFIED";

  return { score, decision, tier, breakdown };
}

export interface PublishingGateInput {
  title: string | null;
  organizerOrSource: string | null;
  eventPageOrSource: string | null;
  hasDateOrDeadline: boolean;
  classification: string | null;
  verificationDecision: VerificationDecision | null;
  registrationOkOrMarkedUnavailable: boolean;
  unresolvedCriticalFlags: boolean;
}

/** Security-first publishing rule (spec 65). Returns blocking reasons. */
export function publishingGate(input: PublishingGateInput): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.title) reasons.push("MISSING_TITLE");
  if (!input.organizerOrSource) reasons.push("MISSING_ORGANIZER_OR_SOURCE");
  if (!input.eventPageOrSource) reasons.push("MISSING_EVENT_PAGE_OR_SOURCE");
  if (!input.hasDateOrDeadline) reasons.push("MISSING_DATE_AND_DEADLINE");
  if (!input.classification) reasons.push("MISSING_CLASSIFICATION");
  if (!input.verificationDecision || input.verificationDecision === "REJECTED") reasons.push("NO_VERIFICATION_DECISION");
  if (!input.registrationOkOrMarkedUnavailable) reasons.push("REGISTRATION_UNRESOLVED");
  if (input.unresolvedCriticalFlags) reasons.push("UNRESOLVED_CRITICAL_SECURITY_FLAGS");
  return { pass: reasons.length === 0, reasons };
}
