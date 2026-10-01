/**
 * Storage abstraction (Phase 8 — Scale). All pipeline modules talk to this
 * async interface instead of `node:sqlite` directly:
 * - SqliteStore: local dev / CI / GitHub Actions (backed by DatabaseSync),
 * - D1Store: Cloudflare Workers production (backed by the D1 binding).
 * One interface, two runtimes — pipeline code is identical on both.
 */

export interface Store {
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null>;
  exec(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | null }>;
  /** Run fn atomically where the backend supports it (SQLite yes; D1 sequential). */
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;
}

export interface StoreValues {
  changes: number;
  lastInsertRowid: number | null;
}
