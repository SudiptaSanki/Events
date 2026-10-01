/**
 * Telegram admin webhook (spec 35). Handles review commands from authorized
 * admin chats ONLY — any other chat is ignored without a reply (no oracle).
 * Backed by the same admin ops as the local CLI. Auth = admin chat allowlist;
 * an optional webhook secret header is verified by the caller (worker).
 *
 * Supported: /review /approve ID /reject ID /recheck ID /event ID
 *            /feedback ID LABEL /source-status /stats /help
 */
import {
  approveEvent, eventDetail, listReview, recheckEvent, recordFeedback,
  rejectEvent, sourceStatus, stats, type FeedbackLabel,
} from "../admin/ops.js";
import type { Store } from "../db/store.js";

export interface AdminBotOptions {
  adminChatIds: string[];
  now?: () => string;
}

interface TelegramUpdate {
  message?: { chat?: { id?: number | string }; text?: string };
}

function isAuthorized(update: TelegramUpdate, adminChatIds: string[]): string | null {
  const raw = update.message?.chat?.id;
  if (raw === undefined || raw === null) return null;
  const id = String(raw);
  return adminChatIds.includes(id) ? id : null;
}

/**
 * Handle one update. Returns reply text for authorized chats, null otherwise
 * (caller sends nothing on null — unauthorized probing gets no response).
 */
export async function handleAdminUpdate(
  store: Store,
  update: TelegramUpdate,
  opts: AdminBotOptions,
): Promise<string | null> {
  if (!isAuthorized(update, opts.adminChatIds)) return null;
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const text = (update.message?.text ?? "").trim();
  const [cmd, arg1, arg2] = text.split(/\s+/);

  switch (cmd) {
    case "/help":
      return "Commands:\n/review\n/approve EVENT_ID\n/reject EVENT_ID\n/recheck EVENT_ID\n/event EVENT_ID\n/feedback EVENT_ID LABEL\n/source-status\n/stats";
    case "/review": {
      const items = await listReview(store, 10);
      if (items.length === 0) return "Review queue is empty.";
      return items
        .map((r) => `${String(r["review_id"])} ${String(r["event_id"])} [${String(r["score"])}] ${String(r["title"])} — ${String(r["reason"]).slice(0, 80)}`)
        .join("\n");
    }
    case "/approve":
      if (!arg1) return "Usage: /approve EVENT_ID";
      return (await approveEvent(store, arg1, at)) ? `Approved ${arg1}.` : `Nothing to approve for ${arg1}.`;
    case "/reject":
      if (!arg1) return "Usage: /reject EVENT_ID";
      return (await rejectEvent(store, arg1, at)) ? `Rejected ${arg1}.` : `Unknown event ${arg1}.`;
    case "/recheck":
      if (!arg1) return "Usage: /recheck EVENT_ID";
      return (await recheckEvent(store, arg1, at)) ? `${arg1} queued for re-verification.` : `Unknown event ${arg1}.`;
    case "/event": {
      if (!arg1) return "Usage: /event EVENT_ID";
      const d = await eventDetail(store, arg1);
      if (!d) return `Unknown event ${arg1}.`;
      const e = d["event"] as Record<string, unknown>;
      return `${String(e["title"])}\nstatus=${String(e["status"])} score=${String(e["verification_score"])} tier=${String(e["publishing_tier"] ?? "?")}\nreg=${String(e["registration_url"] ?? e["registration_unverified_note"] ?? "none")}`;
    }
    case "/feedback": {
      if (!arg1 || !arg2) return "Usage: /feedback EVENT_ID LABEL";
      const labels = ["FALSE_POSITIVE", "FALSE_LINK", "WRONG_EVENT", "WRONG_DATE", "DUPLICATE", "LEGITIMATE"];
      if (!labels.includes(arg2)) return `LABEL must be one of: ${labels.join(", ")}`;
      return (await recordFeedback(store, arg1, arg2 as FeedbackLabel, at)) ? `Feedback ${arg2} recorded for ${arg1}.` : `Unknown event ${arg1}.`;
    }
    case "/source-status": {
      const rows = await sourceStatus(store);
      return rows.map((r) => `${String(r["source_id"])} trust=${String(r["trust_score"])} ${r["enabled"] ? "on" : "off"} last=${String(r["last_status"] ?? "-")}`).join("\n") || "No sources.";
    }
    case "/stats": {
      const s = await stats(store);
      return `events=${JSON.stringify(s["byStatus"])} tiers=${JSON.stringify(s["byTier"])} reviewOpen=${String(s["reviewOpen"])} dlq=${String(s["dlq"])} sent=${String(s["sent"])}`;
    }
    default:
      return "Unknown command. Send /help.";
  }
}
