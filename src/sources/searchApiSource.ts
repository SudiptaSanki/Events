/**
 * Legitimate search-API discovery connector (spec 7). Calls a configured
 * search API endpoint — NEVER scrapes search-engine HTML.
 *
 * Disabled unless SEARCH_API_URL is set. The endpoint must accept POST
 * { q, count } and return { results: [{ title, url, snippet }] }.
 * Any provider (Brave, Bing, Serper-compatible, self-hosted) can sit behind it.
 */
import { DEFAULT_RATE_LIMIT, type DiscoveredItem, type RateLimit, type SourceConnector } from "./types.js";
import { delay } from "../discovery/fetcher.js";
import { generateSearchQueries } from "../discovery/queries.js";

export interface SearchApiOptions {
  slug?: string;
  endpoint?: string; // defaults to process.env.SEARCH_API_URL
  apiKey?: string; // defaults to process.env.SEARCH_API_KEY
  maxQueries?: number;
  resultsPerQuery?: number;
  rateLimit?: Partial<RateLimit>;
  fetchFn?: typeof fetch;
  queries?: string[];
}

interface SearchApiResult {
  title?: string;
  url?: string;
  snippet?: string;
}

export class SearchApiSourceConnector implements SourceConnector {
  private opts: Required<Omit<SearchApiOptions, "rateLimit" | "fetchFn" | "queries" | "endpoint" | "apiKey">> & {
    rateLimit: RateLimit; fetchFn?: typeof fetch; queries: string[]; endpoint: string | null; apiKey: string | null;
  };

  constructor(opts: SearchApiOptions = {}) {
    this.opts = {
      slug: opts.slug ?? "search-api",
      maxQueries: opts.maxQueries ?? 10,
      resultsPerQuery: opts.resultsPerQuery ?? 5,
      rateLimit: { ...DEFAULT_RATE_LIMIT, requestDelayMs: 3000, maxRequestsPerRun: 10, ...opts.rateLimit },
      fetchFn: opts.fetchFn,
      queries: opts.queries ?? generateSearchQueries({ maxQueries: opts.maxQueries ?? 10 }),
      endpoint: opts.endpoint ?? process.env.SEARCH_API_URL ?? null,
      apiKey: opts.apiKey ?? process.env.SEARCH_API_KEY ?? null,
    };
  }

  name(): string {
    return this.opts.slug;
  }

  type(): "SEARCH" {
    return "SEARCH";
  }

  level(): 7 {
    return 7; // search discovery only — weakest, needs official resolution
  }

  getRateLimit(): RateLimit {
    return this.opts.rateLimit;
  }

  getTrustScore(): number {
    return 40;
  }

  isConfigured(): boolean {
    return !!this.opts.endpoint;
  }

  async discover(): Promise<DiscoveredItem[]> {
    if (!this.opts.endpoint) {
      throw new Error("SEARCH_API_URL not configured — search discovery disabled");
    }
    const fetchFn = this.opts.fetchFn ?? fetch;
    const items: DiscoveredItem[] = [];
    const now = new Date().toISOString();
    for (const q of this.opts.queries.slice(0, this.opts.maxQueries)) {
      await delay(this.opts.rateLimit.requestDelayMs);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetchFn(this.opts.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
          },
          body: JSON.stringify({ q, count: this.opts.resultsPerQuery }),
          signal: ctrl.signal,
        });
        if (!res.ok) continue; // per-query failure must not kill the run
        const data = (await res.json()) as { results?: SearchApiResult[] };
        for (const r of (data.results ?? []).slice(0, this.opts.resultsPerQuery)) {
          if (!r.url || !/^https?:\/\//.test(r.url)) continue;
          items.push({
            sourceUrl: r.url,
            rawContent: `${r.title ?? ""}\n${r.snippet ?? ""}`.slice(0, 2000),
            extracted: { title: r.title ?? null, event_url: r.url, confidence: 0.2 },
            fetchedAt: now,
          });
        }
      } catch {
        continue;
      } finally {
        clearTimeout(t);
      }
    }
    return items;
  }

  parse(): Partial<import("../types.js").AIExtraction> {
    return {};
  }

  normalize(e: Partial<import("../types.js").AIExtraction>): Partial<import("../types.js").AIExtraction> {
    return e;
  }
}
