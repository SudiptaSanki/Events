/**
 * URL normalization (spec 54) + short-URL handling (spec 55).
 * Pure, deterministic, no network. Redirect resolution is injected
 * separately so tests never touch the network.
 */
import { SHORT_URL_HOSTS, TRACKING_PARAMS } from "../config.js";

export interface NormalizedUrl {
  input: string;
  canonical: string | null;
  valid: boolean;
  reason: string | null;
  host: string | null;
  registrableDomain: string | null;
  isHttps: boolean;
  isShortUrl: boolean;
}

/** Lowercase host, strip default ports, remove tracking params + fragment. */
export function normalizeUrl(raw: string): NormalizedUrl {
  const input = raw.trim();
  if (!input) {
    return { input, canonical: null, valid: false, reason: "EMPTY", host: null, registrableDomain: null, isHttps: false, isShortUrl: false };
  }
  let candidate = input;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) candidate = "https://" + candidate;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { input, canonical: null, valid: false, reason: "UNPARSABLE", host: null, registrableDomain: null, isHttps: false, isShortUrl: false };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { input, canonical: u.href, valid: false, reason: "UNSUPPORTED_SCHEME", host: u.hostname.toLowerCase(), registrableDomain: registrableDomainOf(u.hostname), isHttps: false, isShortUrl: false };
  }
  const host = u.hostname.toLowerCase();
  // Strip tracking params but KEEP all other params (may be required, spec 54).
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.hash = "";
  // Collapse trailing slash (except root) + lowercase host only (path case kept).
  let path = u.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";
  // Rebuild without default ports.
  const isDefaultPort =
    (u.protocol === "https:" && (u.port === "" || u.port === "443")) ||
    (u.protocol === "http:" && (u.port === "" || u.port === "80"));
  const port = isDefaultPort ? "" : u.port ? `:${u.port}` : "";
  const search = u.searchParams.toString();
  const canonical = `${u.protocol}//${host}${port}${path}${search ? `?${search}` : ""}`;
  return {
    input,
    canonical,
    valid: true,
    reason: null,
    host,
    registrableDomain: registrableDomainOf(host),
    isHttps: u.protocol === "https:",
    isShortUrl: SHORT_URL_HOSTS.includes(host),
  };
}

/** Registrable-domain extraction: last 2 labels, or 3 under known 2-part public suffixes. */
const TWO_PART_SUFFIXES = new Set([
  "co.in", "ac.in", "edu.in", "gov.in", "nic.in", "org.in", "net.in", "res.in",
  "co.uk", "ac.uk", "org.uk", "gov.uk", "com.au", "org.au", "co.nz",
]);

export function registrableDomainOf(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost") return h || null;
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  if (TWO_PART_SUFFIXES.has(parts.slice(-2).join("."))) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

export function isShortUrlHost(host: string): boolean {
  return SHORT_URL_HOSTS.includes(host.toLowerCase());
}
