/**
 * Link health monitoring (spec 21). Periodically re-resolves published links:
 * - REGISTRATION links older than 6h, EVENT_PAGE links older than 24h,
 * - records every check in link_checks,
 * - a changed final host raises HOST_CHANGED + review (LINK_REVIEW_REQUIRED),
 * - an unresolvable link marks UNREACHABLE + review; the old URL is never
 *   silently kept as the advertised link (verification_status -> REVIEW).
 * DNS/TLS failures surface as fetch errors — recorded, never hidden.
 * Store-based: identical logic on SQLite and D1.
 */
import { normalizeUrl } from "../normalize/url.js";
import { classifyDomainRelationship } from "../security/domains.js";
import type { Store } from "../db/store.js";
import type { RedirectResolver } from "../verification/linkVerification.js";

export interface RecheckOptions {
  redirectResolver: RedirectResolver;
  now?: () => string;
  registrationMaxAgeHrs?: number;
  eventPageMaxAgeHrs?: number;
  limit?: number;
}

export interface RecheckSummary {
  checked: number;
  unchanged: number;
  hostChanged: number;
  unreachable: number;
  errors: number;
}

interface LinkRow {
  link_id: number;
  event_id: string;
  url_type: string;
  original_url: string;
  canonical_url: string | null;
  final_url: string | null;
  domain: string | null;
}

function cutoffIso(nowMs: number, ageHrs: number): string {
  return new Date(nowMs - ageHrs * 3_600_000).toISOString();
}

export async function recheckLinks(store: Store, opts: RecheckOptions): Promise<RecheckSummary> {
  const now = opts.now ?? (() => new Date().toISOString());
  const nowMs = Date.parse(now());
  const summary: RecheckSummary = { checked: 0, unchanged: 0, hostChanged: 0, unreachable: 0, errors: 0 };
  const limit = opts.limit ?? 50;

  const rows = await store.query<LinkRow>(
    `SELECT link_id, event_id, url_type, original_url, canonical_url, final_url, domain
     FROM event_links
     WHERE (url_type = 'REGISTRATION' AND (last_checked IS NULL OR last_checked < ?))
        OR (url_type = 'EVENT_PAGE' AND (last_checked IS NULL OR last_checked < ?))
     ORDER BY last_checked LIMIT ?`,
    cutoffIso(nowMs, opts.registrationMaxAgeHrs ?? 6),
    cutoffIso(nowMs, opts.eventPageMaxAgeHrs ?? 24),
    limit,
  );

  for (const row of rows) {
    const observedAt = now();
    summary.checked++;
    const start = row.canonical_url ?? row.original_url;
    try {
      const res = await opts.redirectResolver(start);
      if (!res.finalUrl) {
        await markUnreachable(store, row, observedAt, res.error ?? "UNRESOLVABLE");
        summary.unreachable++;
        continue;
      }
      const norm = normalizeUrl(res.finalUrl);
      const prevHost = row.final_url ? normalizeUrl(row.final_url).host : row.domain;
      const hostChanged = !!norm.host && !!prevHost && norm.host !== prevHost;
      await store.exec(
        `INSERT INTO link_checks(link_id,checked_at,http_status,final_url,error) VALUES (?,?,?,?,?)`,
        row.link_id,
        observedAt,
        res.chain.at(-1)?.status ?? null,
        res.finalUrl,
        res.error,
      );
      await store.exec(
        `UPDATE event_links SET final_url=?, domain=?, redirect_count=?, redirect_chain=?,
          domain_relationship=?, last_checked=? WHERE link_id=?`,
        res.finalUrl,
        norm.host,
        res.redirectCount,
        JSON.stringify(res.chain),
        classifyDomainRelationship(norm.host ?? "", null).relationship,
        observedAt,
        row.link_id,
      );
      if (hostChanged) {
        await store.exec(
          `UPDATE event_links SET verification_status='REVIEW', security_status='FLAGGED' WHERE link_id=?`,
          row.link_id,
        );
        await store.exec(
          `INSERT INTO security_flags(event_id,link_id,flag_type,severity,details,resolved,created_at)
           VALUES (?,?,?,?,?,0,?)`,
          row.event_id,
          row.link_id,
          "HOST_CHANGED",
          "warning",
          `${prevHost} -> ${norm.host}`,
          observedAt,
        );
        await store.exec(
          `INSERT INTO event_changes(event_id,field,old_value,new_value,detected_at) VALUES (?,?,?,?,?)`,
          row.event_id,
          row.url_type === "REGISTRATION" ? "registration_url" : "event_url",
          row.final_url,
          res.finalUrl,
          observedAt,
        );
        await store.exec(
          `INSERT INTO review_queue(event_id,reason,score,created_at,resolved) VALUES (?,?,?, ?,0)`,
          row.event_id,
          "LINK_REVIEW_REQUIRED: advertised link now resolves to a different host",
          null,
          observedAt,
        );
        // Stop advertising the old destination until re-verified.
        if (row.url_type === "REGISTRATION") {
          await store.exec(
            `UPDATE events SET registration_url=NULL,
              registration_unverified_note='Registration link changed destination and requires re-verification.',
              status=CASE WHEN status IN ('VERIFIED','PUBLISHED') THEN 'NEEDS_REVIEW' ELSE status END
             WHERE event_id=?`,
            row.event_id,
          );
        }
        summary.hostChanged++;
      } else {
        summary.unchanged++;
      }
    } catch (e) {
      summary.errors++;
      await store.exec(`INSERT INTO link_checks(link_id,checked_at,http_status,final_url,error) VALUES (?,?,?,?,?)`,
        row.link_id, observedAt, null, null, e instanceof Error ? e.message : "RECHECK_FAILED",
      );
    }
  }
  return summary;
}

async function markUnreachable(store: Store, row: LinkRow, observedAt: string, error: string): Promise<void> {
  await store.exec(`INSERT INTO link_checks(link_id,checked_at,http_status,final_url,error) VALUES (?,?,?,?,?)`,
    row.link_id, observedAt, null, row.final_url, error,
  );
  await store.exec(
    `UPDATE event_links SET security_status='UNREACHABLE', verification_status='REVIEW', last_checked=? WHERE link_id=?`,
    observedAt,
    row.link_id,
  );
  await store.exec(
    `INSERT INTO review_queue(event_id,reason,score,created_at,resolved) VALUES (?,?,?, ?,0)`,
    row.event_id,
    `LINK_REVIEW_REQUIRED: link unresolvable (${error})`,
    null,
    observedAt,
  );
}
