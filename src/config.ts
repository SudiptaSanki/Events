/**
 * Central configuration. All scoring weights, thresholds and allowlists are
 * configurable here (and overridable via environment) — never hard-coded
 * deep in the pipeline (spec sections 12, 15).
 */

export interface ScoreWeights {
  officialOrganizerPage: number;
  officialRegistrationLink: number;
  organizerSocialConfirmation: number;
  trustedEventPlatform: number;
  secondIndependentSource: number;
  validHttps: number;
  consistentDates: number;
  consistentOrganizer: number;
  recentConfirmation: number;
  suspiciousRedirect: number;
  unknownRegistrationDomain: number;
  conflictingOfficialInfo: number;
  phishingMalwareReputation: number;
  impersonationIndicators: number;
  confirmedMalicious: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  officialOrganizerPage: 25,
  officialRegistrationLink: 20,
  organizerSocialConfirmation: 15,
  trustedEventPlatform: 10,
  secondIndependentSource: 10,
  validHttps: 5,
  consistentDates: 5,
  consistentOrganizer: 5,
  recentConfirmation: 5,
  suspiciousRedirect: -20,
  unknownRegistrationDomain: -25,
  conflictingOfficialInfo: -30,
  phishingMalwareReputation: -40,
  impersonationIndicators: -50,
  confirmedMalicious: -100,
};

export const PUBLISH_THRESHOLD = 70; // do not publish below this score
export const REVIEW_THRESHOLD = 45; // below this => REJECTED, else NEEDS_REVIEW

/** Trusted registration providers (allowlist, spec section 12). */
export const TRUSTED_EVENT_PLATFORMS: string[] = [
  "devfolio.co",
  "unstop.com",
  "hackerearth.com",
  "hack2skill.com",
  "mlh.io",
  "kaggle.com",
  "devpost.com",
  "eventbrite.com",
  "eventbrite.in",
  "meetup.com",
  "lu.ma",
  "townscript.com",
  "allevents.in",
];

export const KNOWN_FORM_PROVIDERS: string[] = [
  "forms.gle",
  "docs.google.com",
  "forms.office.com",
  "microsoft.com",
  "typeform.com",
  "tally.so",
  "airtable.com",
  "zoho.com",
];

export const SHORT_URL_HOSTS: string[] = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "tiny.cc",
];

export const UNIVERSITY_SUFFIXES = [".ac.in", ".edu.in", ".edu", ".ac.uk"];
export const GOVERNMENT_SUFFIXES = [".gov.in", ".nic.in", ".gov", ".mygov.in"];

export const CITY_ALIASES: Record<string, string> = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  bombay: "Mumbai",
  mumbai: "Mumbai",
  calcutta: "Kolkata",
  kolkata: "Kolkata",
  madras: "Chennai",
  chennai: "Chennai",
  poona: "Pune",
  pune: "Pune",
  hyderabad: "Hyderabad",
  delhi: "Delhi",
  "new delhi": "Delhi",
  ahmedabad: "Ahmedabad",
  jaipur: "Jaipur",
  bhubaneswar: "Bhubaneswar",
  bhubaneshwar: "Bhubaneswar",
  kochi: "Kochi",
  cochin: "Kochi",
  chandigarh: "Chandigarh",
  noida: "Noida",
  gurugram: "Gurugram",
  gurgaon: "Gurugram",
};

export const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "_ga",
  "ref",
  "referrer",
  "source",
]);

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
