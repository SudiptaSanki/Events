/**
 * Event persistence for discovery (spec 39, 47). Clustering rule: one event
 * row per dedupe_key; repeat sightings attach event_sources rows instead of
 * creating duplicates. Store-based (SQLite locally, D1 in Workers).
 */
import { randomUUID } from "node:crypto";
import { dedupeKey } from "../normalize/dedup.js";
import { normalizeUrl } from "../normalize/url.js";
import type { Store } from "./store.js";
import type { EventFormat } from "../types.js";

export interface DiscoveredEventInput {
  title: string;
  organizer: string | null;
  startDate: string | null;
  city: string | null;
  eventUrl: string | null;
  registrationUrl: string | null;
  description: string | null;
  format: EventFormat | null;
  categories: string[] | null;
}

export function computeDedupeKey(input: DiscoveredEventInput): string {
  return dedupeKey({
    title: input.title,
    organizer: input.organizer,
    startDate: input.startDate,
    city: input.city,
    eventUrl: input.eventUrl,
    registrationUrl: input.registrationUrl,
  });
}

export async function findEventByDedupeKey(store: Store, key: string): Promise<{ event_id: string } | null> {
  return store.queryOne<{ event_id: string }>("SELECT event_id FROM events WHERE dedupe_key = ? LIMIT 1", key);
}

/** Insert a new DISCOVERED event + provenance + link rows. Returns event_id. */
export async function insertDiscoveredEvent(
  store: Store,
  input: DiscoveredEventInput,
  source: { sourceId: string; sourceUrl: string; sourceLevel: number | null },
  now: string,
): Promise<string> {
  const eventId = randomUUID();
  const key = computeDedupeKey(input);
  await store.exec(
    `INSERT INTO events(event_id,title,normalized_title,organizer_name,description,categories,format,
      start_date,event_url,registration_url,status,verification_score,dedupe_key,first_seen,last_seen)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    eventId,
    input.title,
    input.title.toLowerCase().slice(0, 512),
    input.organizer,
    input.description,
    input.categories ? JSON.stringify(input.categories) : null,
    input.format ?? "UNKNOWN",
    input.startDate,
    input.eventUrl,
    input.registrationUrl,
    "DISCOVERED",
    0,
    key,
    now,
    now,
  );
  await attachSource(store, eventId, source, now);
  await insertLinkRow(store, eventId, "EVENT_PAGE", input.eventUrl, now);
  await insertLinkRow(store, eventId, "REGISTRATION", input.registrationUrl, now);
  return eventId;
}

/** Attach an additional provenance reference to an existing event (spec 47). */
export async function attachSource(
  store: Store,
  eventId: string,
  source: { sourceId: string; sourceUrl: string; sourceLevel: number | null },
  now: string,
): Promise<void> {
  await store.exec(
    `INSERT OR IGNORE INTO event_sources(event_id,source_id,source_url,source_level,observed_at)
     VALUES (?,?,?,?,?)`,
    eventId,
    source.sourceId,
    source.sourceUrl,
    source.sourceLevel,
    now,
  );
  await store.exec("UPDATE events SET last_seen = ? WHERE event_id = ?", now, eventId);
}

async function insertLinkRow(
  store: Store,
  eventId: string,
  urlType: "EVENT_PAGE" | "REGISTRATION",
  rawUrl: string | null,
  now: string,
): Promise<void> {
  if (!rawUrl) return;
  const norm = normalizeUrl(rawUrl);
  await store.exec(
    `INSERT INTO event_links(event_id,url_type,original_url,canonical_url,domain,is_https,
      redirect_count,security_status,verification_status,first_seen)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    eventId,
    urlType,
    rawUrl,
    norm.canonical,
    norm.host,
    norm.isHttps ? 1 : 0,
    0,
    "PENDING",
    "UNVERIFIED",
    now,
  );
}
