/**
 * Phase 3 orchestration: take a DISCOVERED event row, resolve its official
 * context over live HTTP, run the Phase 1 verification pipeline, and persist
 * every outcome (scores, links, evidence, flags, review items).
 *
 * Status mapping (spec 18):
 *   Tier A/B + gate pass  -> VERIFIED
 *   Tier C / Tier D       -> NEEDS_REVIEW (platform-listed or social-only)
 *   Tier E / SUSPICIOUS   -> SUSPICIOUS
 *   REJECTED              -> REJECTED (terminal, no review row)
 *   gate blocked          -> NEEDS_REVIEW (missing mandatory field)
 */
import type { Store } from "../db/store.js";
import { indiaRelevance } from "../india/relevance.js";
import { freshnessScore } from "../quality/freshness.js";
import { TRUSTED_EVENT_PLATFORMS } from "../config.js";
import { logger } from "../logging.js";
import { recordSourceOutcome } from "../quality/reputation.js";
import { NoopThreatIntel, recordDomainVerdict, type ThreatIntelProvider } from "../security/threatIntel.js";
import type { EventStatus } from "../types.js";
import { createHttpResolver, type RedirectResolver } from "./linkVerification.js";
import { verifyEvent, type VerificationOutput } from "./pipeline.js";
import { resolveOfficialContext } from "./resolve.js";

export interface StoredEvent {
  event_id: string;
  title: string;
  organizer_name: string | null;
  event_url: string | null;
  registration_url: string | null;
  start_date: string | null;
  registration_deadline: string | null;
  categories: string | null;
  format: "ONLINE" | "OFFLINE" | "HYBRID" | "UNKNOWN";
  status: EventStatus;
  first_seen: string | null;
  last_seen: string | null;
}

export interface VerifyDiscoveredOptions {
  fetchFn?: typeof fetch;
  redirectResolver?: RedirectResolver;
  threatIntel?: ThreatIntelProvider;
  now?: () => string;
  dryRun?: boolean; // resolve + score, but write nothing
}

export interface VerifyDiscoveredResult {
  eventId: string;
  output: VerificationOutput;
  newStatus: EventStatus;
  wrote: boolean;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isTrustedPlatformHost(host: string | null): boolean {
  if (!host) return false;
  return TRUSTED_EVENT_PLATFORMS.some((d) => host === d || host.endsWith(`.${d}`));
}

async function loadSources(store: Store, eventId: string): Promise<Array<{ source_id: string; source_url: string; source_level: number | null }>> {
  return store.query<{ source_id: string; source_url: string; source_level: number | null }>(
    "SELECT source_id, source_url, source_level FROM event_sources WHERE event_id = ?",
    eventId,
  );
}

export async function verifyDiscoveredEvent(
  store: Store,
  event: StoredEvent,
  opts: VerifyDiscoveredOptions = {},
): Promise<VerifyDiscoveredResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const observedAt = now();
  const sources = await loadSources(store, event.event_id);
  const bestLevel = sources.reduce<number | null>(
    (best, s) => (s.source_level == null ? best : best == null ? s.source_level : Math.min(best, s.source_level)),
    null,
  ) ?? 7;
  const sourceCount = new Set(sources.map((s) => s.source_id)).size || 1;
  const primarySource = sources[0];
  // Source trust comes from the registry's learned reputation (spec 16/17).
  const trustRow = await store.queryOne<{ trust_score: number }>(
    `SELECT MAX(trust_score) AS trust_score FROM source_registry WHERE source_id IN (${
      sources.map(() => "?").join(",") || "NULL"
    })`,
    ...sources.map((s) => s.source_id),
  );
  const sourceTrust: number | null = trustRow?.trust_score ?? null;

  const resolver = opts.redirectResolver ?? createHttpResolver({ fetchFn: opts.fetchFn });
  const ctx = await resolveOfficialContext({
    eventUrl: event.event_url,
    registrationUrl: event.registration_url,
    title: event.title,
    organizer: event.organizer_name,
    sourceLevel: bestLevel,
    fetchFn: opts.fetchFn,
    redirectResolver: resolver,
  });

  const trustedPlatformListed =
    isTrustedPlatformHost(hostOf(event.event_url)) || isTrustedPlatformHost(hostOf(event.registration_url));

  // Threat-intel check on the registration URL (spec 10 check 7). Noop by
  // default; a HIT forces rejection downstream. Errors => UNKNOWN (no signal).
  const threatIntel = opts.threatIntel ?? new NoopThreatIntel();
  let threatReputationHit = false;
  let threatVerdict: import("../security/threatIntel.js").ThreatIntelResult | null = null;
  if (event.registration_url) {
    try {
      threatVerdict = await threatIntel.checkUrl(event.registration_url);
      threatReputationHit = threatVerdict.verdict === "HIT";
      if (threatReputationHit) {
        logger.warn("threat-intel hit", {
          event: event.event_id,
          detail: `${threatVerdict.provider}:${threatVerdict.threatTypes.join(",")}`,
        });
      }
    } catch {
      logger.warn("threat-intel error (treated as UNKNOWN)", { event: event.event_id });
    }
  }

