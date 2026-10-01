/**
 * Notify runner (Phase 5): ensure targets from env, queue eligible alerts,
 * dispatch the queue. DRY_RUN=true (default) prints instead of sending.
 *
 * Env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHANNEL_ID (chat id), DISCORD_WEBHOOK_URL.
 */
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { dispatchPending, loadTargets, queueEligibleAlerts, type ChannelTarget, type WhatsAppConfig } from "../src/notify/dispatch.js";

function whatsAppConfig(): WhatsAppConfig | null {
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      templateName: process.env.WHATSAPP_TEMPLATE_NAME || undefined,
    };
  }
  return null;
}

const dryRun = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const now = new Date().toISOString();
const db = openDatabase();
migrate(db);
const store = createSqliteStore(db);

const targets: ChannelTarget[] = [];
const tgChat = process.env.TELEGRAM_CHANNEL_ID;
if (tgChat) {
  await store.exec("INSERT OR IGNORE INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)",
    "telegram:channel", "TELEGRAM", tgChat,
  );
}
const discordHook = process.env.DISCORD_WEBHOOK_URL;
if (discordHook) {
  await store.exec("INSERT OR IGNORE INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)",
    "discord:webhook", "DISCORD", discordHook,
  );
}
const waTo = process.env.WHATSAPP_TO_NUMBER;
if (waTo && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
  await store.exec("INSERT OR IGNORE INTO notification_targets(target_id,channel,destination,enabled) VALUES (?,?,?,1)",
    "whatsapp:owner", "WHATSAPP", waTo,
  );
}
const rows = await loadTargets(store);
targets.push(...rows);

if (targets.length === 0) {
  console.log(JSON.stringify({ dryRun, ok: true, note: "no notification targets configured", queued: 0 }));
  db.close();
  process.exit(0);
}

if (dryRun) {
  // Preview inside a rolled-back transaction: queue + dispatch logic run for
  // real, but nothing is written and nothing is sent. The store shares the
  // underlying connection, so raw BEGIN/ROLLBACK applies to store writes.
  db.exec("BEGIN");
  try {
    await queueEligibleAlerts(store, targets, now);
    const preview = await dispatchPending(store, targets, {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? null,
      whatsapp: whatsAppConfig(),
      dryRun: true,
      now: () => now,
    });
    console.log(JSON.stringify({ dryRun, ok: true, ...preview }, null, 2));
  } finally {
    db.exec("ROLLBACK");
  }
  db.close();
  process.exit(0);
}

await queueEligibleAlerts(store, targets, now);
const summary = await dispatchPending(store, targets, {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? null,
  whatsapp: whatsAppConfig(),
  dryRun,
  now: () => now,
});
console.log(JSON.stringify({ dryRun, ok: true, ...summary }, null, 2));
db.close();
