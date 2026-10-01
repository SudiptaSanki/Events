import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { buildWhatsAppPayload, sendWhatsAppMessage } from "../src/notify/whatsapp.js";
import { dispatchPending } from "../src/notify/dispatch.js";
import { formatEventAlert, verificationLabelFor } from "../src/notify/templates.js";

const NOW = "2026-10-01T12:00:00.000Z";

function demoAlert(): ReturnType<typeof formatEventAlert> {
  return formatEventAlert(
    {
      title: "Demo Hack", organizer_name: "Demo Org", format: "ONLINE", city: null,
      start_date: "2026-12-01T00:00:00.000Z", registration_deadline: null,
      eligibility: null, team_size: null, prize: null, description: null,
      event_url: "https://demo.example/hack", registration_url: "https://reg.demo.example/f",
    } as never,
    verificationLabelFor("VERIFIED_OFFICIAL"),
  );
}

describe("whatsapp adapter (Phase 9, official API only)", () => {
  it("builds text payloads with preview links, truncated to limits", () => {
    const p = buildWhatsAppPayload("919999999999", demoAlert(), {}) as {
      messaging_product: string; to: string; type: string; text: { preview_url: boolean; body: string };
    };
    assert.equal(p.messaging_product, "whatsapp");
    assert.equal(p.to, "919999999999");
    assert.equal(p.type, "text");
    assert.equal(p.text.preview_url, true);
    assert.ok(p.text.body.includes("Demo Hack"));
  });
  it("builds template payloads when a pre-approved template is configured", () => {
    const p = buildWhatsAppPayload("919999999999", demoAlert(), { templateName: "event_alert" }) as {
      type: string; template: { name: string; components: Array<{ parameters: unknown[] }> };
    };
    assert.equal(p.type, "template");
    assert.equal(p.template.name, "event_alert");
    assert.equal(p.template.components[0]!.parameters.length, 3);
  });
  it("posts to graph.facebook.com with Bearer auth; token never leaks into results", async () => {
    const seen: Array<{ url: string; auth: string }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: { headers?: Record<string, string> }) => {
      const u = String(url instanceof Request ? url.url : url);
      seen.push({ url: u, auth: init?.headers?.["Authorization"] ?? "" });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendWhatsAppMessage(
      { token: "SECRET_WA", phoneNumberId: "123", fetchFn }, "919999999999", demoAlert(),
    );
    assert.equal(r.ok, true);
    assert.ok(seen[0]!.url.includes("graph.facebook.com/v22.0/123/messages"));
    assert.equal(seen[0]!.auth, "Bearer SECRET_WA");
    assert.ok(!JSON.stringify(r).includes("SECRET_WA"));
  });
  it("429 is retryable, 400 is terminal and sanitized", async () => {
    const fail = (status: number, body: string): typeof fetch =>
      (async () => new Response(body, { status })) as unknown as typeof fetch;
    const limited = await sendWhatsAppMessage(
      { token: "T", phoneNumberId: "1", fetchFn: fail(429, '{"error":{"message":"slow"}}') }, "9", demoAlert(),
    );
    assert.equal(limited.retryable, true);
    const bad = await sendWhatsAppMessage(
      { token: "T", phoneNumberId: "1", fetchFn: fail(400, '{"error":{"message":"bad param"}}') }, "9", demoAlert(),
    );
    assert.equal(bad.ok, false);
    assert.equal(bad.retryable, false);
    assert.ok(bad.error!.startsWith("WHATSAPP_HTTP_400"));
  });
});

describe("whatsapp dispatch (spec 65/66/68)", () => {
  it("sends queued alerts to WHATSAPP targets behind the gate", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    db.prepare(
      `INSERT INTO events(event_id,title,normalized_title,organizer_name,categories,format,event_url,
        registration_url,start_date,status,verification_decision,verification_score,publishing_tier,first_seen,last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "wa1", "WA Hack", "wa hack", "WA Org", JSON.stringify(["Hackathon"]), "ONLINE",
      "https://wa.example/h", "https://reg.wa.example/f", "2026-12-01T00:00:00.000Z",
      "VERIFIED", "VERIFIED_OFFICIAL", 85, "A", NOW, NOW,
    );
    db.prepare("INSERT INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)").run(
      "whatsapp:owner", "WHATSAPP", "919999999999",
    );
    db.prepare("INSERT INTO notifications(event_id,target_id,template,status,created_at) VALUES (?,?,?, 'QUEUED', ?)").run(
      "wa1", "whatsapp:owner", "ALERT", NOW,
    );
    const targets = [{ targetId: "whatsapp:owner", channel: "WHATSAPP" as const, destination: "919999999999" }];
    const calls: string[] = [];
    const fetchFn = (async () => {
      calls.push("graph");
      return new Response(JSON.stringify({ messages: [{ id: "wamid.2" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const summary = await dispatchPending(store, targets, {
      telegramBotToken: null,
      whatsapp: { token: "T", phoneNumberId: "PNID" },
      fetchFn,
      now: () => NOW,
    });
    assert.equal(summary.sent, 1);
    assert.deepEqual(calls, ["graph"]);
    const status = db.prepare("SELECT status FROM notifications").get() as { status: string };
    assert.equal(status.status, "SENT");
    db.close();
  });
  it("missing whatsapp config fails closed without network", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createSqliteStore(db);
    db.prepare(
      `INSERT INTO events(event_id,title,normalized_title,organizer_name,categories,format,event_url,
        registration_url,start_date,status,verification_decision,verification_score,publishing_tier,first_seen,last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "wa2", "WA Hack", "wa hack", "WA Org", JSON.stringify(["Hackathon"]), "ONLINE",
      "https://wa.example/h", "https://reg.wa.example/f", "2026-12-01T00:00:00.000Z",
      "VERIFIED", "VERIFIED_OFFICIAL", 85, "A", NOW, NOW,
    );
    db.prepare("INSERT INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)").run(
      "whatsapp:owner", "WHATSAPP", "919999999999",
    );
    db.prepare("INSERT INTO notifications(event_id,target_id,template,status,created_at) VALUES (?,?,?, 'QUEUED', ?)").run(
      "wa2", "whatsapp:owner", "ALERT", NOW,
    );
    const targets = [{ targetId: "whatsapp:owner", channel: "WHATSAPP" as const, destination: "919999999999" }];
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const summary = await dispatchPending(store, targets, { telegramBotToken: null, fetchFn, now: () => NOW });
    assert.equal(summary.failed, 1);
    assert.equal(calls, 0); // never touches the network unconfigured
    const row = db.prepare("SELECT status, error FROM notifications").get() as { status: string; error: string };
    assert.equal(row.status, "FAILED");
    assert.equal(row.error, "WHATSAPP_NOT_CONFIGURED");
    db.close();
  });
});
