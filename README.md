# India Hackathon & Tech Event Intelligence System

Verification-first event discovery and alert platform. **Trustworthy delivery, not event count.**

> Phase 2 (Discovery) is implemented. Notifications (Telegram/Discord), scheduling,
> and WhatsApp are intentionally **not live yet** — spec §76 requires verification
> before notifications.

## Quickstart (local SQLite dev mode)

```bash
npm install
npm run db:migrate     # creates ./data/events.sqlite3 from src/db/schema.sql
npm test               # build + node --test (all suites)
npm run dry-run        # DRY_RUN: verify fixtures without sending anything
```

No secrets required for Phase 1.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full data-flow diagram,
source hierarchy (L1–L7), verification pipeline, and free-tier budget.

```
INTERNET → Discovery → Extraction → Organizer Finder → Official-Source
Resolution → Link Verification (+redirects/security) → Cross-source
check → Dedupe + Classification → DATABASE → (Phase 5) Notify
→ Monitor → Reverify
```

## Golden rules enforced in code

- Discovery sources are **never** proof (§1): `src/sources/types.ts` marks every
  item untrusted; `src/verification/pipeline.ts` requires official-source signals.
- Unverified registration URLs are **never** labeled official (§2): `verifyLink()`
  returns APPROVE/REVIEW/REJECT; templates fall back to
  “Registration link could not be independently verified.”
- No absolute-authenticity claims (§3): decisions are only
  `VERIFIED_OFFICIAL / VERIFIED_BY_MULTIPLE_SOURCES / LIKELY_LEGITIMATE /
  UNVERIFIED / SUSPICIOUS / REJECTED`, each with `verification_evidence` rows.
- Web content is **data, never instructions** (§32): `src/extract/sanitize.ts`
  quarantines prompt-injection patterns; tests prove it.
- Nothing is published unless `publishingGate()` passes (§65) and score ≥ 70 (§15).

## Project layout

