/**
 * Discovery runner (spec 4, 27, 29, 30). Iterates enabled connectors:
 * - enforces per-source rate limits (last_run + interval; skips when too soon),
 * - records source_runs rows for quality tracking (spec 51),
 * - routes failures to dead_letter_queue (never silently lost, spec 28),
 * - clusters repeat sightings onto one event row (spec 47).
 * Store-based: identical logic on SQLite and D1.
 */
import { logger } from "../logging.js";
import { attachSource, computeDedupeKey, findEventByDedupeKey, insertDiscoveredEvent } from "../db/events.js";
import { recordSourceOutcome } from "../quality/reputation.js";
import type { Store } from "../db/store.js";
import type { SourceConnector } from "../sources/types.js";

export interface SourceRunResult {
  slug: string;
  status: "OK" | "SKIPPED_RATE_LIMIT" | "SKIPPED_DISABLED" | "FAILED";
  discovered: number;
  inserted: number;
  attached: number;
  skippedNoTitle: number;
  error: string | null;
}

export interface DiscoverySummary {
  startedAt: string;
  finishedAt: string;
  sources: SourceRunResult[];
  totals: { discovered: number; inserted: number; attached: number; failed: number };
}

export interface RunnerOptions {
  now?: () => string;
  onlySlugs?: Set<string>;
  dryRun?: boolean; // discover + classify, but write nothing
}

async function ensureRegistryRow(store: Store, c: SourceConnector): Promise<void> {
  await store.exec(
    `INSERT OR IGNORE INTO source_registry(source_id,name,type,base_url,trust_score,enabled,rate_limit_ms)
     VALUES (?,?,?,?,?,?,?)`,
    c.name(),
    c.name(),
    c.type(),
    null,
    c.getTrustScore(),
    1,
    c.getRateLimit().requestDelayMs,
  );
}

async function registryRow(store: Store, slug: string): Promise<{ enabled: number; rate_limit_ms: number; last_run: string | null } | null> {
  return store.queryOne<{ enabled: number; rate_limit_ms: number; last_run: string | null }>(
    "SELECT enabled, rate_limit_ms, last_run FROM source_registry WHERE source_id = ?",
    slug,
  );
}

export async function runDiscovery(
  store: Store,
  connectors: SourceConnector[],
  opts: RunnerOptions = {},
): Promise<DiscoverySummary> {
  const now = opts.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const results: SourceRunResult[] = [];

  for (const connector of connectors) {
    const slug = connector.name();
    if (opts.onlySlugs && !opts.onlySlugs.has(slug)) continue;
    const result: SourceRunResult = {
      slug, status: "OK", discovered: 0, inserted: 0, attached: 0, skippedNoTitle: 0, error: null,
    };
    try {
      if (!opts.dryRun) await ensureRegistryRow(store, connector);
      const reg = opts.dryRun ? null : await registryRow(store, slug);
      if (reg && reg.enabled === 0) {
        result.status = "SKIPPED_DISABLED";
        results.push(result);
        continue;
      }
      // Rate limit: source_registry.rate_limit_ms doubles as min interval between runs.
      const intervalMs = Math.max(connector.getRateLimit().requestDelayMs, 60_000);
      const storedInterval = reg ? Math.max(reg.rate_limit_ms, intervalMs) : intervalMs;
      if (reg?.last_run && Date.now() - Date.parse(reg.last_run) < storedInterval) {
        result.status = "SKIPPED_RATE_LIMIT";
        results.push(result);
        continue;
      }

      const runStarted = now();
      const items = await connector.discover();
      result.discovered = items.length;

      let inserted = 0;
      let attached = 0;
      if (!opts.dryRun) {
        for (const item of items) {
          const title = item.extracted.title?.trim() || null;
          if (!title) {
            result.skippedNoTitle++;
            continue; // never invent titles (spec 42)
          }
          const key = computeDedupeKey({
            title,
            organizer: item.extracted.organizer ?? null,
            startDate: item.extracted.start_date ?? null,
            city: null,
            eventUrl: item.extracted.event_url ?? item.sourceUrl,
            registrationUrl: item.extracted.registration_url ?? null,
            description: null,
            format: null,
            categories: null,
          });
          const existing = await findEventByDedupeKey(store, key);
          if (existing) {
            await attachSource(store, existing.event_id, { sourceId: slug, sourceUrl: item.sourceUrl, sourceLevel: connector.level() }, now());
            await recordSourceOutcome(store, slug, "duplicate", now());
            attached++;
          } else {
            const eventId = await insertDiscoveredEvent(
              store,
              {
                title,
                organizer: item.extracted.organizer ?? null,
                startDate: item.extracted.start_date ?? null,
                city: null,
                eventUrl: item.extracted.event_url ?? item.sourceUrl,
                registrationUrl: item.extracted.registration_url ?? null,
                description: null,
                format: item.extracted.format ?? null,
                categories: null,
              },
              { sourceId: slug, sourceUrl: item.sourceUrl, sourceLevel: connector.level() },
              now(),
            );
            if (item.securityNote) {
              // Extraction-time warnings travel with the event as data for review.
              await store.exec(
                `INSERT INTO security_flags(event_id,flag_type,severity,details,resolved,created_at)
                 VALUES (?,?,?,?,?,?)`,
                eventId,
                "EXTRACTION_WARNING",
                "warning",
                item.securityNote.slice(0, 500),
                0,
                now(),
              );
            }
            inserted++;
          }
        }
        await store.exec(
          `INSERT INTO source_runs(source_id,started_at,finished_at,discovered,verified,rejected,error)
           VALUES (?,?,?,?,?,?,?)`,
          slug,
          runStarted,
          now(),
          items.length,
          0,
          result.skippedNoTitle,
          null,
        );
        await store.exec("UPDATE source_registry SET last_run = ?, last_status = ? WHERE source_id = ?", now(), "OK", slug);
      }
      result.inserted = inserted;
      result.attached = attached;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "UNKNOWN_ERROR";
      result.status = "FAILED";
      result.error = msg;
      logger.warn("discovery source failed", { source: slug, error: msg });
      if (!opts.dryRun) {
        const runStarted = now();
        await store.exec(
          `INSERT INTO source_runs(source_id,started_at,finished_at,discovered,verified,rejected,error)
           VALUES (?,?,?,?,?,?,?)`,
          slug,
          runStarted,
          now(),
          0,
          0,
          0,
          msg,
        );
        await store.exec("UPDATE source_registry SET last_run = ?, last_status = ? WHERE source_id = ?", now(), "FAILED", slug);
        await store.exec(
          `INSERT INTO dead_letter_queue(queue,payload,error,attempts) VALUES (?,?,?,?)`,
          "discovery",
          JSON.stringify({ source: slug, at: now() }),
          msg,
          1,
        );
      }
    }
    results.push(result);
  }

  const finishedAt = now();
  return {
    startedAt,
    finishedAt,
    sources: results,
    totals: {
      discovered: results.reduce((a, r) => a + r.discovered, 0),
      inserted: results.reduce((a, r) => a + r.inserted, 0),
      attached: results.reduce((a, r) => a + r.attached, 0),
      failed: results.filter((r) => r.status === "FAILED").length,
    },
  };
}
