/**
 * Generic sitemap-driven source connector (spec 4, 73). Discovers candidate
 * event pages via robots.txt Sitemap: directives (fallback: /sitemap.xml),
 * filters by include patterns, fetches + extracts each page.
 *
 * Polite by construction: robots-checked fetches, per-request delays,
 * strict per-run page cap. Missing sitemaps are a graceful skip, not an error.
 */
import { DEFAULT_RATE_LIMIT, type DiscoveredItem, type RateLimit, type SourceConnector, type SourceType } from "./types.js";
import { delay, fetchText } from "../discovery/fetcher.js";
import { getRobotsRules } from "../discovery/robots.js";
import { filterSitemapUrls, parseSitemap } from "../discovery/sitemap.js";
import { extractEventFromHtml } from "../extract/html.js";

export interface SitemapSourceOptions {
  slug: string;
  sourceType?: SourceType;
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  baseUrl: string;
  includePatterns?: string[]; // regex sources, e.g. ["hackathon", "hackfest"]
  trustScore?: number;
  rateLimit?: Partial<RateLimit>;
  maxPages?: number;
  fetchFn?: typeof fetch;
}

export const EVENT_URL_HINTS = [
  "hackathon", "hackfest", "hack-", "hack/", "techfest", "ideathon", "datathon",
  "challenge", "competition", "innov", "event",
];

export class SitemapSourceConnector implements SourceConnector {
  private opts: Required<Omit<SitemapSourceOptions, "rateLimit" | "fetchFn">> & { rateLimit: RateLimit; fetchFn?: typeof fetch };
  private include: RegExp[];

  constructor(opts: SitemapSourceOptions) {
    this.opts = {
      slug: opts.slug,
      sourceType: opts.sourceType ?? "PLATFORM",
      level: opts.level ?? 5,
      baseUrl: opts.baseUrl.replace(/\/+$/, ""),
      includePatterns: opts.includePatterns ?? EVENT_URL_HINTS,
      trustScore: opts.trustScore ?? 60,
      maxPages: opts.maxPages ?? 10,
      rateLimit: { ...DEFAULT_RATE_LIMIT, ...opts.rateLimit },
      fetchFn: opts.fetchFn,
    };
    this.include = this.opts.includePatterns.map((p) => new RegExp(p, "i"));
  }

  name(): string {
    return this.opts.slug;
  }

  type(): SourceType {
    return this.opts.sourceType;
  }

  level(): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
    return this.opts.level;
  }

  getRateLimit(): RateLimit {
    return this.opts.rateLimit;
  }

  getTrustScore(): number {
    return this.opts.trustScore;
  }

  private async collectSitemapUrls(): Promise<string[]> {
    const rules = await getRobotsRules(this.opts.baseUrl, this.opts.fetchFn ?? fetch);
    const candidates = rules.sitemaps.length > 0 ? rules.sitemaps : [`${this.opts.baseUrl}/sitemap.xml`];
    const pageUrls: string[] = [];
    for (const sm of candidates.slice(0, 3)) {
      const res = await fetchText(sm, { fetchFn: this.opts.fetchFn });
      if (!res.ok || !res.text) continue; // graceful: missing sitemap is a skip
      const parsed = parseSitemap(res.text);
      if (!parsed.ok) continue;
      if (parsed.kind === "index") {
        // One level of recursion into child sitemaps.
        for (const child of parsed.urls.slice(0, 5)) {
          await delay(this.opts.rateLimit.requestDelayMs);
          const cres = await fetchText(child.loc, { fetchFn: this.opts.fetchFn });
          if (!cres.ok || !cres.text) continue;
          const cparsed = parseSitemap(cres.text);
          if (cparsed.ok && cparsed.kind === "urlset") {
            pageUrls.push(...filterSitemapUrls(cparsed.urls, this.include, undefined, this.opts.maxPages).map((u) => u.loc));
          }
        }
      } else {
        pageUrls.push(...filterSitemapUrls(parsed.urls, this.include, undefined, this.opts.maxPages).map((u) => u.loc));
      }
      if (pageUrls.length >= this.opts.maxPages) break;
    }
    return [...new Set(pageUrls)].slice(0, this.opts.maxPages);
  }

  async discover(): Promise<DiscoveredItem[]> {
    const urls = await this.collectSitemapUrls();
    const items: DiscoveredItem[] = [];
    const hardCap = Math.min(urls.length, this.opts.rateLimit.maxRequestsPerRun);
    for (const url of urls.slice(0, hardCap)) {
      await delay(this.opts.rateLimit.requestDelayMs);
      const res = await fetchText(url, { fetchFn: this.opts.fetchFn });
      if (!res.ok || !res.text) continue; // per-page failure must not kill the run
      const extracted = extractEventFromHtml(res.text, res.finalUrl);
      items.push({
        sourceUrl: res.finalUrl,
        rawContent: res.text.slice(0, 8000),
        extracted: {
          title: extracted.title,
          organizer: extracted.organizer,
          format: extracted.format,
          start_date: extracted.start_date,
          end_date: extracted.end_date,
          location: extracted.location,
          event_url: extracted.event_url,
          confidence: extracted.confidence,
        },
        fetchedAt: new Date().toISOString(),
        ...(extracted.flagged ? { securityNote: `INJECTION_PATTERNS_NEUTRALIZED:${extracted.flagDetails.join(",")}` } : {}),
      });
    }
    return items;
  }

  /** Re-fetch a single item's page (second-pass enrichment). */
  async fetch(item: DiscoveredItem): Promise<string> {
    const res = await fetchText(item.sourceUrl, { fetchFn: this.opts.fetchFn });
    if (!res.ok || !res.text) throw new Error(`fetch failed: ${res.error ?? res.status}`);
    return res.text;
  }

  parse(raw: string, sourceUrl: string): Partial<import("../types.js").AIExtraction> {
    const e = extractEventFromHtml(raw, sourceUrl);
    return {
      title: e.title, organizer: e.organizer, format: e.format,
      start_date: e.start_date, end_date: e.end_date, location: e.location,
      event_url: e.event_url, confidence: e.confidence,
    };
  }

  normalize(e: Partial<import("../types.js").AIExtraction>): Partial<import("../types.js").AIExtraction> {
    return e;
  }
}
