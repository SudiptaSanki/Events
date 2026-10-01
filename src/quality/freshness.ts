/**
 * Freshness scoring + stale detection (spec 22, 48). Deterministic, no I/O.
 * freshness is stored SEPARATELY from verification (spec 17).
 */
export interface FreshnessInput {
  firstSeen: string | null;
  lastSeen: string | null;
  lastVerified: string | null;
  now?: string;
}

function ageHours(ts: string | null, nowMs: number): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (nowMs - t) / 3_600_000);
}

/**
 * 0–100. Freshly verified = 100. Decays with verification age; unseen items
 * decay faster. Never-verified items cap at 40 (observed but unconfirmed).
 */
export function freshnessScore(input: FreshnessInput): number {
  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  const vAge = ageHours(input.lastVerified, nowMs);
  const sAge = ageHours(input.lastSeen ?? input.firstSeen, nowMs);
  if (vAge == null) {
    if (sAge == null) return 0;
    if (sAge <= 24) return 40;
    if (sAge <= 72) return 25;
    if (sAge <= 168) return 10;
    return 0;
  }
  let score = 100;
  if (vAge > 24) score -= 20;
  if (vAge > 72) score -= 25;
  if (vAge > 168) score -= 30;
  if (sAge != null && sAge > 168) score -= 15;
  return Math.max(0, Math.min(100, score));
}

export interface StaleInput {
  status: string;
  endDate: string | null;
  deadline: string | null;
  now?: string;
}

const TERMINAL = new Set(["EXPIRED", "CANCELLED", "REJECTED"]);

export function isStale(input: StaleInput): { stale: boolean; reason: string | null } {
  if (TERMINAL.has(input.status)) return { stale: false, reason: null };
  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  // 26h grace past end/deadline (timezone-safe margin).
  const GRACE_MS = 26 * 3_600_000;
  if (input.endDate) {
    const t = Date.parse(input.endDate);
    if (!Number.isNaN(t) && nowMs - t > GRACE_MS) {
      return { stale: true, reason: "PAST_END_DATE" };
    }
  }
  if (input.deadline) {
    const t = Date.parse(input.deadline);
    if (!Number.isNaN(t) && nowMs - t > GRACE_MS) {
      return { stale: true, reason: "PAST_DEADLINE" };
    }
  }
  return { stale: false, reason: null };
}
