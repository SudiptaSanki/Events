/**
 * Threat-intelligence providers (spec 10 check 7, Phase 7). Pluggable verdicts
 * for registration/event URLs:
 * - NoopProvider: deterministic local heuristics only (default, zero cost).
 * - GoogleSafeBrowsingProvider: Safe Browsing v4 threatMatches (keyed, cached).
 * - CachedProvider: TTL wrapper so quotas and latency stay bounded (spec 28).
 *
 * A provider NEVER declares a URL "safe" — it returns hit/unknown only.
 * Unknown (including provider errors) adds no signal; the pipeline never
 * treats absence of a hit as proof of safety (spec 10).
 */
import type { Store } from "../db/store.js";

export type ThreatVerdict = "HIT" | "UNKNOWN";

export interface ThreatIntelResult {
  verdict: ThreatVerdict;
  threatTypes: string[]; // e.g. MALWARE, SOCIAL_ENGINEERING (empty when UNKNOWN)
  provider: string;
  checkedAt: string;
}

export interface ThreatIntelProvider {
  name(): string;
  checkUrl(url: string): Promise<ThreatIntelResult>;
}

export class NoopThreatIntel implements ThreatIntelProvider {
  name(): string {
    return "noop";
  }

  async checkUrl(url: string): Promise<ThreatIntelResult> {
    void url;
    return { verdict: "UNKNOWN", threatTypes: [], provider: "noop", checkedAt: new Date().toISOString() };
  }
}

const GSB_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";

export class GoogleSafeBrowsingProvider implements ThreatIntelProvider {
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(apiKey: string, fetchFn?: typeof fetch) {
    this.apiKey = apiKey;
    this.fetchFn = fetchFn ?? fetch;
  }

  name(): string {
    return "google-safe-browsing";
  }

  async checkUrl(url: string): Promise<ThreatIntelResult> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await this.fetchFn(`${GSB_ENDPOINT}?key=${encodeURIComponent(this.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "india-hackathon-intel", clientVersion: "0.1.0" },
          threatInfo: {
            threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // Fail to UNKNOWN (logged by caller) — never invent a hit, never claim safe.
        return { verdict: "UNKNOWN", threatTypes: [], provider: this.name(), checkedAt: new Date().toISOString() };
      }
      const data = (await res.json()) as { matches?: Array<{ threatType?: string }> };
      const types = (data.matches ?? []).map((m) => m.threatType ?? "UNKNOWN").filter(Boolean);
      return {
        verdict: types.length > 0 ? "HIT" : "UNKNOWN",
        threatTypes: types,
        provider: this.name(),
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return { verdict: "UNKNOWN", threatTypes: [], provider: this.name(), checkedAt: new Date().toISOString() };
    } finally {
      clearTimeout(t);
    }
  }
}

/** TTL cache in front of any provider (default 24h per URL). */
export class CachedThreatIntel implements ThreatIntelProvider {
  private inner: ThreatIntelProvider;
  private ttlMs: number;
  private cache = new Map<string, { expires: number; result: ThreatIntelResult }>();

  constructor(inner: ThreatIntelProvider, ttlMs = 24 * 3_600_000) {
    this.inner = inner;
    this.ttlMs = ttlMs;
  }

  name(): string {
    return `cached(${this.inner.name()})`;
  }

  async checkUrl(url: string): Promise<ThreatIntelResult> {
    const hit = this.cache.get(url);
    if (hit && hit.expires > Date.now()) return hit.result;
    const result = await this.inner.checkUrl(url);
    this.cache.set(url, { expires: Date.now() + this.ttlMs, result });
    return result;
  }

  cacheSize(): number {
    return this.cache.size;
  }
}

/** Build the configured provider from the environment (empty key => noop). */
export function providerFromEnv(fetchFn?: typeof fetch): ThreatIntelProvider {
  const key = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (key) return new CachedThreatIntel(new GoogleSafeBrowsingProvider(key, fetchFn));
  return new NoopThreatIntel();
}

/** Persist a definitive verdict into domain reputation (spec 56). */
export async function recordDomainVerdict(store: Store, domain: string, result: ThreatIntelResult, now: string): Promise<void> {
  if (result.verdict !== "HIT") return;
  await store.exec(
    `INSERT INTO domain_reputation(domain,reputation,notes,last_seen)
     VALUES (?,0,?,?) ON CONFLICT(domain) DO UPDATE SET reputation=0, notes=excluded.notes, last_seen=excluded.last_seen`,
    domain,
    `${result.provider}:${result.threatTypes.join(",")}`,
    now,
  );
}
