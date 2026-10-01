/**
 * Core domain types. Single source of truth for Event / Organizer /
 * verification artefacts. D1 (SQLite) compatible: dates are ISO-8601 TEXT.
 */

// ---------------------------------------------------------------------------
// Enumerations (spec sections 18, 19, 25, 26, 40)
// ---------------------------------------------------------------------------

export type EventStatus =
  | "DISCOVERED"
  | "PROCESSING"
  | "VERIFIED"
  | "PUBLISHED"
  | "UPDATED"
  | "EXPIRED"
  | "CANCELLED"
  | "POSTPONED"
  | "SUSPICIOUS"
  | "REJECTED"
  | "NEEDS_REVIEW";

export type RegistrationStatus =
  | "OPEN"
  | "NOT_OPEN"
  | "CLOSED"
  | "WAITLIST"
  | "UNKNOWN"
  | "SUSPENDED";

export type EventFormat = "ONLINE" | "OFFLINE" | "HYBRID" | "UNKNOWN";

export type VerificationDecision =
  | "VERIFIED_OFFICIAL"
  | "VERIFIED_BY_MULTIPLE_SOURCES"
  | "LIKELY_LEGITIMATE"
  | "UNVERIFIED"
  | "SUSPICIOUS"
  | "REJECTED";

/** Publishing tiers, spec section 66. */
export type PublishingTier = "A" | "B" | "C" | "D" | "E";

/** Source hierarchy levels, spec section 1. Lower number = stronger. */
export type SourceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type UrlType =
  | "EVENT_PAGE"
  | "REGISTRATION"
  | "JOIN"
  | "ORGANIZER"
  | "SOCIAL"
  | "SOURCE";

export type DomainRelationship =
  | "SAME_DOMAIN"
  | "SUBDOMAIN"
  | "KNOWN_EVENT_PLATFORM"
  | "EXTERNAL_REGISTRATION_PROVIDER"
  | "UNKNOWN_DOMAIN";

export type ProviderCategory =
  | "OFFICIAL_DOMAIN"
  | "UNIVERSITY_DOMAIN"
  | "GOVERNMENT_DOMAIN"
  | "ESTABLISHED_EVENT_PLATFORM"
  | "KNOWN_FORM_PROVIDER"
  | "UNKNOWN";

export type LinkSecurityStatus =
  | "PENDING"
  | "CLEAR_LOCAL_CHECKS"
  | "FLAGGED"
  | "MALICIOUS_REPUTATION"
  | "UNREACHABLE";

export type LinkVerificationStatus =
  | "UNVERIFIED"
  | "PENDING"
  | "VERIFIED"
  | "MISMATCH"
  | "REJECTED";

export type EventCategory =
  | "Hackathon"
  | "Coding Competition"
  | "AI/ML"
  | "Cybersecurity"
  | "Web Development"
  | "App Development"
  | "Blockchain"
  | "Web3"
  | "Cloud"
  | "DevOps"
  | "Data Science"
  | "Data Engineering"
  | "Robotics"
  | "IoT"
  | "Hardware"
  | "Open Source"
  | "Startup"
  | "Innovation"
  | "Ideathon"
  | "Datathon"
  | "Research"
  | "Design"
  | "Game Development"
  | "AR/VR"
  | "Quantum Computing"
  | "Other";

// ---------------------------------------------------------------------------
// Organizer (spec section 59)
// ---------------------------------------------------------------------------

export interface Organizer {
  organizer_id: string; // uuid (generated locally)
  name: string;
  normalized_name: string;
  official_domain: string | null;
  country: string | null; // e.g. "IN"
  type: string | null; // university | company | government | community | ...
  verified: 0 | 1;
  social_accounts: string | null; // JSON array string
  reputation_score: number; // 0-100
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export interface EventRecord {
  event_id: string;
  title: string;
  normalized_title: string;
  organizer_id: string | null;
  organizer_name: string | null;
  description: string | null;
  categories: string | null; // JSON array of EventCategory
  format: EventFormat;
  country: string | null;
  state: string | null;
  city: string | null; // normalized
  city_original: string | null;
  venue: string | null;
  address: string | null;
  timezone: string | null; // e.g. Asia/Kolkata
  start_date: string | null; // ISO-8601
  end_date: string | null;
  registration_deadline: string | null;
  registration_status: RegistrationStatus;
  event_url: string | null;
  registration_url: string | null; // canonical verified (or null if unverified)
  registration_unverified_note: string | null;
  eligibility: string | null;
  team_size: string | null;
  prize: string | null;
  technologies: string | null; // JSON array string
  status: EventStatus;
  verification_decision: VerificationDecision | null;
  verification_score: number;
  source_trust_score: number | null;
  india_relevance_score: number | null;
  freshness_score: number | null;
  publishing_tier: PublishingTier | null;
  dedupe_key: string | null;
  first_seen: string;
  last_seen: string;
  last_verified: string | null;
  last_link_check: string | null;
}

// ---------------------------------------------------------------------------
// Links / evidence / flags
// ---------------------------------------------------------------------------

export interface EventLink {
  link_id?: number;
  event_id: string;
  url_type: UrlType;
  original_url: string;
  canonical_url: string | null;
  final_url: string | null;
  domain: string | null;
  is_https: number; // 0/1
  redirect_count: number;
  redirect_chain: string | null; // JSON array
  domain_relationship: DomainRelationship | null;
  provider_category: ProviderCategory | null;
  security_status: LinkSecurityStatus;
  verification_status: LinkVerificationStatus;
  last_checked: string | null;
  first_seen: string;
}

export interface VerificationEvidence {
  evidence_id?: number;
  event_id: string;
  source_url: string;
  evidence_type: string; // e.g. OFFICIAL_PAGE_LINKS_REGISTRATION
  evidence_text: string;
  observed_at: string;
  source_trust: number | null;
  supports_claim: number; // 0/1
}

export interface SecurityFlag {
  flag_id?: number;
  event_id: string | null;
  link_id: number | null;
  flag_type: string; // e.g. LOOKALIKE_DOMAIN, SUSPICIOUS_REDIRECT, ...
  severity: "info" | "warning" | "critical";
  details: string | null;
  resolved: number; // 0/1
  created_at: string;
}

export interface SourceRecord {
  source_id: string; // slug, e.g. devfolio
  name: string;
  type: string; // PLATFORM | UNIVERSITY | GOVERNMENT | SEARCH | SOCIAL | ...
  base_url: string | null;
  trust_score: number;
  enabled: number; // 0/1
  rate_limit_ms: number;
  last_run: string | null;
  last_status: string | null;
}

// ---------------------------------------------------------------------------
// AI extraction schema (spec section 44). AI output is UNTRUSTED data.
// ---------------------------------------------------------------------------

export interface AIExtraction {
  title: string | null;
  organizer: string | null;
  event_type: string[];
  format: EventFormat | null;
  start_date: string | null;
  end_date: string | null;
  registration_deadline: string | null;
  location: string | null;
  eligibility: string | null;
  team_size: string | null;
  prize: string | null;
  registration_url: string | null;
  event_url: string | null;
  confidence: number;
}

export type FieldPresence = "FOUND" | "NOT_FOUND" | "AMBIGUOUS";
