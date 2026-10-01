/**
 * Change detection + field consistency (spec 13, 14, 20). Compares a fresh
 * observation against the stored row:
 * - identical values: no-op,
 * - one side null: adopt the known value (no conflict),
 * - both set and differ: CONFLICT — never guess; flag NEEDS_REVIEW unless the
 *   fresh observation is first-party AND strictly newer (spec 14: newest
 *   official source resolves).
 */
export interface FieldDiff {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export const TRACKED_FIELDS = [
  "title",
  "organizer_name",
  "start_date",
  "end_date",
  "registration_deadline",
  "city",
  "venue",
  "registration_url",
] as const;

export function diffTrackedFields(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of TRACKED_FIELDS) {
    const o = before[field] ?? null;
    const n = after[field] ?? null;
    if (o !== n) diffs.push({ field, oldValue: o, newValue: n });
  }
  return diffs;
}

export interface ConflictResolution {
  /** Value to store (null = keep stored value). */
  value: string | null;
  /** True when a human must decide. */
  needsReview: boolean;
}

export function resolveFieldConflict(
  oldValue: string | null,
  newValue: string | null,
  freshIsFirstParty: boolean,
): ConflictResolution {
  if (oldValue === newValue) return { value: oldValue, needsReview: false };
  if (oldValue == null) return { value: newValue, needsReview: false };
  if (newValue == null) return { value: oldValue, needsReview: false };
  // Both set and differ: trust the newest OFFICIAL source, else review.
  if (freshIsFirstParty) return { value: newValue, needsReview: false };
  return { value: oldValue, needsReview: true };
}
