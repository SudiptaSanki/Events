/**
 * Domain intelligence + lookalike detection (spec 11) + trusted-provider
 * classification (spec 12). Deterministic heuristics only — a trusted
 * provider NEVER proves an event is legitimate (spec 12).
 */
import {
  GOVERNMENT_SUFFIXES,
  KNOWN_FORM_PROVIDERS,
  TRUSTED_EVENT_PLATFORMS,
  UNIVERSITY_SUFFIXES,
} from "../config.js";
import { registrableDomainOf } from "../normalize/url.js";
import type { DomainRelationship, ProviderCategory } from "../types.js";

export interface DomainInspection {
  host: string;
  registrableDomain: string | null;
  relationship: DomainRelationship;
  providerCategory: ProviderCategory;
  lookalike: LookalikeResult;
}

export interface LookalikeResult {
  suspicious: boolean;
  signals: string[];
}

/** Classify how a registration host relates to the organizer's official domain. */
export function classifyDomainRelationship(
  regHost: string,
  officialDomain: string | null,
): { relationship: DomainRelationship; providerCategory: ProviderCategory } {
  const host = regHost.toLowerCase();
  const official = (officialDomain ?? "").toLowerCase().replace(/^www\./, "");
  const regRoot = registrableDomainOf(host) ?? host;

  if (official) {
    const officialRoot = registrableDomainOf(official.replace(/^www\./, "")) ?? official;
    if (host === official || host === `www.${official}` || official === host) {
      return { relationship: "SAME_DOMAIN", providerCategory: providerCategoryOf(host, official) };
    }
    if (host.endsWith(`.${official}`) || officialRoot === regRoot) {
      return { relationship: "SUBDOMAIN", providerCategory: providerCategoryOf(host, official) };
    }
  }
  if (TRUSTED_EVENT_PLATFORMS.some((d) => host === d || host.endsWith(`.${d}`))) {
    return { relationship: "KNOWN_EVENT_PLATFORM", providerCategory: "ESTABLISHED_EVENT_PLATFORM" };
  }
  if (KNOWN_FORM_PROVIDERS.some((d) => host === d || host.endsWith(`.${d}`))) {
    return { relationship: "EXTERNAL_REGISTRATION_PROVIDER", providerCategory: "KNOWN_FORM_PROVIDER" };
  }
  if (UNIVERSITY_SUFFIXES.some((s) => host.endsWith(s))) {
    return { relationship: "EXTERNAL_REGISTRATION_PROVIDER", providerCategory: "UNIVERSITY_DOMAIN" };
  }
  if (GOVERNMENT_SUFFIXES.some((s) => host.endsWith(s))) {
    return { relationship: "EXTERNAL_REGISTRATION_PROVIDER", providerCategory: "GOVERNMENT_DOMAIN" };
  }
  return { relationship: "UNKNOWN_DOMAIN", providerCategory: "UNKNOWN" };
}

function providerCategoryOf(host: string, official: string): ProviderCategory {
  void official;
  if (UNIVERSITY_SUFFIXES.some((s) => host.endsWith(s))) return "UNIVERSITY_DOMAIN";
  if (GOVERNMENT_SUFFIXES.some((s) => host.endsWith(s))) return "GOVERNMENT_DOMAIN";
  if (TRUSTED_EVENT_PLATFORMS.some((d) => host === d || host.endsWith(`.${d}`)))
    return "ESTABLISHED_EVENT_PLATFORM";
  if (KNOWN_FORM_PROVIDERS.some((d) => host === d || host.endsWith(`.${d}`)))
    return "KNOWN_FORM_PROVIDER";
  return "OFFICIAL_DOMAIN";
}

// ---------------------------------------------------------------------------
// Lookalike detection (spec 11)
// ---------------------------------------------------------------------------

/** Detect impersonation-style similarity to the official domain. */
export function detectLookalike(regHost: string, officialDomain: string | null): LookalikeResult {
  const signals: string[] = [];
  const host = regHost.toLowerCase();
  if (!officialDomain) return { suspicious: false, signals };

  const official = officialDomain.toLowerCase().replace(/^www\./, "");
  const officialRoot = (registrableDomainOf(official) ?? official).split(".")[0];
  const regRootFull = registrableDomainOf(host) ?? host;
  const regRoot = regRootFull.split(".")[0];

  if (host === official || host.endsWith(`.${official}`)) return { suspicious: false, signals };
  if (TRUSTED_EVENT_PLATFORMS.some((d) => host === d || host.endsWith(`.${d}`))) {
    return { suspicious: false, signals }; // legitimate external platform
  }
  if (KNOWN_FORM_PROVIDERS.some((d) => host === d || host.endsWith(`.${d}`))) {
    return { suspicious: false, signals };
  }

  // 1. Homoglyph / leet substitution: examp1e vs example
  const deLeeted = regRoot.replace(/0/g, "o").replace(/1/g, "l").replace(/5/g, "s").replace(/3/g, "e");
  if (deLeeted === officialRoot && regRoot !== officialRoot) {
    signals.push("CHARACTER_SUBSTITUTION");
  }
  // 2. Edit distance 1-2 on the root label
  const dist = levenshtein(regRoot, officialRoot);
  if (regRoot !== officialRoot && dist > 0 && dist <= 2 && officialRoot.length >= 4) {
    signals.push("CLOSE_EDIT_DISTANCE");
  }
  // 3. Official name embedded with extra words/hyphens: example-hackathon-registration.com
  if (regRoot.includes(officialRoot) && regRoot !== officialRoot) {
    signals.push("ADDED_WORDS_OR_HYPHENATION");
  }
  // 4. Official name as subdomain of unrelated root: example.com.evil.xyz
  if (host.includes(officialRoot) && regRootFull !== (registrableDomainOf(official) ?? official)) {
    if (!signals.includes("ADDED_WORDS_OR_HYPHENATION")) signals.push("MISLEADING_SUBDOMAIN");
    else signals.push("MISLEADING_SUBDOMAIN");
  }
  // 5. Suspicious TLD on lookalike root
  if (/\.xyz$|\.top$|\.click$|\.buzz$|\.tk$|\.ml$/.test(host) && (signals.length > 0 || regRoot.includes(officialRoot))) {
    signals.push("UNUSUAL_TLD");
  }
  // 6. Punycode
  if (host.includes("xn--")) signals.push("PUNYCODE");

  return { suspicious: signals.length > 0, signals: [...new Set(signals)] };
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m]![n]!;
}
