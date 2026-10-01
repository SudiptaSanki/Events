/**
 * MVP source seeds (spec 72). Start small: 5 event platforms + 8 Indian
 * institutions + 2 government challenge portals + search API (disabled until
 * SEARCH_API_URL is set). Sitemap endpoints are validated at runtime —
 * a missing sitemap is a graceful skip, never a failure.
 */
import { RssSourceConnector } from "./rssSource.js";
import { SearchApiSourceConnector } from "./searchApiSource.js";
import { SitemapSourceConnector } from "./sitemapSource.js";
import type { SourceConnector, SourceType } from "./types.js";

export interface SourceSeed {
  slug: string;
  kind: "sitemap" | "rss" | "search";
  sourceType: SourceType;
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  baseUrl: string | null;
  feedUrl?: string;
  trustScore: number;
  enabled: boolean;
  rateLimitMs: number;
  maxPages?: number;
}

const SLOW = 6 * 60 * 60 * 1000; // 6h — low-priority default
const MEDIUM = 60 * 60 * 1000; // 1h
const FAST = 30 * 60 * 1000; // 30m

export const MVP_SOURCES: SourceSeed[] = [
  // ---- Event platforms (L5) ----
  { slug: "devfolio", kind: "sitemap", sourceType: "PLATFORM", level: 5, baseUrl: "https://devfolio.co", trustScore: 65, enabled: true, rateLimitMs: MEDIUM, maxPages: 10 },
  { slug: "unstop", kind: "sitemap", sourceType: "PLATFORM", level: 5, baseUrl: "https://unstop.com", trustScore: 65, enabled: true, rateLimitMs: MEDIUM, maxPages: 10 },
  { slug: "hackerearth", kind: "sitemap", sourceType: "PLATFORM", level: 5, baseUrl: "https://hackerearth.com", trustScore: 60, enabled: true, rateLimitMs: MEDIUM, maxPages: 10 },
  { slug: "hack2skill", kind: "sitemap", sourceType: "PLATFORM", level: 5, baseUrl: "https://hack2skill.com", trustScore: 60, enabled: true, rateLimitMs: SLOW, maxPages: 10 },
  { slug: "devpost", kind: "sitemap", sourceType: "PLATFORM", level: 5, baseUrl: "https://devpost.com", trustScore: 60, enabled: true, rateLimitMs: SLOW, maxPages: 10 },
  { slug: "mlh", kind: "sitemap", sourceType: "PLATFORM", level: 5, baseUrl: "https://mlh.io", trustScore: 65, enabled: true, rateLimitMs: SLOW, maxPages: 10 },
  { slug: "kaggle", kind: "sitemap", sourceType: "PLATFORM", level: 5, baseUrl: "https://www.kaggle.com", trustScore: 65, enabled: true, rateLimitMs: SLOW, maxPages: 10 },
  { slug: "townscript", kind: "sitemap", sourceType: "PLATFORM", level: 5, baseUrl: "https://www.townscript.com", trustScore: 55, enabled: true, rateLimitMs: SLOW, maxPages: 10 },
  { slug: "allevents", kind: "sitemap", sourceType: "PLATFORM", level: 5, baseUrl: "https://allevents.in", trustScore: 50, enabled: true, rateLimitMs: SLOW, maxPages: 10 },

  // ---- Indian institutions (L3) ----
  { slug: "iit-bombay", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.iitb.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "iit-delhi", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://home.iitd.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "iit-kharagpur", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.iitkgp.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "iit-madras", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.iitm.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "iit-kanpur", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.iitk.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "nit-trichy", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.nitt.edu", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "iiit-hyderabad", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.iiit.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "bits-pilani", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.bits-pilani.ac.in", trustScore: 80, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "iit-guwahati", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.iitg.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "iit-roorkee", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.iitr.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "nit-warangal", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.nitw.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "nit-calicut", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://nitc.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "nit-surathkal", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.nitk.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "iiit-bangalore", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.iiitb.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "iiit-delhi", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.iiitd.ac.in", trustScore: 85, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "dtu", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://www.dtu.ac.in", trustScore: 80, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "vit-vellore", kind: "sitemap", sourceType: "UNIVERSITY", level: 3, baseUrl: "https://vit.ac.in", trustScore: 80, enabled: true, rateLimitMs: SLOW, maxPages: 8 },

  // ---- Government challenge portals (L3) ----
  { slug: "sih", kind: "sitemap", sourceType: "GOVERNMENT", level: 3, baseUrl: "https://www.sih.gov.in", trustScore: 80, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "mygov-innovate", kind: "sitemap", sourceType: "GOVERNMENT", level: 3, baseUrl: "https://innovateindia.mygov.in", trustScore: 75, enabled: true, rateLimitMs: SLOW, maxPages: 8 },
  { slug: "startup-india", kind: "sitemap", sourceType: "GOVERNMENT", level: 3, baseUrl: "https://www.startupindia.gov.in", trustScore: 75, enabled: true, rateLimitMs: SLOW, maxPages: 8 },

  // ---- Search discovery (L7, disabled until configured) ----
  { slug: "search-api", kind: "search", sourceType: "SEARCH", level: 7, baseUrl: null, trustScore: 40, enabled: false, rateLimitMs: FAST },
];

export function buildConnector(seed: SourceSeed, fetchFn?: typeof fetch): SourceConnector {
  const rateLimit = { requestDelayMs: 2000, maxRequestsPerRun: seed.maxPages ?? 10, concurrentRequests: 1, retryLimit: 2, backoffMs: 5000 };
  if (seed.kind === "sitemap") {
    return new SitemapSourceConnector({
      slug: seed.slug, sourceType: seed.sourceType, level: seed.level,
      baseUrl: seed.baseUrl ?? "", trustScore: seed.trustScore,
      rateLimit, maxPages: seed.maxPages ?? 10, fetchFn,
    });
  }
  if (seed.kind === "rss") {
    return new RssSourceConnector({
      slug: seed.slug, feedUrl: seed.feedUrl ?? "", trustScore: seed.trustScore, rateLimit, fetchFn,
    });
  }
  return new SearchApiSourceConnector({ slug: seed.slug, rateLimit, fetchFn });
}

/** Validate seed integrity (used by tests + seed script). */
export function validateSeeds(seeds: SourceSeed[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const s of seeds) {
    if (seen.has(s.slug)) errors.push(`DUPLICATE_SLUG:${s.slug}`);
    seen.add(s.slug);
    if (s.trustScore < 0 || s.trustScore > 100) errors.push(`BAD_TRUST:${s.slug}`);
    if (s.baseUrl && !/^https:\/\//.test(s.baseUrl)) errors.push(`NON_HTTPS_BASE:${s.slug}`);
    if (s.kind === "rss" && !s.feedUrl) errors.push(`RSS_WITHOUT_FEED:${s.slug}`);
    if (s.rateLimitMs < 60_000) errors.push(`RATE_LIMIT_TOO_LOW:${s.slug}`);
  }
  return errors;
}
