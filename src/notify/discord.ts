/**
 * Discord webhook sender (Phase 5). Embeds + link buttons via message
 * components. Registration buttons point ONLY to verified URLs — the caller
 * (dispatch) guarantees this via the publishing gate.
 */
import type { FormattedAlert } from "./templates.js";
import type { SendResult } from "./telegram.js";

export interface DiscordOptions {
  webhookUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export function buildDiscordPayload(alert: FormattedAlert): Record<string, unknown> {
  const components: unknown[] = [];
  if (alert.discordEmbed.buttons.length > 0) {
    components.push({
      type: 1, // ACTION_ROW
      components: alert.discordEmbed.buttons.slice(0, 5).map((b) => ({
        type: 2, // LINK button
        style: 5,
        label: b.label.slice(0, 80),
        url: b.url,
      })),
    });
  }
  return {
    content: alert.text.slice(0, 1500),
    embeds: [
      {
        title: alert.discordEmbed.title.slice(0, 256),
        description: alert.discordEmbed.description.slice(0, 2000),
        fields: alert.discordEmbed.fields.map((f) => ({
          name: f.name.slice(0, 256),
          value: (f.value || "—").slice(0, 1024),
          inline: f.inline,
        })),
      },
    ],
    components,
  };
}

export async function sendDiscordWebhook(
  opts: DiscordOptions,
  alert: FormattedAlert,
): Promise<SendResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(opts.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildDiscordPayload(alert)),
      signal: ctrl.signal,
    });
    if (res.ok || res.status === 204) return { ok: true, retryable: false, retryAfterSec: 0, error: null };
    let retryAfterSec = 0;
    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      try {
        const parsed = JSON.parse(body) as { retry_after?: number };
        retryAfterSec = Math.ceil(parsed.retry_after ?? 5);
      } catch {
        retryAfterSec = 5;
      }
    }
    return {
      ok: false,
      retryable: res.status === 429 || res.status >= 500,
      retryAfterSec,
      error: `DISCORD_HTTP_${res.status}:${body.slice(0, 200)}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "SEND_FAILED";
    return { ok: false, retryable: true, retryAfterSec: 0, error: /abort/i.test(msg) ? "TIMEOUT" : "NETWORK_ERROR" };
  } finally {
    clearTimeout(t);
  }
}
