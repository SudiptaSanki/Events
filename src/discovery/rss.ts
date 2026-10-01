/**
 * RSS 2.0 / Atom feed parser (spec 4: "check for RSS/Atom" first).
 * Deliberately dependency-free and regex-based: no XML entity expansion,
 * no DTD processing, CDATA handled as opaque text. Output is UNTRUSTED data.
 */
import { sanitizeUntrustedText } from "../extract/sanitize.js";

export interface FeedItem {
  title: string | null;
  link: string | null;
  published: string | null; // ISO-8601 when parseable, else raw-or-null
  summary: string | null; // sanitized plain text
  flagged: boolean; // injection patterns were neutralized
}

export interface FeedParseResult {
  ok: boolean;
  kind: "rss" | "atom" | "unknown";
  items: FeedItem[];
  error: string | null;
}

function stripTags(s: string): string {
  // Remove script/style entirely (never execute, spec 31), then all tags.
  return s
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' })[m as "&amp;"] ?? m)
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function tagContents(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(xml)) !== null && guard++ < 5000) out.push(m[1] ?? "");
  return out;
}

function attr(haystack: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(haystack);
  return m ? (m[1] ?? null) : null;
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  if (Number.isNaN(t)) return null; // never invent dates (spec 42)
  return new Date(t).toISOString();
}

export function parseFeed(xml: string): FeedParseResult {
  const head = xml.slice(0, 2000).toLowerCase();
  try {
    if (/<rss[\s>]/.test(head) || /<channel[\s>]/.test(head)) {
      const items: FeedItem[] = [];
      for (const block of tagContents(xml, "item").slice(0, 200)) {
        const titleRaw = tagContents(block, "title")[0] ?? null;
        const linkRaw = tagContents(block, "link")[0] ?? null;
        const pubRaw = tagContents(block, "pubDate")[0] ?? tagContents(block, "dc:date")[0] ?? null;
        const descRaw =
          tagContents(block, "description")[0] ??
          tagContents(block, "content:encoded")[0] ??
          null;
        const summary = descRaw !== null ? sanitizeUntrustedText(stripTags(descRaw)) : null;
        items.push({
          title: titleRaw ? stripTags(titleRaw) || null : null,
          link: linkRaw ? stripTags(linkRaw) || null : null,
          published: normalizeDate(pubRaw ? stripTags(pubRaw) : null),
          summary: summary?.text || null,
          flagged: summary?.flagged ?? false,
        });
      }
      return { ok: true, kind: "rss", items, error: null };
    }
    if (/<feed[\s>]/.test(head)) {
      const items: FeedItem[] = [];
      const entryBlocks = tagContents(xml, "entry").slice(0, 200);
      for (const block of entryBlocks) {
        const titleRaw = tagContents(block, "title")[0] ?? null;
        // <link href="..."/> — attribute form.
        let link: string | null = null;
        const linkTags = block.match(/<link\s[^>]*>/gi) ?? [];
        for (const lt of linkTags) {
          const rel = attr(lt, "rel");
          const href = attr(lt, "href");
          if (href && (!rel || rel === "alternate")) {
            link = href;
            break;
          }
        }
        link ??= attr(linkTags[0] ?? "", "href");
        const pubRaw =
          tagContents(block, "published")[0] ?? tagContents(block, "updated")[0] ?? null;
        const sumRaw =
          tagContents(block, "summary")[0] ?? tagContents(block, "content")[0] ?? null;
        const summary = sumRaw !== null ? sanitizeUntrustedText(stripTags(sumRaw)) : null;
        items.push({
          title: titleRaw ? stripTags(titleRaw) || null : null,
          link,
          published: normalizeDate(pubRaw ? stripTags(pubRaw) : null),
          summary: summary?.text || null,
          flagged: summary?.flagged ?? false,
        });
      }
      return { ok: true, kind: "atom", items, error: null };
    }
    return { ok: false, kind: "unknown", items: [], error: "UNRECOGNIZED_FEED" };
  } catch (e) {
    return { ok: false, kind: "unknown", items: [], error: e instanceof Error ? e.message : "PARSE_FAILED" };
  }
}
