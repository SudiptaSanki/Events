/**
 * SqliteStore: Store over node:sqlite DatabaseSync (local dev, CI, Actions).
 */
import type { DatabaseSync } from "node:sqlite";
import { migrate, openDatabase } from "./sqlite.js";
import type { Store } from "./store.js";

export function createSqliteStore(db: DatabaseSync): Store {
  const args = (params: unknown[]): never[] => params as never[];
  return {
    async query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return db.prepare(sql).all(...args(params)) as T[];
    },
    async queryOne<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      const row = db.prepare(sql).get(...args(params)) as T | undefined;
      return row ?? null;
    },
    async exec(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | null }> {
      const info = db.prepare(sql).run(...args(params));
      const rawId = info.lastInsertRowid as unknown;
      return {
        changes: Number(info.changes ?? 0),
        lastInsertRowid: typeof rawId === "number" || typeof rawId === "bigint" ? Number(rawId) : null,
      };
    },
    async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
      const inner = createSqliteStore(db);
      db.exec("BEGIN");
      try {
        const result = await fn(inner);
        db.exec("COMMIT");
        return result;
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Already rolled back / no transaction — surface the original error.
        }
        throw e;
      }
    },
  };
}

/** In-memory store for tests: returns both the raw DB (for setup/assertions)
 *  and the Store (for pipeline modules). */
export function createMemoryStore(): { db: DatabaseSync; store: Store } {
  const db = openDatabase(":memory:");
  migrate(db);
  return { db, store: createSqliteStore(db) };
}
