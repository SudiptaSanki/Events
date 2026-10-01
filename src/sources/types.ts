/**
 * SourceConnector interface (spec 73) + source registry.
 * The core engine never cares how a source works — only this contract.
 */
import type { AIExtraction } from "../types.js";

export type SourceType =
  | "PLATFORM"
  | "UNIVERSITY"
  | "GOVERNMENT"
  | "COMPANY"
  | "COMMUNITY"
  | "SEARCH"
  | "SOCIAL";

export interface RateLimit {
  requestDelayMs: number;
  maxRequestsPerRun: number;
  concurrentRequests: number;
  retryLimit: number;
  backoffMs: number;
}

export interface DiscoveredItem {
  /** URL where the item was found (untrusted until verified). */
  sourceUrl: string;
  /** Raw fetched content (HTML/text snippet) — treated as UNTRUSTED DATA. */
  rawContent: string;
  /** Best-effort extracted fields (may contain nulls; never hallucinated). */
  extracted: Partial<AIExtraction>;
  fetchedAt: string;
  /** Optional extractor warning, e.g. neutralized prompt-injection patterns. */
  securityNote?: string;
}

export interface SourceConnector {
  /** Stable slug, e.g. "devfolio". */
  name(): string;
  type(): SourceType;
  /** Source hierarchy level 1-7 (spec section 1). */
  level(): 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Discover candidate items. Must respect rate limits + robots/terms. */
  discover(): Promise<DiscoveredItem[]>;
  /** Fetch full content for one item (optional second pass). */
  fetch?(item: DiscoveredItem): Promise<string>;
  /** Parse raw content into extracted fields. Must use sanitizeUntrustedText. */
  parse(raw: string, sourceUrl: string): Partial<AIExtraction>;
  /** Normalize extracted fields (dates -> ISO, cities, URLs). */
  normalize(extracted: Partial<AIExtraction>): Partial<AIExtraction>;
  getRateLimit(): RateLimit;
  getTrustScore(): number;
}

/** In-memory registry; persistence lives in source_registry table. */
export class SourceRegistry {
  private connectors = new Map<string, SourceConnector>();

  register(connector: SourceConnector): void {
    if (this.connectors.has(connector.name())) {
      throw new Error(`Source already registered: ${connector.name()}`);
    }
    this.connectors.set(connector.name(), connector);
  }

  get(name: string): SourceConnector | undefined {
    return this.connectors.get(name);
  }

  list(): SourceConnector[] {
    return [...this.connectors.values()];
  }

  enabled(names?: Set<string>): SourceConnector[] {
    return this.list().filter((c) => !names || names.has(c.name()));
  }
}

export const DEFAULT_RATE_LIMIT: RateLimit = {
  requestDelayMs: 2000,
  maxRequestsPerRun: 30,
  concurrentRequests: 1,
  retryLimit: 2,
  backoffMs: 5000,
};
