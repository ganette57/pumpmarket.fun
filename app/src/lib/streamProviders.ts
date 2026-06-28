// src/lib/streamProviders.ts
//
// Provider allow-list + URL parsing shared by:
//  - host session creation (reject non-allowed providers / blocked streams)
//  - the Admin Live Operations dashboard (display provider / video id / channel)
//  - the player attribution line (Parts 8 & 9)
//
// Only YouTube, Twitch and Kick are permitted. Every other provider is rejected.

export type StreamProvider = "youtube" | "twitch" | "kick";

/** Canonical allow-list (Part 8). */
export const ALLOWED_PROVIDERS: StreamProvider[] = ["youtube", "twitch", "kick"];

export const PROVIDER_LABELS: Record<StreamProvider, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  kick: "Kick",
};

export type ParsedStream = {
  /** Detected provider, or null when the URL matches no allowed provider. */
  provider: StreamProvider | null;
  /** Human label for the provider (e.g. "YouTube"). null when unknown. */
  providerLabel: string | null;
  /** YouTube video id when applicable, else null. */
  videoId: string | null;
  /** Channel / streamer handle (Twitch, Kick, or YouTube channel/handle). */
  channel: string | null;
};

/**
 * Parse a stream URL into { provider, videoId, channel }.
 * The matchers intentionally mirror the StreamPlayer embed logic so the admin
 * dashboard shows exactly what the player will resolve.
 */
export function parseStream(rawUrl: string | null | undefined): ParsedStream {
  const url = String(rawUrl || "").trim();
  const empty: ParsedStream = {
    provider: null,
    providerLabel: null,
    videoId: null,
    channel: null,
  };
  if (!url) return empty;

  // ── YouTube ──────────────────────────────────────────────────────
  const ytVideo = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/|youtube\.com\/embed\/)([\w-]+)/,
  );
  if (ytVideo) {
    const channelMatch = url.match(/youtube\.com\/(?:@([\w.-]+)|channel\/([\w-]+))/);
    return {
      provider: "youtube",
      providerLabel: PROVIDER_LABELS.youtube,
      videoId: ytVideo[1],
      channel: channelMatch ? channelMatch[1] || channelMatch[2] || null : null,
    };
  }
  // YouTube channel / handle without an explicit video id.
  const ytChannel = url.match(/youtube\.com\/(?:@([\w.-]+)|channel\/([\w-]+)|c\/([\w-]+))/);
  if (ytChannel) {
    return {
      provider: "youtube",
      providerLabel: PROVIDER_LABELS.youtube,
      videoId: null,
      channel: ytChannel[1] || ytChannel[2] || ytChannel[3] || null,
    };
  }

  // ── Twitch ───────────────────────────────────────────────────────
  const twitch = url.match(/twitch\.tv\/(\w+)/);
  if (twitch) {
    return {
      provider: "twitch",
      providerLabel: PROVIDER_LABELS.twitch,
      videoId: null,
      channel: twitch[1],
    };
  }

  // ── Kick ─────────────────────────────────────────────────────────
  const kick = url.match(/kick\.com\/([\w-]+)/);
  if (kick) {
    return {
      provider: "kick",
      providerLabel: PROVIDER_LABELS.kick,
      videoId: null,
      channel: kick[1],
    };
  }

  return empty;
}

/** True when the URL resolves to an allowed provider (Part 8). */
export function isAllowedStreamUrl(rawUrl: string | null | undefined): boolean {
  return parseStream(rawUrl).provider != null;
}

/**
 * Attribution text shown below the embedded player (Part 9), e.g.
 * "Video provided by YouTube." Returns null when the provider is unknown.
 */
export function providerAttribution(provider: StreamProvider | null): string | null {
  if (!provider) return null;
  return `Video provided by ${PROVIDER_LABELS[provider]}.`;
}

/** Region-availability note shown beneath the attribution (Part 9). */
export const REGION_AVAILABILITY_NOTE =
  "Availability may vary depending on your region.";
