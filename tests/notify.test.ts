import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { sendTelegramMessage } from "../src/notify/telegram.js";
import { buildDiscordPayload, sendDiscordWebhook } from "../src/notify/discord.js";
import { dispatchPending, loadTargets, queueEligibleAlerts } from "../src/notify/dispatch.js";
import { formatCorrection, formatEventAlert, verificationLabelFor } from "../src/notify/templates.js";

const NOW = "2026-09-30T12:00:00.000Z";

function seedEvent(db: ReturnType<typeof openDatabase>, overrides: Record<string, unknown> = {}): string {
  const id = `evt-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO events(event_id,title,normalized_title,organizer_name,categories,format,event_url,
      registration_url,registration_unverified_note,start_date,status,verification_decision,
      verification_score,publishing_tier,first_seen,last_seen)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, "Test Hack", "test hack", "Test Org", JSON.stringify(["Hackathon"]), "ONLINE",
    "https://example.edu.in/hack", "https://register.example.edu.in/f",
    null, "2026-12-01T00:00:00.000Z",
    "VERIFIED", "VERIFIED_OFFICIAL", 85, "A", NOW, NOW,
  );
  for (const [k, v] of Object.entries(overrides)) {
    db.prepare(`UPDATE events SET ${k} = ? WHERE event_id = ?`).run(v as never, id);
  }
  return id;
}

function seedTarget(db: ReturnType<typeof openDatabase>, channel: "TELEGRAM" | "DISCORD", dest: string): void {
  db.prepare("INSERT OR IGNORE INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)").run(
    `${channel.toLowerCase()}:t`, channel, dest,
  );
}

describe("senders (Phase 5)", () => {
  it("telegram posts to Bot API and honors 429 retry_after without leaking the token", async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      seen.push(String(url instanceof Request ? url.url : url));
      return new Response(JSON.stringify({ ok: false, parameters: { retry_after: 7 } }), { status: 429 });
    }) as unknown as typeof fetch;
    const r = await sendTelegramMessage({ botToken: "SECRET123", fetchFn }, "42", "hello");
    assert.equal(r.ok, false);
    assert.equal(r.retryable, true);
    assert.equal(r.retryAfterSec, 7);
    assert.ok(!JSON.stringify(r).includes("SECRET123"), "token must never appear in results/errors");
    assert.ok(seen[0]!.includes("/botSECRET123/sendMessage")); // token only in request path
  });
  it("discord builds embeds with link buttons only from verified URLs", async () => {
    const alert = formatEventAlert(
      {
        title: "T", organizer_name: "O", format: "ONLINE", city: null, start_date: null,
        registration_deadline: null, eligibility: null, team_size: null, prize: null,
        description: null, event_url: "https://example.edu.in/h", registration_url: "https://register.example.edu.in/f",
      } as never,
      verificationLabelFor("VERIFIED_OFFICIAL"),
    );
    const payload = buildDiscordPayload(alert) as { components: Array<{ components: Array<{ url: string }> }> };
    assert.equal(payload.components[0]!.components[1]!.url, "https://register.example.edu.in/f");
    let posted: unknown = null;
    const fetchFn = (async (_u: unknown, init?: { body?: string }) => {
      posted = JSON.parse(init?.body ?? "{}");
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendDiscordWebhook({ webhookUrl: "https://discord.example/hook", fetchFn }, alert);
    assert.equal(r.ok, true);
    assert.ok(posted);
  });
  it("corrections use evidence-gated language, never absolute claims", () => {
    const c = formatCorrection("X Hack", "The registration link changed.", "https://example.edu.in/x");
    assert.ok(c.text.startsWith("⚠️ EVENT UPDATE"));
    assert.ok(!/100% safe|guaranteed/i.test(c.text));
  });
});

describe("dispatch gating (spec 65/66)", () => {
  it("queues + sends Tier A VERIFIED, suppresses Tier D at send time", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const good = seedEvent(db);
    const bad = seedEvent(db, { publishing_tier: "D", status: "NEEDS_REVIEW", verification_decision: "UNVERIFIED" });
    // Manually queue a Tier-D row to prove send-time suppression.
    seedTarget(db, "TELEGRAM", "42");
    db.prepare("INSERT INTO notifications(event_id,target_id,template,status,created_at) VALUES (?,?,?, 'QUEUED', ?)").run(
      bad, "telegram:t", "ALERT", NOW,
    );
    const targets = [{ targetId: "telegram:t", channel: "TELEGRAM" as const, destination: "42" }];
    assert.equal(await queueEligibleAlerts(store, targets, NOW), 1); // only the Tier A event
    const sent: string[] = [];
    const fetchFn = (async () => {
      sent.push("telegram");
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    const summary = await dispatchPending(store, targets, { telegramBotToken: "T", fetchFn, now: () => NOW });
    assert.equal(summary.sent, 1);
    assert.equal(summary.suppressed, 1);
    const statuses = db.prepare("SELECT status FROM notifications ORDER BY notification_id").all() as Array<{ status: string }>;
    assert.deepEqual(statuses.map((s) => s.status), ["SUPPRESSED", "SENT"]); // bad row was queued first
    assert.deepEqual(sent, ["telegram"]); // Tier D never hit the network
    db.close();
  });
  it("UPDATED events queue corrections, never duplicate alerts", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const id = seedEvent(db);
    seedTarget(db, "TELEGRAM", "42");
    const targets = [{ targetId: "telegram:t", channel: "TELEGRAM" as const, destination: "42" }];
    await queueEligibleAlerts(store, targets, NOW);
    db.prepare("UPDATE notifications SET status='SENT', sent_at=? WHERE event_id=?").run(NOW, id);
    assert.equal(await queueEligibleAlerts(store, targets, NOW), 0); // no duplicate alert
    db.prepare("UPDATE events SET status='UPDATED' WHERE event_id=?").run(id);
    assert.equal(await queueEligibleAlerts(store, targets, NOW), 1); // correction queued
    const tpl = db.prepare("SELECT template FROM notifications ORDER BY notification_id DESC LIMIT 1").get() as { template: string };
    assert.equal(tpl.template, "CORRECTION");
    db.close();
  });
  it("subscription filters route only matching events (invalid filters fail open)", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    const insert = (id: string, cats: string[], city: string | null): void => {
      db.prepare(
        `INSERT INTO events(event_id,title,normalized_title,organizer_name,categories,city,format,event_url,
          registration_url,start_date,status,verification_decision,verification_score,publishing_tier,first_seen,last_seen)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id, id, id, "Org", JSON.stringify(cats), city, "ONLINE",
        "https://example.edu.in/h", "https://register.example.edu.in/f", "2026-12-01T00:00:00.000Z",
        "VERIFIED", "VERIFIED_OFFICIAL", 85, "A", NOW, NOW,
      );
    };
    insert("hack-pune", ["Hackathon"], "Pune");
    insert("design-mum", ["Design"], "Mumbai");
    db.prepare("INSERT INTO notification_targets(target_id,channel,destination,enabled,filter) VALUES (?,?,?,1,?)").run(
      "t:hack", "TELEGRAM", "1", JSON.stringify({ categories: ["Hackathon"] }),
    );
    db.prepare("INSERT INTO notification_targets(target_id,channel,destination,enabled,filter) VALUES (?,?,?,1,?)").run(
      "t:mum", "TELEGRAM", "2", JSON.stringify({ cities: ["Mumbai"] }),
    );
    db.prepare("INSERT INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)").run(
      "t:all", "TELEGRAM", "3",
    );
    db.prepare("INSERT INTO notification_targets(target_id,channel,destination,enabled,filter) VALUES (?,?,?,1,?)").run(
      "t:bogus", "TELEGRAM", "4", "{not-json",
    );
    const targets = await loadTargets(store);
    assert.equal(targets.length, 4);
    // hack-pune -> t:hack, t:all, t:bogus (3); design-mum -> t:mum, t:all, t:bogus (3).
    assert.equal(await queueEligibleAlerts(store, targets, NOW), 6);
    const got = (await store.query<{ event_id: string; target_id: string }>(
      "SELECT event_id, target_id FROM notifications ORDER BY event_id, target_id",
    )).map((r) => `${r.event_id}:${r.target_id}`);
    assert.deepEqual(got, [
      "design-mum:t:all", "design-mum:t:bogus", "design-mum:t:mum",
      "hack-pune:t:all", "hack-pune:t:bogus", "hack-pune:t:hack",
    ]);
    db.close();
  });
});
