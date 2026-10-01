/**
 * WhatsApp Cloud API sender (Phase 9, spec 68). Independent adapter:
 * - official API only (graph.facebook.com), no unofficial bypasses,
 * - token travels in the Authorization header only — never in URLs, bodies,
 *   errors, or logs,
 * - text messages by default; pre-approved template when WHATSAPP_TEMPLATE_NAME
 *   is set (Meta requires templates for business-initiated messages outside
 *   the 24h customer-service window — see README runbook),
 * - the core discovery/verification engine never depends on this module.
 */
import type { FormattedAlert } from "./templates.js";
import type { SendResult } from "./telegram.js";

export interface WhatsAppOptions {
  token: string;
  phoneNumberId: string;
  templateName?: string;
  templateLanguage?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const API_VERSION = "v22.0";
const MAX_TEXT = 4000;

export function buildWhatsAppPayload(
  to: string,
  alert: FormattedAlert,
  opts: Pick<WhatsAppOptions, "templateName" | "templateLanguage">,
): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (opts.templateName) {
    // Template body parameters: title, verification line, event page URL.
    // Keep to 3 short text params — templates must be pre-approved with
    // matching placeholders ({{1}}, {{2}}, {{3}}).
    const buttons = alert.discordEmbed.buttons;
    return {
      ...base,
      type: "template",
      template: {
        name: opts.templateName,
        language: { code: opts.templateLanguage ?? "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: alert.discordEmbed.title.slice(0, 200) },
              { type: "text", text: buttons.map((b) => `${b.label}: ${b.url}`).join("\n").slice(0, 500) || "See official event page" },
              { type: "text", text: "Reply STOP to unsubscribe" },
            ],
          },
        ],
      },
    };
  }
  return {
    ...base,
    type: "text",
    text: { preview_url: true, body: alert.text.slice(0, MAX_TEXT) },
  };
}

export async function sendWhatsAppMessage(
  opts: WhatsAppOptions,
  to: string,
  alert: FormattedAlert,
): Promise<SendResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const endpoint = `https://graph.facebook.com/${API_VERSION}/${opts.phoneNumberId}/messages`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildWhatsAppPayload(to, alert, opts)),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true, retryable: false, retryAfterSec: 0, error: null };
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      retryable: res.status === 429 || res.status >= 500,
      retryAfterSec: res.status === 429 ? 30 : 0,
      error: `WHATSAPP_HTTP_${res.status}:${body.slice(0, 200)}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "SEND_FAILED";
    return { ok: false, retryable: true, retryAfterSec: 0, error: /abort/i.test(msg) ? "TIMEOUT" : "NETWORK_ERROR" };
  } finally {
    clearTimeout(t);
  }
}
