// src/lib/blockedStreams.ts
//
// Read-side helpers for the `blocked_streams` compliance block-list (Part 7).
// Inserts/removals are admin-only (service role); these reads run with the
// public anon client so the host create flow and the render guard can both
// reject blocked streams.

import { supabase } from "@/lib/supabaseClient";
import { parseStream, type ParsedStream } from "@/lib/streamProviders";

export type BlockedStream = {
  id: string;
  provider: string;
  provider_channel: string | null;
  provider_video_id: string | null;
  reason: string | null;
  created_at: string;
};

/**
 * Returns the matching block-list row when a parsed stream is blocked, else
 * null. A stream is blocked when, for its provider, either the video id OR the
 * channel matches a row in `blocked_streams`.
 */
export async function findBlockedStream(
  parsed: ParsedStream,
): Promise<BlockedStream | null> {
  if (!parsed.provider) return null;
  if (!parsed.videoId && !parsed.channel) return null;

  try {
    const { data, error } = await supabase
      .from("blocked_streams")
      .select("id,provider,provider_channel,provider_video_id,reason,created_at")
      .eq("provider", parsed.provider);

    if (error || !Array.isArray(data)) return null;

    for (const row of data as BlockedStream[]) {
      const videoMatch =
        !!parsed.videoId &&
        !!row.provider_video_id &&
        row.provider_video_id === parsed.videoId;
      const channelMatch =
        !!parsed.channel &&
        !!row.provider_channel &&
        row.provider_channel.toLowerCase() === parsed.channel.toLowerCase();
      if (videoMatch || channelMatch) return row;
    }
    return null;
  } catch {
    return null;
  }
}

/** Convenience: parse a URL then check the block-list. */
export async function isStreamUrlBlocked(
  url: string | null | undefined,
): Promise<BlockedStream | null> {
  return findBlockedStream(parseStream(url));
}