| Path | Purpose |
|---|---|
| `src/types.ts` | Event, Organizer, links, evidence, enums |
| `src/config.ts` | Weights, thresholds, allowlists (configurable) |
| `src/normalize/url.ts` | URL normalization, short-URL detection |
| `src/normalize/dedup.ts` | Title/organizer/city normalization, dedupe |
| `src/security/domains.ts` | Lookalike detection, provider classification |
| `src/verification/scoring.ts` | Score 0–100, tiers A–E, publishing gate |
| `src/verification/linkVerification.ts` | Redirect + domain + security pipeline |
| `src/verification/pipeline.ts` | Event verification orchestration + evidence |
| `src/extract/sanitize.ts` | Prompt-injection defense |
| `src/india/relevance.ts` | India relevance score |
| `src/sources/types.ts` | `SourceConnector` interface + registry |
| `src/db/schema.sql` | D1/SQLite schema (16 tables, v1) |
| `src/db/sqlite.ts` | Local dev DB (Node built-in sqlite) |
| `src/discovery/robots.ts` | robots.txt parsing + cache (fail-closed) |
| `src/discovery/fetcher.ts` | Polite HTTP choke point (timeout, size cap, UA) |
| `src/discovery/rss.ts` | RSS/Atom parser (no entity expansion) |
| `src/discovery/sitemap.ts` | Sitemap index/urlset parser + event-URL filter |
| `src/discovery/queries.ts` | Search query generator (topics × cities) |
| `src/discovery/runner.ts` | Rate-limited runs, source_runs, DLQ, clustering |
| `src/extract/html.ts` | Safe HTML extraction (JSON-LD first, scripts stripped) |
| `src/sources/rssSource.ts` | Generic RSS connector |
| `src/sources/sitemapSource.ts` | Generic sitemap connector (robots Sitemaps:) |
| `src/sources/searchApiSource.ts` | Search-API connector (disabled until configured) |
| `src/sources/seeds.ts` | 16 MVP seeds + validation + connector factory |
| `src/db/events.ts` | Discovered-event persistence + provenance attach |
| `src/verification/resolve.ts` | Official-context resolution (checks 4–5, first-party honesty) |
| `src/verification/verifyDiscovered.ts` | Resolve → verify → persist orchestration |
| `src/quality/freshness.ts` | Freshness score + stale detection |
| `src/quality/changes.ts` | Field diffs + conflict policy (newest-official-wins) |
| `src/quality/reputation.ts` | Bounded source-reputation learning |
| `src/notify/telegram.ts` | Telegram Bot API sender (429-aware, token-safe) |
| `src/notify/discord.ts` | Discord webhook sender (embeds + link buttons) |
| `src/notify/dispatch.ts` | Queue + send-time-gated dispatch, corrections |
| `src/notify/reminders.ts` | Deadline/start reminder queueing |
| `src/notify/whatsapp.ts` | WhatsApp Cloud API adapter (official API only) |
| `src/notify/adminBot.ts` | Telegram admin commands (allowlisted chats only) |
| `src/quality/linkHealth.ts` | Published-link rechecks, host-change response |
| `src/security/threatIntel.ts` | Pluggable threat-intel (noop/Safe Browsing/cached) |
| `src/db/store.ts` | Store interface (SQLite ↔ D1) |
| `src/db/sqliteStore.ts` | SQLite Store implementation + memory helper |
| `src/db/d1Store.ts` | Cloudflare D1 Store implementation |
| `src/scheduler/loop.ts` | Shared automation loop (Node CLI + Worker) |
| `src/admin/ops.ts` | Review/approve/reject/recheck/feedback/stats operations |
| `src/notify/templates.ts` | Alert + correction formatters (all channels) |
| `src/worker.ts` | Cloudflare Worker + Cron (D1-backed loop) |
| `tests/` | Fixtures (legit/malicious/edge/adversarial) + suites |
| `scripts/seedSources.ts`, `scripts/discover.ts`, `scripts/verify.ts` | Registry seeding, discovery, verification runs |
| `scripts/maintenance.ts`, `scripts/notify.ts` | Expiry + quality metrics; alert queue + dispatch |
| `scripts/runLoop.ts`, `scripts/admin.ts` | Full automation loop; local admin CLI |

## Required secrets (later phases)

| Secret | Phase | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` | 5 | Telegram alerts |
| `DISCORD_WEBHOOK_URL` | 5 | Discord embeds |
| `GOOGLE_SAFE_BROWSING_API_KEY` | 7 | Threat-intel (optional) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TO_NUMBER` | 9 | WhatsApp Cloud API alerts |
| `WHATSAPP_TEMPLATE_NAME` | 9 | Optional pre-approved template (recommended for production) |

## WhatsApp setup runbook (official Cloud API)

1. Create a Meta App with the WhatsApp product; complete business verification.
2. Add a recipient phone number and have it opt in (production messaging
   requires opt-in; test numbers work in sandbox).
3. From the App dashboard copy the **Phone number ID** and generate a
   permanent **access token** (never commit it — `.dev.vars` / CI secrets only).
4. Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TO_NUMBER`.
   MVP sends owner alerts to one recipient; multi-subscriber support is future.
5. Recommended: create and get approval for a `WHATSAPP_TEMPLATE_NAME`
   template with 3 text placeholders (title, links, opt-out), because Meta
   requires templates for business-initiated messages outside the 24-hour
   customer-service window. Without it, the adapter sends plain text, which
   Meta may reject outside that window — failures surface as FAILED rows,
   never silent drops.
6. Verify with `npm run notify` (dry-run default; nothing sends).

## Next phase

**Go-live:** provision channel credentials, flip `DRY_RUN=false` / `LOOP_LIVE=true`,
migrate D1 (`wrangler d1 execute --file=src/db/schema.sql`), tighten crons
after usage sizing. The pipeline is feature-complete per spec phases 1–9.
