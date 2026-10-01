/** Minimal Cloudflare Worker environment declarations (Phase 1 stub). */
interface D1Database {
  prepare(query: string): unknown;
  batch(statements: unknown[]): Promise<unknown>;
  exec(query: string): Promise<unknown>;
}
interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}
