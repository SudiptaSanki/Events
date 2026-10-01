/**
 * Deduplication + normalization helpers (spec 23, 59, 60).
 * Never merges on name similarity alone — date/organizer/URL evidence required.
 */
import { CITY_ALIASES } from "../config.js";
import { normalizeUrl } from "./url.js";
import { levenshtein } from "../security/domains.js";

/** Normalize titles for comparison: lowercase, strip year/edition noise, collapse spaces. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(20\d{2}|2k\d{2})\b/g, " ")
    .replace(/\b(\d+(st|nd|rd|th)\s+edition|edition|hackathon|hack|summit|fest|challenge)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Abbreviation map for known events (used as ONE signal, not sole merge key). */
const ABBREVIATIONS: Record<string, string> = {
  sih: "smart india hackathon",
  sawo: "smart india hackathon",
};

/** Expand known abbreviations BEFORE normalization so "SIH" and the full
 *  name converge to the same normalized form. */
function expandAbbreviationRaw(title: string): string {
  let out = ` ${title.toLowerCase()} `;
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    out = out.replace(new RegExp(`\\b${abbr}\\b`, "g"), ` ${full} `);
  }
  return out;
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(expandAbbreviationRaw(a));
  const nb = normalizeTitle(expandAbbreviationRaw(b));
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

export interface DedupeCandidate {
  title: string;
  organizer: string | null;
  startDate: string | null;
  city: string | null;
  eventUrl: string | null;
  registrationUrl: string | null;
}

export interface DedupeDecision {
  duplicate: boolean;
  reason: string;
  similarity: number;
}

/**
 * Deterministic dedupe decision. Merge ONLY when:
 * - same canonical event/registration URL, OR
 * - high title similarity AND (same organizer OR same date) AND no conflict.
 */
export function isDuplicate(a: DedupeCandidate, b: DedupeCandidate): DedupeDecision {
  const aEvent = a.eventUrl ? normalizeUrl(a.eventUrl).canonical : null;
  const bEvent = b.eventUrl ? normalizeUrl(b.eventUrl).canonical : null;
  if (aEvent && bEvent && aEvent === bEvent) {
    return { duplicate: true, reason: "SAME_CANONICAL_EVENT_URL", similarity: 1 };
  }
  const aReg = a.registrationUrl ? normalizeUrl(a.registrationUrl).canonical : null;
  const bReg = b.registrationUrl ? normalizeUrl(b.registrationUrl).canonical : null;
  if (aReg && bReg && aReg === bReg) {
    return { duplicate: true, reason: "SAME_CANONICAL_REGISTRATION_URL", similarity: 1 };
  }
  const sim = titleSimilarity(a.title, b.title);
  const sameOrg =
    !!a.organizer && !!b.organizer &&
    normalizeOrganizerName(a.organizer) === normalizeOrganizerName(b.organizer);
  const sameDate = !!a.startDate && !!b.startDate && a.startDate.slice(0, 10) === b.startDate.slice(0, 10);
  const sameCity =
    !!a.city && !!b.city && normalizeCity(a.city).normalized.toLowerCase() === normalizeCity(b.city).normalized.toLowerCase();
  if (sim >= 0.85 && (sameOrg || sameDate)) {
    return { duplicate: true, reason: sameOrg && sameDate ? "TITLE_ORGANIZER_DATE_MATCH" : sameOrg ? "TITLE_ORGANIZER_MATCH" : "TITLE_DATE_MATCH", similarity: sim };
  }
  if (sim >= 0.7 && sameOrg && (sameDate || sameCity)) {
    return { duplicate: true, reason: "TITLE_ORGANIZER_GEO_MATCH", similarity: sim };
  }
  return { duplicate: false, reason: "INSUFFICIENT_EVIDENCE", similarity: sim };
}

/** Build a stable dedupe key for DB lookups. */
export function dedupeKey(c: DedupeCandidate): string {
  const url = c.eventUrl ? normalizeUrl(c.eventUrl).canonical ?? "" : c.registrationUrl ? normalizeUrl(c.registrationUrl).canonical ?? "" : "";
  const org = c.organizer ? normalizeOrganizerName(c.organizer) : "";
  const date = c.startDate ? c.startDate.slice(0, 10) : "";
  return `${normalizeTitle(c.title)}|${org}|${date}|${url}`.slice(0, 512);
}

// ---------------------------------------------------------------------------
// Organizer resolution (spec 59)
// ---------------------------------------------------------------------------

export function normalizeOrganizerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bgovt\.?\b/g, "government")
    .replace(/\b(univ\.|univ|university|institute of technology|institute|college|official)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// City normalization (spec 60)
// ---------------------------------------------------------------------------

export function normalizeCity(raw: string): { normalized: string; original: string } {
  const original = raw.trim();
  const key = original.toLowerCase();
  return { normalized: CITY_ALIASES[key] ?? original, original };
}
