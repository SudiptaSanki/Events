/**
 * Notification message formatters (all channels). Pure functions only —
 * no network calls, no tokens, no sending. Sending lives in the channel
 * adapters (telegram/discord/whatsapp) and is gated by dispatch.
 */
import type { EventRecord } from "../types.js";

export interface FormattedAlert {
  text: string; // Telegram text (Markdown-safe, no absolute-authenticity claims)
  discordEmbed: {
    title: string;
    description: string;
    fields: Array<{ name: string; value: string; inline: boolean }>;
    buttons: Array<{ label: string; url: string }>;
  };
}

const UNVERIFIED_NOTE = "Registration link could not be independently verified.";

/** Pure formatter. Caller MUST have passed publishingGate() before using this. */
export function formatEventAlert(event: EventRecord, verificationLabel: string): FormattedAlert {
  const regLine = event.registration_url ?? UNVERIFIED_NOTE;
  const text = [
    `🚀 ${event.title}`,
    ``,
    `🏢 Organizer: ${event.organizer_name ?? "Unknown"}`,
    `📍 ${event.format}${event.city ? ` · ${event.city}` : ""}`,
    event.start_date ? `📅 Event date: ${event.start_date}` : null,
    event.registration_deadline ? `⏰ Registration deadline: ${event.registration_deadline}` : null,
    event.eligibility ? `👥 Eligibility: ${event.eligibility}` : null,
    event.team_size ? `👨‍💻 Team size: ${event.team_size}` : null,
    event.prize ? `💰 Prize: ${event.prize}` : null,
    event.event_url ? `🔗 Official event page: ${event.event_url}` : `🔗 Source: see evidence trail`,
    `📝 Registration: ${regLine}`,
    `🔎 Verification: ${verificationLabel}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const buttons: Array<{ label: string; url: string }> = [];
  if (event.event_url) buttons.push({ label: "Official Event", url: event.event_url });
  if (event.registration_url) buttons.push({ label: "Register", url: event.registration_url });

  return {
    text,
    discordEmbed: {
      title: event.title,
      description: (event.description ?? "").slice(0, 1000),
      fields: [
        { name: "Organizer", value: event.organizer_name ?? "Unknown", inline: true },
        { name: "Format", value: event.format, inline: true },
        { name: "Verification", value: verificationLabel, inline: false },
      ],
      buttons,
    },
  };
}

/** Allowed verification labels — never "100% safe" / "guaranteed" (spec 3). */
export function verificationLabelFor(decision: string | null): string {
  switch (decision) {
    case "VERIFIED_OFFICIAL": return "✅ Official organizer source confirmed";
    case "VERIFIED_BY_MULTIPLE_SOURCES": return "✅ Confirmed by multiple independent sources";
    case "LIKELY_LEGITIMATE": return "⚠️ Likely legitimate — review evidence before registering";
    case "SUSPICIOUS": return "⛔ Suspicious — do not register";
    case "REJECTED": return "⛔ Rejected";
    default: return "❓ Unverified — registration link could not be independently verified";
  }
}

/**
 * Correction/update message (spec 50). Published only when evidence supports
 * the correction — the caller passes the verified replacement content.
 */
export function formatCorrection(
  eventTitle: string,
  correctionNote: string,
  officialEventPage: string | null,
): FormattedAlert {
  const text = [
    `⚠️ EVENT UPDATE: ${eventTitle}`,
    ``,
    correctionNote,
    officialEventPage ? `Official event page: ${officialEventPage}` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
  return {
    text,
    discordEmbed: {
      title: `⚠️ Update: ${eventTitle}`,
      description: correctionNote.slice(0, 1000),
      fields: [],
      buttons: officialEventPage ? [{ label: "Official Event", url: officialEventPage }] : [],
    },
  };
}
