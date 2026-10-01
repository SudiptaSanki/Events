/** Seed source_registry from MVP_SOURCES. Idempotent (INSERT OR IGNORE). */
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { MVP_SOURCES, validateSeeds } from "../src/sources/seeds.js";

const errors = validateSeeds(MVP_SOURCES);
if (errors.length > 0) {
  console.error(JSON.stringify({ ok: false, errors }));
  process.exit(1);
}

const db = openDatabase();
migrate(db);
let seeded = 0;
for (const s of MVP_SOURCES) {
  const info = db.prepare(
    `INSERT OR IGNORE INTO source_registry(source_id,name,type,base_url,trust_score,enabled,rate_limit_ms)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(s.slug, s.slug, s.sourceType, s.baseUrl, s.trustScore, s.enabled ? 1 : 0, s.rateLimitMs);
  seeded += Number(info.changes ?? 0);
  // Refresh mutable fields on existing rows.
  db.prepare(
    `UPDATE source_registry SET type=?, base_url=?, trust_score=?, enabled=?, rate_limit_ms=? WHERE source_id=?`,
  ).run(s.sourceType, s.baseUrl, s.trustScore, s.enabled ? 1 : 0, s.rateLimitMs, s.slug);
}
const rows = db.prepare("SELECT source_id,type,trust_score,enabled FROM source_registry ORDER BY source_id").all();
console.log(JSON.stringify({ ok: true, seeded_new: seeded, sources: rows }));
db.close();
