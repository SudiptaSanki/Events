/**
 * Sitemap parser (spec 4: "check sitemap"). Handles urlset + sitemapindex
 * (one level of recursion is done by the connector, not here).
 * Regex-based, no entity expansion — URLs are validated on use.
 */

export interface SitemapUrl {
  loc: string;
  lastmod: string | null;
}

export interface SitemapParseResult {
  ok: boolean;
  kind: "urlset" | "index" | "unknown";
  urls: SitemapUrl[]; // for urlset: page URLs; for index: child sitemap URLs
  error: string | null;
}

function inner(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\s*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(xml)) !== null && guard++ < 20000) out.push(m[1] ?? "");
  return out;
}

function first(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\s*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i").exec(block);
  return m ? (m[1] ?? "").trim() || null : null;
}

function validHttpUrl(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(t)) return t;
  return null;
}

export function parseSitemap(xml: string): SitemapParseResult {
  try {
    const head = xml.slice(0, 2000).toLowerCase();
    if (head.includes("<sitemapindex")) {
      const urls: SitemapUrl[] = [];
      for (const block of inner(xml, "sitemap").slice(0, 1000)) {
        const loc = validHttpUrl(first(block, "loc"));
        if (loc) urls.push({ loc, lastmod: first(block, "lastmod") });
      }
      return { ok: true, kind: "index", urls, error: null };
    }
    if (head.includes("<urlset")) {
      const urls: SitemapUrl[] = [];
      for (const block of inner(xml, "url").slice(0, 20000)) {
        const loc = validHttpUrl(first(block, "loc"));
        if (loc) urls.push({ loc, lastmod: first(block, "lastmod") });
      }
      return { ok: true, kind: "urlset", urls, error: null };
    }
    return { ok: false, kind: "unknown", urls: [], error: "UNRECOGNIZED_SITEMAP" };
  } catch (e) {
    return { ok: false, kind: "unknown", urls: [], error: e instanceof Error ? e.message : "PARSE_FAILED" };
  }
}

/** Keep URLs matching any include pattern and no exclude pattern. */
export function filterSitemapUrls(
  urls: SitemapUrl[],
  include: RegExp[],
  exclude: RegExp[] = [/\.pdf$/i, /\.jpg$/i, /\.png$/i, /\/tag\//i, /\/author\//i, /\/page\//i],
  limit = 50,
): SitemapUrl[] {
  const out: SitemapUrl[] = [];
  for (const u of urls) {
    if (out.length >= limit) break;
    if (exclude.some((re) => re.test(u.loc))) continue;
    if (include.length > 0 && !include.some((re) => re.test(u.loc))) continue;
    out.push(u);
  }
  return out;
}
