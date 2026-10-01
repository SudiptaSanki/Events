/**
 * Verify DISCOVERED events: resolve official context over live HTTP, score,
 * and persist. DRY_RUN=true (default) resolves + scores without writing.
 *
 * Usage: npm run verify -- [--slug X] [--limit N] [--live]
 *   --live writes results to the database (default is dry-run).
 */
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { providerFromEnv } from "../src/security/threatIntel.js";
import { verifyDiscoveredEvent, type StoredEvent } from "../src/verification/verifyDiscovered.js";

const args = process.argv.slice(2);
const slugFilter = args.includes("--slug") ? args[args.indexOf("--slug")! + 1] : undefined;
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit")! + 1] ?? 10) : 10;
const live = args.includes("--live");
const dryRun = !live;

const db = openDatabase();
migrate(db);
const store = createSqliteStore(db);

const rows = await store.query<StoredEvent>(
  `SELECT e.event_id, e.title, e.organizer_name, e.event_url, e.registration_url,
          e.start_date, e.registration_deadline, e.categories, e.format, e.status,
          e.first_seen, e.last_seen
   FROM events e
   ${slugFilter ? "JOIN event_sources s ON s.event_id = e.event_id AND s.source_id = ?" : ""}
   WHERE e.status = 'DISCOVERED'
   ORDER BY e.first_seen DESC LIMIT ?`,
  ...(slugFilter ? [slugFilter, limit] : [limit]),
);

console.log(JSON.stringify({ dryRun, pending: rows.length }));

for (const row of rows) {
  try {
    const result = await verifyDiscoveredEvent(store, row, { dryRun, threatIntel: providerFromEnv() });
    console.log(
      [
        `EVENT: ${row.title}`,
        `SCORE: ${result.output.score} (${result.output.decision} / Tier ${result.output.tier}) -> ${result.newStatus}`,
        `REG: ${row.registration_url ?? "(none)"} => ${result.output.link ? `${result.output.link.outcome} -> ${result.output.link.finalUrl}` : "NO_LINK"}`,
        `FLAGS: [${result.output.securityFlags.join(",") || "none"}]`,
        `GATE: ${result.output.gate.pass ? "PASS" : "BLOCKED:" + result.output.gate.reasons.join(",")}`,
        `WROTE: ${result.wrote}`,
        `---`,
      ].join("\n"),
    );
  } catch (e) {
    console.error(JSON.stringify({ event: row.event_id, error: e instanceof Error ? e.message : "FAILED" }));
  }
}
db.close();