  const output = await verifyEvent(
    {
      eventId: event.event_id,
      title: event.title,
      organizerName: event.organizer_name,
      officialDomain: ctx.officialDomain,
      eventUrl: event.event_url,
      registrationUrl: event.registration_url,
      hasDateOrDeadline: !!(event.start_date || event.registration_deadline),
      classification: event.categories ? (JSON.parse(event.categories) as string[])[0] ?? "Other" : "Other",
      format: event.format,
      sourceCount,
      trustedPlatformListed,
      socialConfirmation: false, // no official social API wired (documented limit)
      officialPageExists: ctx.officialPageExists,
      officialPageLinksToRegistration: ctx.officialPageLinksToRegistration,
      eventIdentityMatches: ctx.eventIdentityMatches,
      datesConsistent: true, // single observation: nothing contradicts yet (Phase 4 consistency)
      organizerConsistent: true,
      recentConfirmation: true, // freshly resolved just now
      conflictingOfficialInfo: false,
      threatReputationHit,
      observedAt,
      sourceUrl: primarySource?.source_url ?? event.event_url ?? "unknown",
      sourceTrust,
    },
    resolver,
  );

  // --- Status mapping ---
  let newStatus: EventStatus;
  if (output.decision === "REJECTED") newStatus = "REJECTED";
  else if (output.decision === "SUSPICIOUS" || output.tier === "E") newStatus = "SUSPICIOUS";
  else if ((output.tier === "A" || output.tier === "B") && output.gate.pass) newStatus = "VERIFIED";
  else newStatus = "NEEDS_REVIEW";

  // Registration-URL change on an already-published event -> UPDATED (spec 20).
  const freshRegFinal = output.link && output.link.outcome === "APPROVE" ? output.link.finalUrl : null;
  const regChanged = !!freshRegFinal && !!event.registration_url && freshRegFinal !== event.registration_url;
  if (regChanged && ["VERIFIED", "PUBLISHED", "UPDATED"].includes(event.status) && newStatus === "VERIFIED") {
    newStatus = "UPDATED";
  }

  // No-churn rule for monitors: a published event keeps its status unless the
  // fresh pass found NEW adverse evidence (security flags, threat hit, or an
  // UPDATED-worthy change). Thin re-resolution alone must not demote it.
  if (
    (event.status === "VERIFIED" || event.status === "PUBLISHED") &&
    (newStatus === "NEEDS_REVIEW") &&
    output.securityFlags.length === 0 &&
    !threatReputationHit
  ) {
    newStatus = event.status;
  }

  let wrote = false;
  if (!opts.dryRun) {
    // Separate confidence signals, stored individually (spec 17).
    const india = indiaRelevance({
      country: null,
      city: null,
      organizerName: event.organizer_name,
      organizerDomain: ctx.officialDomain,
      eligibility: null,
      currencyHint: null,
      timezone: null,
      // Online reachability from India is unknown at this stage — never assumed.
      onlineFromIndia: null,
    });
    const fresh = freshnessScore({
      firstSeen: event.first_seen,
      lastSeen: event.last_seen,
      lastVerified: observedAt,
      now: observedAt,
    });
    await persistVerification(store, event, output, newStatus, observedAt, {
      regChanged,
      eventPageDead: ctx.fetchErrors.some((e) => e.startsWith("EVENT_PAGE")),
      indiaRelevanceScore: india.score,
      freshnessScore: fresh,
      sourceTrustScore: sourceTrust,
    });
    if (threatReputationHit && threatVerdict && output.link?.host) {
      await recordDomainVerdict(store, output.link.host, threatVerdict, observedAt);
    }
    wrote = true;
  } else {
    logger.debug("verify dry-run", { event: event.event_id, score: output.score, decision: output.decision });
  }
  return { eventId: event.event_id, output, newStatus, wrote };
}

