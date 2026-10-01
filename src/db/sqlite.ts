/**
 * Local SQLite development mode (spec 76). Uses Node 22 built-in `node:sqlite`
 * — zero native dependencies. The same schema.sql applies to Cloudflare D1,
 * so dev and prod share one migration source.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_CANDIDATES = [
  join(here, "schema.sql"), // compiled dist/src/db/ (after build copies assets)
  join(process.cwd(), "src", "db", "schema.sql"), // repo root dev
];

function findSchema(): string {
  for (const p of SCHEMA_CANDIDATES) {
    try {
      readFileSync(p, "utf8");
      return p;
    } catch { /* try next */ }
  }
  throw new Error(`schema.sql not found (tried: ${SCHEMA_CANDIDATES.join(", ")})`);
}
const SCHEMA_PATH = findSchema();

export function defaultDbPath(): string {
  return join(process.cwd(), "data", "events.sqlite3");
}

export function openDatabase(path?: string): DatabaseSync {
  const dbPath = path ?? process.env.SQLITE_PATH ?? defaultDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return db;
}

/** Apply schema.sql idempotently. Returns current schema version. */
export function migrate(db: DatabaseSync): number {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);
  // Column-level upgrades for databases created before the column existed.
  // (Fresh installs get them from schema.sql; this covers upgrades.)
  const cols = db.prepare("PRAGMA table_info(notification_targets)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "filter")) {
    db.exec("ALTER TABLE notification_targets ADD COLUMN filter TEXT");
  }
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
  return row.v ?? 1;
}

export function tableCounts(db: DatabaseSync): Record<string, number> {
  const tables = [
    "organizers", "events", "event_sources", "source_registry", "source_runs",
    "event_changes", "event_links", "link_checks", "verification_evidence",
    "notifications", "notification_targets", "review_queue", "security_flags",
    "domain_reputation", "source_reputation", "dead_letter_queue",
  ];
  const out: Record<string, number> = {};
  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number };
      out[t] = row.c;
    } catch {
      out[t] = -1; // table missing
    }
  }
  return out;
}

export function dbFileExists(path?: string): boolean {
  return existsSync(path ?? defaultDbPath());
}
