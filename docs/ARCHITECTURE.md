# Architecture — Phase 1 Foundation

## 1. Data flow

```
                     INTERNET
                        │
       ┌────────────────┼─────────────────┐
       │                │                 │
   Websites         Search APIs       Social APIs
       │                │                 │
       └────────────────┼─────────────────┘
                        ↓
               ┌──────────────────┐
               │ Discovery Engine │  SourceConnector[] + registry, rate-limited,
               │ (Phase 2)        │  robots-respecting. Output: DiscoveredItem
               └────────┬─────────┘  (UNTRUSTED).
                        ↓
               ┌──────────────────┐
               │ Event Extraction │  parse() + sanitizeUntrustedText().
               │                  │  WEB CONTENT ≠ INSTRUCTIONS. No hallucination:
               └────────┬─────────┘  missing fields => null/UNKNOWN.
                        ↓
               ┌──────────────────┐
               │ Organizer Finder │  normalizeOrganizerName() entity resolution.
               └────────┬─────────┘
                        ↓
             ┌──────────────────────┐
             │ Official Source      │  official_domain discovery; official page
             │ Resolution           │  must link to registration URL (check 4).
             └──────────┬───────────┘
                        ↓
             ┌──────────────────────┐
             │ Link Verification    │  normalize → resolve (max 5 hops, scheme
             │ + Redirect Analysis  │  guard, timeout) → classify domain →
             │ + Security Checks    │  lookalike → reputation → APPROVE/REVIEW/
             └──────────┬───────────┘  REJECT. Full chain stored in event_links.
                        ↓
             ┌──────────────────────┐
             │ Cross-source         │  consistency engine: dates/organizer/URL
             │ Verification         │  conflicts => NEEDS_REVIEW, never guessed.
             └──────────┬───────────┘
                        ↓
             ┌──────────────────────┐
             │ Deduplication        │  canonical URL > fuzzy title + organizer/
             │ + Classification     │  date evidence. India relevance, categories,
             └──────────┬───────────┘  format, timezone Asia/Kolkata default.
                        ↓
                ┌───────────────┐
                │    DATABASE   │  16 tables, evidence trail per decision.
                └───────┬───────┘  (D1 prod / SQLite dev, one schema.sql)
                        ↓
              ┌──────────────────┐
              │ Notification     │  PHASE 5. publishingGate() + tier router.
              │ Engine           │  Telegram / Discord / (Phase 9) WhatsApp
              └───────┬──────────┘  adapters. Corrections on link change.
                      │
             ┌────────┼─────────┐
             ↓        ↓         ↓
         Telegram   Discord   WhatsApp (official API only)
```

## 2. Source hierarchy (spec §1)

L1 organizer site → L2 official platform page → L3 university/company/gov →
L4 organizer social → L5 trusted platform → L6 community/social → L7 search-only.
Lower level ⇒ stronger verification requirements (higher weights, more evidence).

## 3. Scoring (spec §15)

`verification_score` 0–100 from configurable weights (`src/config.ts`).
Publish threshold 70; review threshold 45. Negative signals (redirect abuse,
unknown domain, conflicts, reputation hits, impersonation) subtract.
`source_trust_score`, `india_relevance_score`, `freshness_score` stored separately (§17).

## 4. Security model

- Every external page is untrusted input (§31): no script execution, no binary
  downloads, no blind redirects, no secret logging.
- Prompt-injection boundary (§32): sanitizer + `containsInjection()` quarantine.
- Malicious-event heuristics (§33) produce SUSPICIOUS/NEEDS_REVIEW, never public
  fraud accusations.
- AI (future) assists extraction/classification only — never final authority on
  link safety or authenticity (§43).

## 5. Free-tier budget (spec §28/70)

Cloudflare Free (approx, subject to change — monitor, don't hard-code):
~100k Worker req/day, 5 crons/account, D1 ~5M rows read / 100k written per day.
Design: 2 cron triggers (30-min discovery fan-out, daily maintenance);
per-source rate limits; queues with backoff + DLQ; degrade gracefully
(slow discovery, prioritize, never silently drop).

## 6. Queues (spec §29)

`discovery → verification → link_check → change_detection → notification`,
plus `dead_letter_queue`. Implemented as D1 tables + Worker cron fan-out in
Phase 6; interfaces stubbed now.

## 7. What Phases 1–2 deliver / defer

Delivers: types, schema, config, logging, errors, URL normalization, lookalike
detection, scoring, link pipeline, event pipeline, dedupe, relevance, sanitizer,
connector interface, SQLite dev mode, fixtures, 16 test suites, CI, Worker stub —
plus robots-aware fetcher, RSS/sitemap parsers, safe HTML/JSON-LD extraction,
query generator, 3 connector classes, 16 validated MVP seeds, runner with
source_runs/DLQ/clustering, seed + discover scripts —
plus live official-context resolution (checks 4–5), resolve→verify→persist
orchestration with evidence/flags/review persistence, verify script, site-name
junk-title guard, dev DB reset —
plus freshness/staleness, field-conflict policy, registration-change detection
with UPDATED transitions, bounded reputation learning wired into discovery +
verification, Telegram/Discord senders, send-time-gated dispatch with
corrections, maintenance + notify scripts —
plus link-health rechecks with host-change withdrawal, deadline/start
reminders, local admin CLI with feedback learning, full run-loop script,
GitHub Actions scheduled workflows —
plus pluggable threat-intel (noop/Safe Browsing/cached) wired into
verification with domain-verdict persistence, confusable-glyph injection
defense, extraction-warning propagation, adversarial suite, secret-scan CI —
plus Store abstraction (SQLite + D1) with parity tests, shared scheduler loop
for Node CLI and Workers, 30 MVP sources, 56-city query coverage —
plus WhatsApp Cloud API adapter (official API only) behind the same
publishing gate, template support, runbook, secret-scan coverage —
plus persisted india/freshness/source-trust signals, no-churn re-verification
of published events, subscription filters on targets, Telegram admin webhook,
scheduler loop tests.
Defers: live Cron + credentials (ops),
Telegram/Discord sending (P5), Safe Browsing key wiring (P7), WhatsApp (P9).
