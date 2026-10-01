/**
 * Full automation loop CLI (Phase 6/8). Thin wrapper over runLoopStages.
 * Usage: npm run loop -- [--live] [--verify-limit N] [--link-limit N]
 * Default is DRY_RUN (discovers, resolves, previews; writes nothing).
 */
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { runLoopStages } from "../src/scheduler/loop.js";
import { MVP_SOURCES, buildConnector } from "../src/sources/seeds.js";
import { providerFromEnv } from "../src/security/threatIntel.js";
import { loadTargets } from "../src/notify/dispatch.js";
import type { ChannelTarget } from "../src/notify/dispatch.js";

const args = process.argv.slice(2);
const live = args.includes("--live");
const dryRun = !live;
const idx = (flag: string, fallback: number): number => {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const db = openDatabase();
migrate(db);
const store = createSqliteStore(db);

const targets = await loadTargets(store);

try {
  const report = await runLoopStages(store, {
    connectors: MVP_SOURCES.filter((s) => s.enabled).map((s) => buildConnector(s)),
    targets,
    verifyLimit: idx("--verify-limit", 10),
    linkLimit: idx("--link-limit", 50),
    dryRun,
    threatIntel: providerFromEnv(),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? null,
    whatsapp: process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
      ? {
        token: process.env.WHATSAPP_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        templateName: process.env.WHATSAPP_TEMPLATE_NAME || undefined,
      }
      : null,
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
