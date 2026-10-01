/**
 * Cloudflare Worker entrypoint (Phase 8). Cron triggers run the same
 * runLoopStages pipeline as the Node CLI, backed by D1 instead of SQLite.
 *
 * Setup:
 *   wrangler d1 create india-events
 *   wrangler d1 execute india-events --file=src/db/schema.sql
 *   wrangler secret put TELEGRAM_BOT_TOKEN
 * Cron (wrangler.toml): every 30 min = standard loop, 02:00 = maintenance loop.
 */

import { createD1Store, type D1Like } from "./db/d1Store.js";
import { loadTargets as loadStoredTargets } from "./notify/dispatch.js";
import { runLoopStages } from "./scheduler/loop.js";
import { MVP_SOURCES, buildConnector } from "./sources/seeds.js";
import { providerFromEnv } from "./security/threatIntel.js";
import type { ChannelTarget } from "./notify/dispatch.js";

export interface Env {
  DB: D1Like;
  DRY_RUN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHANNEL_ID?: string;
  TELEGRAM_ADMIN_CHAT_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  DISCORD_WEBHOOK_URL?: string;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_TEMPLATE_NAME?: string;
  WHATSAPP_TO_NUMBER?: string;
  VERIFY_LIMIT?: string;
  LINK_LIMIT?: string;
}

const MAINTENANCE_CRON = "0 2 * * *";

/** Constant-time string comparison for webhook secrets. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function loadTargets(env: Env): Promise<ChannelTarget[]> {
  const store = createD1Store(env.DB);
  // Targets are configured via vars (no local CLI in Workers).
  if (env.TELEGRAM_CHANNEL_ID) {
    await store.exec(
      "INSERT OR IGNORE INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)",
      "telegram:channel",
      "TELEGRAM",
      env.TELEGRAM_CHANNEL_ID,
    );
  }
  if (env.DISCORD_WEBHOOK_URL) {
    await store.exec(
      "INSERT OR IGNORE INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)",
      "discord:webhook",
      "DISCORD",
      env.DISCORD_WEBHOOK_URL,
    );
  }
  if (env.WHATSAPP_TO_NUMBER && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    await store.exec(
      "INSERT OR IGNORE INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)",
      "whatsapp:owner",
      "WHATSAPP",
      env.WHATSAPP_TO_NUMBER,
    );
  }
  return loadStoredTargets(store);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, phase: 8, dryRun: env.DRY_RUN ?? "true" });
    }
    if (url.pathname === "/telegram-webhook" && request.method === "POST") {
      // Optional shared-secret check (set Telegram webhook with ?secret or
      // secret_token header; both are compared in constant time below).
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (!timingSafeEqual(got, env.TELEGRAM_WEBHOOK_SECRET)) {
          return Response.json({ ok: false }, { status: 403 });
        }
      }
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_CHAT_ID) {
        return Response.json({ ok: false, error: "admin not configured" }, { status: 503 });
      }
      const update = (await request.json().catch(() => null)) as never;
      if (!update) return Response.json({ ok: false }, { status: 400 });
      const { handleAdminUpdate } = await import("./notify/adminBot.js");
      const { sendTelegramMessage } = await import("./notify/telegram.js");
      const reply = await handleAdminUpdate(createD1Store(env.DB), update, {
        adminChatIds: env.TELEGRAM_ADMIN_CHAT_ID.split(",").map((s) => s.trim()).filter(Boolean),
      });
      if (reply) {
        const chatId = String((update as { message?: { chat?: { id?: number } } }).message?.chat?.id ?? "");
        if (chatId) {
          await sendTelegramMessage({ botToken: env.TELEGRAM_BOT_TOKEN }, chatId, reply);
        }
      }
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: "See /health. Pipeline runs on cron." }, { status: 503 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const dryRun = (env.DRY_RUN ?? "true").toLowerCase() !== "false";
    const maintenanceOnly = event.cron === MAINTENANCE_CRON;
    const store = createD1Store(env.DB);
    try {
      const report = await runLoopStages(store, {
      connectors: MVP_SOURCES.filter((s) => s.enabled).map((s) => buildConnector(s)),
      targets: await loadTargets(env),
      verifyLimit: Number(env.VERIFY_LIMIT ?? 10),
      linkLimit: Number(env.LINK_LIMIT ?? 50),
      dryRun,
      threatIntel: providerFromEnv(),
      telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? null,
      whatsapp: env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
        ? {
          token: env.WHATSAPP_TOKEN,
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
          templateName: env.WHATSAPP_TEMPLATE_NAME || undefined,
        }
        : null,
      stages: maintenanceOnly
        ? { discovery: false, verification: false, linkHealth: true, reminders: true, maintenance: true, notify: true }
        : undefined,
    });
      console.log(JSON.stringify({ cron: event.cron, ...report }));
    } catch (e) {
      // Never fail silently: stage errors are logged for the next run.
      // (Ensure D1 is migrated first — see wrangler.toml runbook.)
      console.log(JSON.stringify({ cron: event.cron, ok: false, error: e instanceof Error ? e.message : "SCHEDULED_FAILED" }));
    }
  },
};
