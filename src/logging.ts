/** Minimal structured logger. No secrets may be logged (spec 31). */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const CURRENT: LogLevel = ((process.env.LOG_LEVEL as LogLevel) ?? "info") as LogLevel;

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[CURRENT]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ?? {}),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

/** Redact common secret patterns before logging untrusted content. */
export function redactSecrets(input: string): string {
  return input
    .replace(/(bot\d+:[\w-]{20,})/gi, "[REDACTED_TELEGRAM_TOKEN]")
    .replace(/(xox[bap]-[\w-]+)/gi, "[REDACTED_SLACK_TOKEN]")
    .replace(/(gh[pousr]_[\w]+)/gi, "[REDACTED_GITHUB_TOKEN]")
    .replace(/(api[_-]?key\s*[:=]\s*)(['"]?)[\w-]{8,}\2/gi, "$1[REDACTED]");
}
