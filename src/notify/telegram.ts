/**
 * Telegram Bot API sender (Phase 5). Plain-text messages (no parse_mode —
 * avoids markup-injection breakage from event content). Respects 429
 * retry_after, retries with backoff, and NEVER includes the token in errors
 * or logs (spec 31).
 */
export interface SendResult {
  ok: boolean;
  retryable: boolean;
  retryAfterSec: number;
  error: string | null;
}

export interface TelegramOptions {
  botToken: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

function sanitizedError(status: number, body: string): string {
  // Telegram error bodies are short JSON; keep them, they contain no token.
  return `TELEGRAM_HTTP_${status}:${body.slice(0, 200)}`;
}

export async function sendTelegramMessage(
  opts: TelegramOptions,
  chatId: string,
  text: string,
): Promise<SendResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  // Token stays in the URL path only — never in query, body, logs, or errors.
  const endpoint = `https://api.telegram.org/bot${opts.botToken}/sendMessage`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: false }),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true, retryable: false, retryAfterSec: 0, error: null };
    let retryAfterSec = 0;
    let body = "";
    try {
      body = await res.text();
      const parsed = JSON.parse(body) as { parameters?: { retry_after?: number } };
      if (res.status === 429 && parsed.parameters?.retry_after) {
        retryAfterSec = parsed.parameters.retry_after;
      }
    } catch {
      // Non-JSON error body — keep raw slice.
    }
    return {
      ok: false,
      retryable: res.status === 429 || res.status >= 500,
      retryAfterSec,
      error: sanitizedError(res.status, body),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "SEND_FAILED";
    return { ok: false, retryable: true, retryAfterSec: 0, error: /abort/i.test(msg) ? "TIMEOUT" : "NETWORK_ERROR" };
  } finally {
    clearTimeout(t);
  }
}
