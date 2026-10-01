/**
 * Source reputation learning (spec 16, 52, 53). Bounded, damped adjustments —
 * one failure never blacklists a source. Wired into discovery (duplicates)
 * and verification (valid/fake/dead_link) outcomes. Store-based.
 */
import type { Store } from "../db/store.js";

export type ReputationOutcome = "valid" | "dead_link" | "fake" | "duplicate";

const DELTAS: Record<ReputationOutcome, number> = {
  valid: 3,
  dead_link: -2,
  fake: -8,
  duplicate: -1,
};

const COUNTER_COLUMN: Record<ReputationOutcome, string> = {
  valid: "valid_events",
  dead_link: "dead_links",
  fake: "fake_events",
  duplicate: "duplicates",
};

/** Pure score step: damped near the edges, clamped 0–100. */
export function applyReputationStep(trust: number, outcome: ReputationOutcome): number {
  const base = Math.max(0, Math.min(100, trust));
  const delta = DELTAS[outcome];
  // Damp positive drift above 90 so perfect scores must be earned repeatedly.
  const effective = delta > 0 && base >= 90 ? 1 : delta;
  return Math.max(0, Math.min(100, base + effective));
}

export async function recordSourceOutcome(
  store: Store,
  sourceId: string,
  outcome: ReputationOutcome,
  now: string,
): Promise<void> {
  // Self-sufficient: a source earning reputation must exist in the registry.
  await store.exec(
    `INSERT OR IGNORE INTO source_registry(source_id,name,type,trust_score,enabled,rate_limit_ms)
     VALUES (?,?,'UNKNOWN',50,1,60000)`,
    sourceId,
    sourceId,
  );
  await store.exec(
    `INSERT INTO source_reputation(source_id,valid_events,dead_links,fake_events,duplicates,updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(source_id) DO UPDATE SET
       ${COUNTER_COLUMN[outcome]} = ${COUNTER_COLUMN[outcome]} + 1,
       updated_at = excluded.updated_at`,
    sourceId,
    outcome === "valid" ? 1 : 0,
    outcome === "dead_link" ? 1 : 0,
    outcome === "fake" ? 1 : 0,
    outcome === "duplicate" ? 1 : 0,
    now,
  );

  const reg = await store.queryOne<{ trust_score: number }>(
    "SELECT trust_score FROM source_registry WHERE source_id = ?",
    sourceId,
  );
  if (reg) {
    await store.exec("UPDATE source_registry SET trust_score = ? WHERE source_id = ?", applyReputationStep(reg.trust_score, outcome), sourceId);
  }
}
