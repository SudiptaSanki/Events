/**
 * Link verification pipeline (spec 45):
 * discover -> normalize -> resolveRedirects -> inspectDomain ->
 * compareWithOfficialSource -> securityCheck -> crossSourceCheck ->
 * calculateConfidence -> approve/review/reject.
 *
 * Network access is injected via RedirectResolver so unit tests and
 * Cloudflare Workers can supply their own fetch with timeouts, and the
 * core logic stays deterministic. NEVER follows redirects blindly:
 * max hops, block private IPs / non-http(s), record full chain (spec 10).
 */
import { normalizeUrl } from "../normalize/url.js";
import { classifyDomainRelationship, detectLookalike } from "../security/domains.js";

export interface RedirectHop {
  url: string;
  status: number | null;
}

export interface RedirectResolution {
  finalUrl: string | null;
  chain: RedirectHop[];
  redirectCount: number;
  error: string | null;
}

export type RedirectResolver = (url: string) => Promise<RedirectResolution>;

export interface LinkVerificationInput {
  rawUrl: string;
  officialDomain: string | null;
  officialPageLinksToUrl: boolean; // "does official page link to this registration URL" (spec 10 check 4)
  eventIdentityMatches: boolean | null; // check 5 (null = unknown)
  threatReputationHit: boolean; // check 7 (external reputation service)
}

export interface LinkVerificationResult {
  originalUrl: string;
  canonicalUrl: string | null;
  finalUrl: string | null;
  host: string | null;
  isHttps: boolean;
  redirectCount: number;
  redirectChain: RedirectHop[];
  domainRelationship: import("../types.js").DomainRelationship | null;
  providerCategory: import("../types.js").ProviderCategory | null;
  lookalikeSignals: string[];
  securityFlags: string[];
  confidence: number; // 0-100
  outcome: "APPROVE" | "REVIEW" | "REJECT";
  reason: string;
}

export function createStaticResolver(map: Record<string, RedirectResolution>): RedirectResolver {
  return async (url: string) => map[url] ?? { finalUrl: url, chain: [{ url, status: 200 }], redirectCount: 0, error: null };
}

