/**
 * Generic RSS/Atom source connector (spec 4, 73). Polls a feed, converts new
 * items into DiscoveredItems. Feed content is UNTRUSTED until verified.
 */
import { DEFAULT_RATE_LIMIT, type DiscoveredItem, type RateLimit, type SourceConnector } from "./types.js";
import { fetchText } from "../discovery/fetcher.js";
import { parseFeed } from "../discovery/rss.js";

export interface RssSourceOptions {
  slug: string;
  feedUrl: string;
  trustScore?: number;
  rateLimit?: Partial<RateLimit>;
  fetchFn?: typeof fetch;
  maxItems?: number;
}

export class RssSourceConnector implements SourceConnector {
  private opts: Required<Omit<RssSourceOptions, "rateLimit" | "fetchFn">> & { rateLimit: RateLimit; fetchFn?: typeof fetch };

  constructor(opts: RssSourceOptions) {
    this.opts = {
      slug: opts.slug,
      feedUrl: opts.feedUrl,
      trustScore: opts.trustScore ?? 60,
      maxItems: opts.maxItems ?? 20,
      rateLimit: { ...DEFAULT_RATE_LIMIT, ...opts.rateLimit },
      fetchFn: opts.fetchFn,
    };
  }

  name(): string {
    return this.opts.slug;
  }

  type(): "PLATFORM" | "UNIVERSITY" | "GOVERNMENT" | "COMPANY" | "COMMUNITY" | "SEARCH" | "SOCIAL" {
    return "PLATFORM";
  }

  level(): 5 {
    return 5; // trusted platform/aggregator until proven official
  }

  getRateLimit(): RateLimit {
    return this.opts.rateLimit;
  }

  getTrustScore(): number {
    return this.opts.trustScore;
  }

  async discover(): Promise<DiscoveredItem[]> {
    const res = await fetchText(this.opts.feedUrl, { fetchFn: this.opts.fetchFn });
    if (!res.ok || !res.text) {
      throw new Error(`RSS fetch failed (${this.opts.feedUrl}): ${res.blockedByRobots ? "BLOCKED_BY_ROBOTS_TXT" : res.error ?? `HTTP_${res.status}`}`);
    }
    const parsed = parseFeed(res.text);
    if (!parsed.ok) throw new Error(`RSS parse failed: ${parsed.error}`);
    const now = new Date().toISOString();
    return parsed.items.slice(0, this.opts.maxItems).map((item) => ({
      sourceUrl: item.link ?? this.opts.feedUrl,
      rawContent: [item.title ?? "", item.summary ?? ""].join("\n").slice(0, 4000),
      extracted: {
        title: item.title,
        event_url: item.link,
        start_date: item.published,
        confidence: 0.4,
      },
      fetchedAt: now,
    }));
  }

  parse(): Partial<import("../types.js").AIExtraction> {
    return {};
  }

  normalize(e: Partial<import("../types.js").AIExtraction>): Partial<import("../types.js").AIExtraction> {
    return e;
  }
}
