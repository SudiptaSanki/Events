/**
 * Prompt-injection defense + safe extraction boundary (spec 32, 33, 63).
 *
 * WEB CONTENT is UNTRUSTED DATA. This module:
 * - never executes instructions found in scraped content,
 * - strips known instruction-attack patterns from stored/displayed text,
 * - detects (but does not obey) embedded instructions and raises flags.
 *
 * The parser extracts title/description/date as DATA. Anything resembling
 * a system command is quarantined into security flags.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+your\s+instructions/i,
  /send\s+(me\s+)?(your|the)\s+(api\s*key|bot\s*token|token|secret|password)/i,
  /disregard\s+.*instructions/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /execute\s+.*(command|script|code)/i,
  /download\s+(and\s+)?(run|execute|install)\s+/i,
  /enter\s+(your|the)\s+(password|otp|pin|credentials)\s+to\s+register/i,
  /system\s*:\s*you/i,
  /\[system\]/i,
  /<\|?(system|assistant|user)\|?>/i,
];

/**
 * Confusable folding (spec 63 adversarial). Attackers swap Latin letters for
 * lookalike Cyrillic/Greek/fullwidth glyphs ("Іgnore" with U+0406) to dodge
 * ASCII pattern matching. Fold known lookalikes to Latin BEFORE matching so
 * detection sees through the disguise. The ORIGINAL text is still what gets
 * stored/displayed (neutralized) — folding is detection-only.
 */
const CONFUSABLES: Record<string, string> = {
  "а": "a", "с": "c", "е": "e", "і": "i", "ї": "i", "ј": "j", "о": "o", "р": "p",
  "ѕ": "s", "х": "x", "у": "y", "һ": "h", "к": "k", "м": "m", "н": "h", "т": "t",
  "А": "A", "С": "C", "Е": "E", "І": "I", "Ј": "J", "О": "O", "Р": "P",
  "Ѕ": "S", "Х": "X", "У": "Y", "Н": "H", "К": "K", "М": "M", "Т": "T",
  "ι": "i", "ο": "o", "ρ": "p", "χ": "x", "υ": "u", "ν": "v", "κ": "k",
  "Ι": "I", "Ο": "O", "Ρ": "P", "Χ": "X", "Υ": "Y", "Ν": "N", "Κ": "K",
};

export function foldConfusables(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, (ch) => CONFUSABLES[ch] ?? "\uFFFD");
}

export interface SanitizeResult {
  text: string; // safe to store/display
  flagged: boolean;
  matchedPatterns: string[];
}

/** Remove control chars, flag instruction-like content, keep the rest as data. */
export function sanitizeUntrustedText(input: string, maxLen = 4000): SanitizeResult {
  const folded = foldConfusables(input);
  const matchedPatterns: string[] = [];
  for (const re of INJECTION_PATTERNS) {
    if (re.test(input) || re.test(folded)) matchedPatterns.push(re.source);
  }
  // Neutralize, don't execute: replace ASCII matches with a placeholder.
  let text = input;
  for (const re of INJECTION_PATTERNS) {
    text = text.replace(new RegExp(re.source, "gi"), "[REMOVED_INSTRUCTION]");
  }
  if (matchedPatterns.length > 0 && text === input) {
    // Matched only through confusable folding (disguised glyphs): the ASCII
    // replacement could not apply, so quarantine-mark the field. It stays
    // flagged for human review and is never executed (spec 32).
    text = `[QUARANTINED_INSTRUCTION] ${text}`;
  }
  // Strip control characters except newline/tab.
  // biome-ignore lint: intentional control-char strip
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  if (text.length > maxLen) text = text.slice(0, maxLen) + "…";
  return { text: text.trim(), flagged: matchedPatterns.length > 0, matchedPatterns };
}

/** Returns true if the field must be quarantined for manual review. */
export function containsInjection(input: string): boolean {
  const folded = foldConfusables(input);
  return INJECTION_PATTERNS.some((re) => re.test(input) || re.test(folded));
}
