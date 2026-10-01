/**
 * robots.txt parsing + per-host cache (spec 30: respect robots.txt and terms).
 * Minimal RFC 9309 subset: User-agent groups, Allow/Disallow with longest-match
 * precedence, Sitemap: directives. No network here — fetching is injected.
 */

export interface RobotsRules {
  disallows: string[];
  allows: string[];
  sitemaps: string[];
  /** Raw text for auditability. */
  raw: string;
  fetchedAt: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { expires: number; rules: RobotsRules }>();

export function clearRobotsCache(): void {
  cache.clear();
}

function cacheKeyFor(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

/** Parse robots.txt text into rules for the given user-agent. */
export function parseRobotsTxt(text: string, userAgent = "*", fetchedAt?: string): RobotsRules {
  const rules: RobotsRules = {
    disallows: [],
    allows: [],
    sitemaps: [],
    raw: text.slice(0, 8000),
    fetchedAt: fetchedAt ?? new Date().toISOString(),
  };
  // Group matching: collect groups, then apply the most specific matching group.
  interface Group { agents: string[]; allows: string[]; disallows: string[] }
  const groups: Group[] = [];
  let current: Group | null = null;
  let seenRule = false;

  const flush = (): void => {
    if (current) groups.push(current);
    current = null;
    seenRule = false;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]!.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (seenRule) flush();
      if (!current) current = { agents: [], allows: [], disallows: [] };
      current.agents.push(value.toLowerCase());
    } else if (field === "disallow" || field === "allow") {
      if (!current) continue;
      seenRule = true;
      if (value === "") continue; // Disallow: (empty) = allow all
      if (field === "disallow") current.disallows.push(value);
      else current.allows.push(value);
    } else if (field === "sitemap") {
      if (value) rules.sitemaps.push(value);
    }
  }
  flush();

  const ua = userAgent.toLowerCase();
  // Most specific group whose agent matches (exact > prefix > wildcard).
  let best: Group | null = null;
  let bestScore = -1;
  for (const g of groups) {
    for (const a of g.agents) {
      let score = -1;
      if (a === "*") score = 0;
      else if (a === ua) score = 2;
      else if (ua.startsWith(a) || a.startsWith(ua)) score = 1;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
  }
  if (best) {
    rules.allows = best.allows;
    rules.disallows = best.disallows;
  }
  return rules;
}

/** Longest-match wins; Allow beats Disallow on tie. Empty disallow = allowed. */
export function isAllowed(rules: RobotsRules, url: string): boolean {
  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    return false;
  }
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const a of rules.allows) {
    if (path.startsWith(a) && a.length > bestAllow) bestAllow = a.length;
  }
  for (const d of rules.disallows) {
    if (d !== "" && path.startsWith(d) && d.length > bestDisallow) bestDisallow = d.length;
  }
  if (bestDisallow < 0) return true;
  return bestAllow >= bestDisallow;
}

/** Fetch + cache robots.txt for a host. Fail-open with empty rules EXCEPT the
 *  fetch itself is logged by the caller; a 404 means "no restrictions". */
export async function getRobotsRules(
  url: string,
  fetchFn: typeof fetch,
  userAgent = "*",
  timeoutMs = 10000,
): Promise<RobotsRules> {
  const key = cacheKeyFor(url);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.rules;

  const robotsUrl = key + "/robots.txt";
  let rules: RobotsRules;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(robotsUrl, {
        headers: { "User-Agent": userAgent },
        signal: ctrl.signal,
      });
      if (res.status === 404 || res.status === 410) {
        rules = { disallows: [], allows: [], sitemaps: [], raw: "", fetchedAt: new Date().toISOString() };
      } else if (!res.ok) {
        // Fail closed on server errors: do not crawl what we cannot check.
        rules = { disallows: ["/"], allows: [], sitemaps: [], raw: "", fetchedAt: new Date().toISOString() };
      } else {
        const text = (await res.text()).slice(0, 100_000);
        rules = parseRobotsTxt(text, userAgent);
      }
    } finally {
      clearTimeout(t);
    }
  } catch {
    // Network failure fetching robots.txt: fail closed (disallow) to be safe.
    rules = { disallows: ["/"], allows: [], sitemaps: [], raw: "", fetchedAt: new Date().toISOString() };
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, rules });
  return rules;
}
