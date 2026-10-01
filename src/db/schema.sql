-- India Hackathon & Tech Event Intelligence System
-- Schema v1 (Phase 1 Foundation). Compatible with Cloudflare D1 and local SQLite.
-- All timestamps are ISO-8601 TEXT. Booleans are INTEGER 0/1.

PRAGMA journal_mode = WAL;

-- Organizers (spec 59)
CREATE TABLE IF NOT EXISTS organizers (
  organizer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  official_domain TEXT,
  country TEXT,
  type TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  social_accounts TEXT, -- JSON array
  reputation_score INTEGER NOT NULL DEFAULT 50,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_organizers_normalized ON organizers(normalized_name);
CREATE INDEX IF NOT EXISTS idx_organizers_domain ON organizers(official_domain);

-- Events (spec 39)
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  organizer_id TEXT REFERENCES organizers(organizer_id),
  organizer_name TEXT,
  description TEXT,
  categories TEXT, -- JSON array
  format TEXT NOT NULL DEFAULT 'UNKNOWN',
  country TEXT,
  state TEXT,
  city TEXT,
  city_original TEXT,
  venue TEXT,
  address TEXT,
  timezone TEXT,
  start_date TEXT,
  end_date TEXT,
  registration_deadline TEXT,
  registration_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  event_url TEXT,
  registration_url TEXT,
  registration_unverified_note TEXT,
  eligibility TEXT,
  team_size TEXT,
  prize TEXT,
  technologies TEXT, -- JSON array
  status TEXT NOT NULL DEFAULT 'DISCOVERED',
  verification_decision TEXT,
  verification_score INTEGER NOT NULL DEFAULT 0,
  source_trust_score INTEGER,
  india_relevance_score INTEGER,
  freshness_score INTEGER,
  publishing_tier TEXT,
  dedupe_key TEXT,
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_verified TEXT,
  last_link_check TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_dedupe ON events(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_events_deadline ON events(registration_deadline);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_date);
CREATE INDEX IF NOT EXISTS idx_events_score ON events(verification_score);

-- Event sources (many-to-one provenance, spec 47)
CREATE TABLE IF NOT EXISTS event_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_level INTEGER,
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(event_id, source_url)
);
CREATE INDEX IF NOT EXISTS idx_event_sources_event ON event_sources(event_id);

-- Source registry + runs (spec 16, 51)
CREATE TABLE IF NOT EXISTS source_registry (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT,
  trust_score INTEGER NOT NULL DEFAULT 50,
  enabled INTEGER NOT NULL DEFAULT 1,
  rate_limit_ms INTEGER NOT NULL DEFAULT 2000,
  last_run TEXT,
  last_status TEXT
);

CREATE TABLE IF NOT EXISTS source_runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES source_registry(source_id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  discovered INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

-- Changes (spec 20)
CREATE TABLE IF NOT EXISTS event_changes (
  change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_changes_event ON event_changes(event_id);

-- Links (spec 40)
CREATE TABLE IF NOT EXISTS event_links (
  link_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  url_type TEXT NOT NULL,
  original_url TEXT NOT NULL,
  canonical_url TEXT,
  final_url TEXT,
  domain TEXT,
  is_https INTEGER NOT NULL DEFAULT 0,
  redirect_count INTEGER NOT NULL DEFAULT 0,
  redirect_chain TEXT, -- JSON array
  domain_relationship TEXT,
  provider_category TEXT,
  security_status TEXT NOT NULL DEFAULT 'PENDING',
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  last_checked TEXT,
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_links_event ON event_links(event_id);
CREATE INDEX IF NOT EXISTS idx_links_domain ON event_links(domain);

CREATE TABLE IF NOT EXISTS link_checks (
  check_id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES event_links(link_id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  http_status INTEGER,
  final_url TEXT,
  error TEXT
);

-- Verification evidence (spec 41)
CREATE TABLE IF NOT EXISTS verification_evidence (
  evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_trust INTEGER,
  supports_claim INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_evidence_event ON verification_evidence(event_id);

-- Notifications + targets (Phase 5; tables created now so schema is stable)
CREATE TABLE IF NOT EXISTS notification_targets (
  target_id TEXT PRIMARY KEY, -- e.g. telegram:channel:XYZ
  channel TEXT NOT NULL, -- TELEGRAM | DISCORD | WHATSAPP
  destination TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  filter TEXT -- optional JSON subscription filter, e.g. {"categories":["Hackathon"],"cities":["Pune"]}
);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES notification_targets(target_id),
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED|SENT|FAILED|SUPPRESSED
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_event ON notifications(event_id);

-- Review queue (spec 34)
CREATE TABLE IF NOT EXISTS review_queue (
  review_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  score INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved INTEGER NOT NULL DEFAULT 0,
  resolution TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_open ON review_queue(resolved);

-- Security flags (spec 33)
CREATE TABLE IF NOT EXISTS security_flags (
  flag_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT REFERENCES events(event_id) ON DELETE CASCADE,
  link_id INTEGER REFERENCES event_links(link_id) ON DELETE SET NULL,
  flag_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  details TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_flags_event ON security_flags(event_id);

-- Domain + source reputation (spec 52, 53, 56)
CREATE TABLE IF NOT EXISTS domain_reputation (
  domain TEXT PRIMARY KEY,
  registrable_domain TEXT,
  tld TEXT,
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reputation INTEGER NOT NULL DEFAULT 50,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS source_reputation (
  source_id TEXT PRIMARY KEY REFERENCES source_registry(source_id),
  valid_events INTEGER NOT NULL DEFAULT 0,
  dead_links INTEGER NOT NULL DEFAULT 0,
  fake_events INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Dead-letter queue (spec 29)
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  dlq_id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue TEXT NOT NULL,
  payload TEXT NOT NULL,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Schema version for migration checks (CI)
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO schema_version(version) VALUES (1);
