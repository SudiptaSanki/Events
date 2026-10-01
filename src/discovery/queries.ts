/**
 * Search query generator (spec 7). Produces discovery queries dynamically from
 * topic × city × site-hint combinations. Output feeds a legitimate search API
 * (see searchApiSource) — never aggressive HTML scraping of search engines.
 */

export const BASE_TOPICS: string[] = [
  "hackathon India",
  "online hackathon India",
  "AI hackathon India",
  "cybersecurity hackathon India",
  "college hackathon India",
  "student hackathon India",
  "coding competition India",
  "developer challenge India",
  "innovation challenge India",
  "datathon India",
  "ML hackathon India",
  "blockchain hackathon India",
  "open source hackathon India",
];

export const COVERED_CITIES: string[] = [
  "Kolkata", "Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Chennai", "Pune",
  "Ahmedabad", "Jaipur", "Bhubaneswar", "Kochi", "Chandigarh", "Noida", "Gurugram",
  "Indore", "Surat", "Nagpur", "Lucknow", "Coimbatore", "Guwahati",
  "Mysuru", "Thiruvananthapuram", "Kozhikode", "Vijayawada", "Bhopal", "Patna",
  "Kanpur", "Varanasi", "Madurai", "Visakhapatnam", "Hubballi", "Mangaluru",
  "Dehradun", "Ranchi", "Raipur", "Udaipur", "Jodhpur", "Kota", "Nashik",
  "Vadodara", "Rajkot", "Ludhiana", "Amritsar", "Prayagraj", "Agra",
  "Gwalior", "Jabalpur", "Dhanbad", "Jamshedpur", "Siliguri", "Cuttack",
  "Rourkela", "Warangal", "Salem", "Tiruchirappalli", "Puducherry",
];

const CITY_TEMPLATES = [
  "hackathon {city}",
  "tech event {city} 2026",
  "coding competition {city}",
  "AI hackathon {city}",
];

/** Build a deduplicated query list. `year` keeps queries fresh. */
export function generateSearchQueries(opts?: {
  topics?: string[];
  cities?: string[];
  year?: number;
  maxQueries?: number;
}): string[] {
  const topics = opts?.topics ?? BASE_TOPICS;
  const cities = opts?.cities ?? COVERED_CITIES;
  const year = opts?.year ?? new Date().getFullYear();
  const maxQueries = opts?.maxQueries ?? 120;
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (q: string): void => {
    const key = q.toLowerCase().trim();
    if (key && !seen.has(key) && out.length < maxQueries) {
      seen.add(key);
      out.push(q.trim());
    }
  };

  for (const t of topics) {
    push(t);
    if (/\b20\d{2}\b/.test(t)) push(t.replace(/20\d{2}/, String(year)));
    else push(`${t} ${year}`);
  }
  for (const city of cities) {
    for (const tpl of CITY_TEMPLATES) push(tpl.replace("{city}", city));
  }
  return out;
}