export async function verifyLink(
  input: LinkVerificationInput,
  resolve: RedirectResolver,
): Promise<LinkVerificationResult> {
  const norm = normalizeUrl(input.rawUrl);
  const securityFlags: string[] = [];

  if (!norm.valid || !norm.canonical || !norm.host) {
    return {
      originalUrl: input.rawUrl,
      canonicalUrl: norm.canonical,
      finalUrl: null,
      host: norm.host,
      isHttps: false,
      redirectCount: 0,
      redirectChain: [],
      domainRelationship: null,
      providerCategory: null,
      lookalikeSignals: [],
      securityFlags: ["UNPARSABLE_URL"],
      confidence: 0,
      outcome: "REJECT",
      reason: norm.reason ?? "UNPARSABLE_URL",
    };
  }

  if (!norm.isHttps) securityFlags.push("NON_HTTPS");
  if (norm.isShortUrl) securityFlags.push("SHORT_URL");

  // Resolve redirects (injected; max-hop enforcement lives in the resolver impl).
  const res = await resolve(norm.canonical);
  const finalUrl = res.finalUrl ?? norm.canonical;
  const finalNorm = normalizeUrl(finalUrl);
  const finalHost = finalNorm.host ?? norm.host;

  if (res.redirectCount >= 4) securityFlags.push("EXCESSIVE_REDIRECTS");
  if (res.error) securityFlags.push("RESOLUTION_ERROR");

  const { relationship, providerCategory } = classifyDomainRelationship(finalHost, input.officialDomain);
  const lookalike = detectLookalike(finalHost, input.officialDomain);

  if (lookalike.suspicious) securityFlags.push(...lookalike.signals.map((s) => `LOOKALIKE:${s}`));
  if (relationship === "UNKNOWN_DOMAIN") securityFlags.push("UNKNOWN_REGISTRATION_DOMAIN");
  if (input.threatReputationHit) securityFlags.push("THREAT_REPUTATION_HIT");
  if (input.eventIdentityMatches === false) securityFlags.push("EVENT_IDENTITY_MISMATCH");

  // Confidence: start at 50, adjust deterministically.
  let confidence = 50;
  if (finalNorm.isHttps) confidence += 10;
  else confidence -= 25;
  if (relationship === "SAME_DOMAIN" || relationship === "SUBDOMAIN") confidence += 25;
  else if (relationship === "KNOWN_EVENT_PLATFORM") confidence += 15;
  else if (relationship === "EXTERNAL_REGISTRATION_PROVIDER") confidence += 5;
  else confidence -= 25;
  if (input.officialPageLinksToUrl) confidence += 20;
  if (input.eventIdentityMatches === true) confidence += 5;
  if (input.eventIdentityMatches === false) confidence -= 20;
  if (norm.isShortUrl) confidence -= 10;
  if (res.redirectCount >= 4) confidence -= 20;
  if (lookalike.suspicious) confidence -= 30;
  if (input.threatReputationHit) confidence -= 60;
  confidence = Math.max(0, Math.min(100, confidence));

  let outcome: LinkVerificationResult["outcome"] = "REVIEW";
  let reason = "NEEDS_REVIEW";
  const officiallyReferenced =
    input.officialPageLinksToUrl ||
    relationship === "SAME_DOMAIN" ||
    relationship === "SUBDOMAIN";
  // A known event platform alone is NOT proof: without an official reference
  // or confirmed event identity, the link stays in REVIEW (spec 2, 11, 12).
  const platformWithIdentity =
    relationship === "KNOWN_EVENT_PLATFORM" && input.eventIdentityMatches === true;
  if (input.threatReputationHit || lookalike.signals.includes("PUNYCODE")) {
    outcome = "REJECT";
    reason = "SECURITY_REPUTATION_OR_IMPERSONATION";
  } else if (confidence >= 70 && (officiallyReferenced || platformWithIdentity)) {
    outcome = "APPROVE";
    reason = "OFFICIALLY_REFERENCED_OR_TRUSTED_DESTINATION";
  } else if (confidence < 35 || (!finalNorm.isHttps && relationship === "UNKNOWN_DOMAIN")) {
    outcome = "REJECT";
    reason = "LOW_CONFIDENCE_OR_INSECURE_UNKNOWN";
  }

  return {
    originalUrl: input.rawUrl,
    canonicalUrl: norm.canonical,
    finalUrl,
    host: finalHost,
    isHttps: finalNorm.isHttps,
    redirectCount: res.redirectCount,
    redirectChain: res.chain,
    domainRelationship: relationship,
    providerCategory,
    lookalikeSignals: lookalike.signals,
    securityFlags,
    confidence,
    outcome,
    reason,
  };
}

/** Safe default resolver with hop limit, timeout and scheme guard.
 *  Used by scripts/worker; pass a custom fetch for Workers (no Node http). */
export function createHttpResolver(opts?: {
  maxHops?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): RedirectResolver {
  const maxHops = opts?.maxHops ?? 5;
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const fetchFn = opts?.fetchFn ?? fetch;
  return async (url: string) => {
    const chain: RedirectHop[] = [];
    let current = url;
    try {
      for (let hop = 0; hop <= maxHops; hop++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        let resp: Response;
        try {
          resp = await fetchFn(current, { method: "HEAD", redirect: "manual", signal: ctrl.signal });
        } catch {
          // Fall back to GET with manual redirect (some hosts reject HEAD).
          resp = await fetchFn(current, { method: "GET", redirect: "manual", signal: ctrl.signal });
          try { await resp.arrayBuffer(); } catch { /* ignore body errors */ }
        } finally {
          clearTimeout(t);
        }
        const status = resp.status;
        const loc = resp.headers.get("location");
        chain.push({ url: current, status });
        if (status >= 300 && status < 400 && loc) {
          const next = new URL(loc, current).href;
          if (!next.startsWith("http://") && !next.startsWith("https://")) {
            return { finalUrl: current, chain, redirectCount: chain.length - 1, error: "DANGEROUS_REDIRECT_SCHEME" };
          }
          current = next;
          continue;
        }
        return { finalUrl: current, chain, redirectCount: chain.length - 1, error: null };
      }
      return { finalUrl: current, chain, redirectCount: chain.length - 1, error: "TOO_MANY_REDIRECTS" };
    } catch (e) {
      return { finalUrl: null, chain, redirectCount: Math.max(0, chain.length - 1), error: e instanceof Error ? e.message : "RESOLUTION_FAILED" };
    }
  };
}
