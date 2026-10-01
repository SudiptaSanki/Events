/**
 * D1Store: Store over a Cloudflare D1 database binding. Depends only on a
 * minimal structural interface (D1Like), so it is unit-testable with a fake.
 * NOTE: D1 has no interactive transactions; transaction() runs sequentially
 * (each statement stays atomic). Scheduling is idempotent to tolerate this.
 */
import type { Store } from "./store.js";

export interface D1ResultSet<T> {
  results: T[];
}

export interface D1ExecResult {
  success: boolean;
  meta: { changes: number; last_row_id: number | bigint | null };
}

export interface D1Statement {
  bind(...params: unknown[]): {
    first<T>(): Promise<T | null>;
    all<T>(): Promise<D1ResultSet<T>>;
    run(): Promise<D1ExecResult>;
  };
}

export interface D1Like {
  prepare(query: string): D1Statement;
}

export function createD1Store(d1: D1Like): Store {
  return {
    async query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      const rs = await d1.prepare(sql).bind(...params).all<T>();
      return rs.results ?? [];
    },
    async queryOne<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      return d1.prepare(sql).bind(...params).first<T>();
    },
    async exec(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | null }> {
      const r = await d1.prepare(sql).bind(...params).run();
      const id = r.meta?.last_row_id;
      return {
        changes: Number(r.meta?.changes ?? 0),
        lastInsertRowid: typeof id === "number" || typeof id === "bigint" ? Number(id) : null,
      };
    },
    async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
      // No interactive transactions on D1 — run sequentially.
      return fn(createD1Store(d1));
    },
  };
}
