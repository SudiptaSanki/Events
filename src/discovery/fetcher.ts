/**
 * Robots-aware HTTP fetcher (spec 30). Single choke point for all outbound
 * discovery traffic:
 * - honors robots.txt (fail-closed on errors),
 * - identifies with a descriptive User-Agent,
 * - enforces timeout + response size caps,
 * - never executes scripts, downloads binaries, or bypasses blocks (spec 31).
 */
import { getRobotsRules, isAllowed } from "./robots.js";

export const DISCOVERY_USER_AGENT =
  "IndiaHackathonIntel/0.1 (+event-discovery; respects robots.txt; contact via repo)";

export interface FetchResult {
  ok: boolean;
  status: number | null;
  finalUrl: string;
  contentType: string | null;
  text: string | null;
  bytes: number;
  blockedByRobots: boolean;
  error: string | null;
}

export interface FetchOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  /** Set false only for fetching robots.txt-adjacent infrastructure in tests. */
  obeyRobots?: boolean;
  userAgent?: string;
}

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const userAgent = opts.userAgent ?? DISCOVERY_USER_AGENT;
  const fail = (error: string, status: number | null = null): FetchResult => ({
    ok: false, status, finalUrl: url, contentType: null, text: null,
    bytes: 0, blockedByRobots: false, error,
  });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail("INVALID_URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail("UNSUPPORTED_SCHEME");
  }

  if (opts.obeyRobots !== false) {
    const rules = await getRobotsRules(url, fetchFn, userAgent);
    if (!isAllowed(rules, url)) {
      return {
        ok: false, status: null, finalUrl: url, contentType: null, text: null,
        bytes: 0, blockedByRobots: true, error: "BLOCKED_BY_ROBOTS_TXT",
      };
    }
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml,text/xml;q=0.9,text/plain;q=0.8",
      },
      signal: ctrl.signal,
    });
    const status = res.status;
    // Stop if blocked — never bypass anti-bot systems (spec 4).
    if (status === 403 || status === 429 || status === 503) {
      return { ...fail(`BLOCKED_HTTP_${status}`, status), finalUrl: res.url || url };
    }
    if (!res.ok) return { ...fail(`HTTP_${status}`, status), finalUrl: res.url || url };

    const contentType = res.headers.get("content-type");
    const claimed = Number(res.headers.get("content-length") ?? "0");
    if (claimed > maxBytes) return { ...fail("RESPONSE_TOO_LARGE", status), finalUrl: res.url || url };

    // Stream with an enforced cap (Content-Length may lie or be absent).
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      if (text.length > maxBytes) return fail("RESPONSE_TOO_LARGE", status);
      return { ok: true, status, finalUrl: res.url || url, contentType, text, bytes: text.length, blockedByRobots: false, error: null };
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          try { await reader.cancel(); } catch { /* ignore */ }
          return { ...fail("RESPONSE_TOO_LARGE", status), finalUrl: res.url || url };
        }
        chunks.push(value);
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const text = buf.toString("utf8");
    return { ok: true, status, finalUrl: res.url || url, contentType, text, bytes, blockedByRobots: false, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FETCH_FAILED";
    return fail(/abort/i.test(msg) ? "TIMEOUT" : msg);
  } finally {
    clearTimeout(t);
  }
}

/** Polite delay helper — every source loop must await this between requests. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
