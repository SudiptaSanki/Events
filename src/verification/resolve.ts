/**
 * Official-source resolution (spec 8, 9, 10 checks 4–5). Deterministic and
 * honest about its limits:
 *
 * - The organizer's TRUE official domain can only be proven via the organizer
 *   itself. Without a configured search API, we claim "official" ONLY for
 *   level ≤3 sources (university/government/company pages ARE first-party).
 * - Platform/aggregator pages (level ≥4) are treated as listings, never as
 *   official organizer sources — their domain is NOT promoted to official.
 * - Check 4 (does the official page link to the registration URL?) is answered
 *   by fetching the page with the robots-aware fetcher and comparing
 *   normalized links, including the redirect-resolved final URL.
 * - Check 5 (does the destination describe the same event?) uses token overlap
 *   on the fetched registration page. JS-only pages may yield `null`.
 */
import { normalizeUrl, registrableDomainOf } from "../normalize/url.js";
import { fetchText } from "../discovery/fetcher.js";
import { extractEventFromHtml } from "../extract/html.js";
import type { RedirectResolver } from "./linkVerification.js";

export interface OfficialContext {
  /** Organizer's official domain, or null when it cannot be established. */
  officialDomain: string | null;
  /** True only when a first-party (L1–L3) page was fetched successfully. */
  officialPageExists: boolean;
  /** Check 4: the official page links to the (resolved) registration URL. */
  officialPageLinksToRegistration: boolean;
  /** Check 5: registration destination describes the same event (null=unknown). */
  eventIdentityMatches: boolean | null;
  /** Domains were derived from a first-party source (vs. platform listing). */
  firstParty: boolean;
  fetchErrors: string[];
}

export interface ResolveInput {
  eventUrl: string | null;
  registrationUrl: string | null;
  title: string | null;
  organizer: string | null;
  /** Source hierarchy level of the discovering source (1–7). */
  sourceLevel: number;
  fetchFn?: typeof fetch;
  redirectResolver?: RedirectResolver;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "join", "annual", "official", "presents",
  "2026", "2025", "2027", "india", "online", "event", "events",
]);

function significantTokens(text: string | null): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3 && !STOPWORDS.has(t));
}

function overlapRatio(needles: string[], haystack: string): boolean {
  if (needles.length === 0) return false;
  const hay = haystack.toLowerCase();
  const matched = needles.filter((t) => hay.includes(t)).length;
  if (needles.length <= 2) return matched >= 1;
  return matched / needles.length >= 0.4 && matched >= 2;
}

export async function resolveOfficialContext(input: ResolveInput): Promise<OfficialContext> {
  const fetchFn = input.fetchFn;
  const fetchErrors: string[] = [];
  const firstParty = input.sourceLevel <= 3;

  // Official domain: only from first-party sources. Never promote a listing.
  let officialDomain: string | null = null;
  if (firstParty && input.eventUrl) {
    try {
      const host = new URL(input.eventUrl).hostname.toLowerCase();
      officialDomain = registrableDomainOf(host);
    } catch {
      officialDomain = null;
    }
  }

  // Resolve registration redirects first so check 4 can compare final URLs.
  let regFinal: string | null = null;
  let regCanonical: string | null = null;
  if (input.registrationUrl) {
    const norm = normalizeUrl(input.registrationUrl);
    regCanonical = norm.canonical;
    if (input.redirectResolver && norm.canonical) {
      try {
        const res = await input.redirectResolver(norm.canonical);
        regFinal = res.finalUrl ?? norm.canonical;
      } catch (e) {
        fetchErrors.push(`REG_RESOLVE:${e instanceof Error ? e.message : "FAILED"}`);
        regFinal = norm.canonical;
      }
    } else {
      regFinal = norm.canonical;
    }
  }

  // Check 4: fetch the event page and look for the registration URL.
  let officialPageExists = false;
  let officialPageLinksToRegistration = false;
  if (input.eventUrl) {
    const res = await fetchText(input.eventUrl, { fetchFn });
    if (res.ok && res.text) {
      officialPageExists = firstParty; // fetched page counts as official only if first-party
      const pageLinks = new Set<string>();
      for (const l of extractEventFromHtml(res.text, res.finalUrl).links) {
        const n = normalizeUrl(l);
        if (n.canonical) pageLinks.add(n.canonical);
      }
      const targets = new Set(
        [regCanonical ? normalizeUrl(regCanonical).canonical : null, regFinal ? normalizeUrl(regFinal).canonical : null]
          .filter((u): u is string => !!u),
      );
      for (const t of targets) {
        if (pageLinks.has(t)) {
          officialPageLinksToRegistration = true;
          break;
        }
      }
    } else {
      fetchErrors.push(`EVENT_PAGE:${res.blockedByRobots ? "BLOCKED_BY_ROBOTS_TXT" : res.error ?? `HTTP_${res.status}`}`);
    }
  }

  // Check 5: fetch the registration destination, compare identity tokens.
  let eventIdentityMatches: boolean | null = null;
  if (input.registrationUrl && (input.title || input.organizer)) {
    const res = await fetchText(input.registrationUrl, { fetchFn });
    if (res.ok && res.text) {
      const text = res.text
        .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
        .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
        .replace(/<[^>]*>/g, " ");
      const titleOk = overlapRatio(significantTokens(input.title), text);
      const orgTokens = significantTokens(input.organizer);
      const orgOk = orgTokens.length > 0 && overlapRatio(orgTokens, text);
      // Also accept an exact normalized-title mention.
      const exactTitle = (input.title ?? "").toLowerCase().length > 8 &&
        text.toLowerCase().includes((input.title ?? "").toLowerCase());
      eventIdentityMatches = titleOk || orgOk || exactTitle;
    } else {
      fetchErrors.push(`REG_PAGE:${res.blockedByRobots ? "BLOCKED_BY_ROBOTS_TXT" : res.error ?? `HTTP_${res.status}`}`);
      eventIdentityMatches = null;
    }
  }

  return {
    officialDomain,
    officialPageExists,
    officialPageLinksToRegistration: firstParty && officialPageLinksToRegistration,
    eventIdentityMatches,
    firstParty,
    fetchErrors,
  };
}
