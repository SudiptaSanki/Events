/**
 * India relevance scoring (spec 24). Deterministic, explainable.
 * Never label an international event as Indian without evidence.
 */
export interface RelevanceInput {
  country: string | null;
  city: string | null;
  organizerName: string | null;
  organizerDomain: string | null;
  eligibility: string | null;
  currencyHint: string | null; // e.g. prize text containing ₹/INR
  timezone: string | null;
  onlineFromIndia: boolean | null;
}

export interface RelevanceResult {
  score: number; // 0-100
  indian: boolean;
  reasons: string[];
}

const INDIAN_CITIES = new Set([
  "bengaluru", "mumbai", "delhi", "hyderabad", "chennai", "pune", "kolkata",
  "ahmedabad", "jaipur", "bhubaneswar", "kochi", "chandigarh", "noida", "gurugram",
  "indore", "surat", "nagpur", "lucknow", "kanpur", "mysuru", "mysore", "coimbatore",
  "kozhikode", "thiruvananthapuram", "guwahati", "patna", "bhopal", "vijayawada",
]);

export function indiaRelevance(input: RelevanceInput): RelevanceResult {
  let score = 0;
  const reasons: string[] = [];
  const lower = (s: string | null) => (s ?? "").toLowerCase();

  if (lower(input.country) === "in" || lower(input.country) === "india") {
    score += 35; reasons.push("COUNTRY_INDIA");
  }
  if (input.city && INDIAN_CITIES.has(input.city.toLowerCase())) {
    score += 25; reasons.push("INDIAN_CITY");
  }
  if (input.organizerDomain && (/\.in$/.test(input.organizerDomain.toLowerCase()) || /\.ac\.in$|\.edu\.in$|\.gov\.in$|\.nic\.in$/.test(input.organizerDomain.toLowerCase()))) {
    score += 20; reasons.push("INDIAN_ORGANIZER_DOMAIN");
    // .ac.in/.edu.in/.gov.in/.nic.in are India-only allocations — near-certain.
    if (/\.(ac|edu|gov)\.in$|\.nic\.in$/.test(input.organizerDomain.toLowerCase())) {
      score += 15; reasons.push("INDIAN_ACADEMIC_OR_GOV_DOMAIN");
    }
  }
  if (/india|indian|bharat/.test(lower(input.organizerName) + " " + lower(input.eligibility))) {
    score += 10; reasons.push("INDIA_MENTIONED");
  }
  if (input.currencyHint && /₹|inr|rs\.?\s?\d|lakh/.test(input.currencyHint.toLowerCase())) {
    score += 5; reasons.push("INR_PRIZE");
  }
  if (lower(input.timezone) === "asia/kolkata") {
    score += 5; reasons.push("IST_TIMEZONE");
  }
  if (input.onlineFromIndia === true) {
    score += 5; reasons.push("ONLINE_FROM_INDIA");
  }
  score = Math.min(100, score);
  return { score, indian: score >= 30, reasons };
}