export async function persistVerification(
  store: Store,
  event: StoredEvent,
  output: VerificationOutput,
  newStatus: EventStatus,
  observedAt: string,
  extra?: {
    regChanged: boolean;
    eventPageDead: boolean;
    indiaRelevanceScore?: number | null;
    freshnessScore?: number | null;
    sourceTrustScore?: number | null;
  },
): Promise<void> {
  const verifiedRegUrl = output.link && output.link.outcome === "APPROVE" ? output.link.finalUrl : null;
  const unverifiedNote = event.registration_url && !verifiedRegUrl
    ? "Registration link could not be independently verified."
    : null;

  // Change detection: record a registration-URL change (spec 20).
  if (extra?.regChanged && event.registration_url && verifiedRegUrl) {
    await store.exec(
      `INSERT INTO event_changes(event_id,field,old_value,new_value,detected_at) VALUES (?,?,?,?,?)`,
      event.event_id,
      "registration_url",
      event.registration_url,
      verifiedRegUrl,
      observedAt,
    );
  }

  await store.exec(
    `UPDATE events SET status=?, verification_decision=?, verification_score=?, publishing_tier=?,
      registration_url=?, registration_unverified_note=?, last_verified=?, last_link_check=?, last_seen=?,
      india_relevance_score=?, freshness_score=?, source_trust_score=?
     WHERE event_id=?`,
    newStatus,
    output.decision,
    output.score,
    output.tier,
    verifiedRegUrl,
    unverifiedNote,
    observedAt,
    observedAt,
    observedAt,
    extra?.indiaRelevanceScore ?? null,
    extra?.freshnessScore ?? null,
    extra?.sourceTrustScore ?? null,
    event.event_id,
  );

  // Link rows: refresh existing UNVERIFIED rows, else insert fresh evidence.
  if (output.link) {
    const existing = await store.queryOne<{ link_id: number }>(
      "SELECT link_id FROM event_links WHERE event_id=? AND url_type='REGISTRATION' ORDER BY link_id DESC LIMIT 1",
      event.event_id,
    );
    if (existing) {
      await store.exec(
        `UPDATE event_links SET canonical_url=?, final_url=?, domain=?, is_https=?, redirect_count=?,
          redirect_chain=?, domain_relationship=?, provider_category=?, security_status=?, verification_status=?, last_checked=?
         WHERE link_id=?`,
        output.link.canonicalUrl,
        output.link.finalUrl,
        output.link.host,
        output.link.isHttps ? 1 : 0,
        output.link.redirectCount,
        JSON.stringify(output.link.redirectChain),
        output.link.domainRelationship,
        output.link.providerCategory,
        output.link.securityFlags.length > 0 ? "FLAGGED" : "CLEAR_LOCAL_CHECKS",
        output.link.outcome === "APPROVE" ? "VERIFIED" : output.link.outcome === "REJECT" ? "REJECTED" : "PENDING",
        observedAt,
        existing.link_id,
      );
    }
    await store.exec(
      `INSERT INTO link_checks(link_id,checked_at,http_status,final_url,error)
       VALUES ((SELECT link_id FROM event_links WHERE event_id=? AND url_type='REGISTRATION' ORDER BY link_id DESC LIMIT 1),?,?,?,?)`,
      event.event_id,
      observedAt,
      output.link.redirectChain.at(-1)?.status ?? null,
      output.link.finalUrl,
      null,
    );
  }

  for (const e of output.evidence) {
    await store.exec(
      `INSERT INTO verification_evidence(event_id,source_url,evidence_type,evidence_text,observed_at,source_trust,supports_claim)
       VALUES (?,?,?,?,?,?,?)`,
      event.event_id,
      e.source_url,
      e.evidence_type,
      e.evidence_text,
      e.observed_at,
      e.source_trust,
      e.supports_claim,
    );
  }

  for (const flag of output.securityFlags) {
    const severity = /THREAT|PUNYCODE/.test(flag) ? "critical" : /LOOKALIKE|UNKNOWN_REGISTRATION/.test(flag) ? "warning" : "info";
    await store.exec(
      `INSERT INTO security_flags(event_id,flag_type,severity,details,resolved,created_at)
       VALUES (?,?,?,?,?,?)`,
      event.event_id,
      flag,
      severity,
      `link=${output.link?.finalUrl ?? "n/a"}`,
      0,
      observedAt,
    );
  }

  if (newStatus === "NEEDS_REVIEW" || newStatus === "SUSPICIOUS") {
    const reason = newStatus === "SUSPICIOUS"
      ? `SUSPICIOUS_FLAGS:${output.securityFlags.join(",") || output.decision}`
      : `TIER_${output.tier}_GATE_${output.gate.pass ? "PASS" : "BLOCKED:" + output.gate.reasons.join(",")}`;
    await store.exec(
      `INSERT INTO review_queue(event_id,reason,score,created_at,resolved) VALUES (?,?,?, ?,0)`,
      event.event_id,
      reason.slice(0, 500),
      output.score,
      observedAt,
    );
  }

  // Source reputation learning (spec 53): VERIFIED rewards, REJECTED penalizes,
  // dead event pages ding slightly. Borderline outcomes teach nothing.
  const sources = await store.query<{ source_id: string }>(
    "SELECT DISTINCT source_id FROM event_sources WHERE event_id = ?",
    event.event_id,
  );
  for (const s of sources) {
    if (newStatus === "VERIFIED" || newStatus === "UPDATED") await recordSourceOutcome(store, s.source_id, "valid", observedAt);
    else if (newStatus === "REJECTED") await recordSourceOutcome(store, s.source_id, "fake", observedAt);
    else if (extra?.eventPageDead) await recordSourceOutcome(store, s.source_id, "dead_link", observedAt);
  }
}
