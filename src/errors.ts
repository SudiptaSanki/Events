/** Typed errors so failures are graceful and routable to retry/DLQ (spec 29). */

export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = retryable;
  }
}

export const Errors = {
  fetchFailed: (msg: string) => new AppError("FETCH_FAILED", msg, true),
  rateLimited: (msg: string) => new AppError("RATE_LIMITED", msg, true),
  blocked: (msg: string) => new AppError("SOURCE_BLOCKED", msg, false),
  invalidInput: (msg: string) => new AppError("INVALID_INPUT", msg, false),
  securityBlocked: (msg: string) => new AppError("SECURITY_BLOCKED", msg, false),
  dbError: (msg: string) => new AppError("DB_ERROR", msg, true),
};
