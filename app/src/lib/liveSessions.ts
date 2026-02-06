// src/lib/liveSessions.ts
import { supabase } from "@/lib/supabaseClient";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type LiveSessionStatus =
  | "scheduled"
  | "live"
  | "locked"
  | "ended"
  | "resolved"
  | "cancelled";

export type LiveSession = {
  id: string;
  created_at: string;
  title: string;
  market_address: string;
  host_wallet: string;
  stream_url: string;
  status: LiveSessionStatus;
  thumbnail_url?: string | null;
  pinned_outcome?: number | null;
  ended_at?: string | null;
};

export type CreateLiveSessionPayload = {
  title: string;
  market_address: string;
  host_wallet: string;
  stream_url: string;
  status?: LiveSessionStatus;
  thumbnail_url?: string | null;
};

export type UpdateLiveSessionPatch = Partial<
  Pick<LiveSession, "title" | "stream_url" | "status" | "thumbnail_url" | "pinned_outcome" | "ended_at">
>;

/* -------------------------------------------------------------------------- */
/*  SELECT columns                                                             */
/* -------------------------------------------------------------------------- */

const LIVE_SESSION_COLS =
  "id,created_at,title,market_address,host_wallet,stream_url,status,thumbnail_url,pinned_outcome,ended_at";

/* -------------------------------------------------------------------------- */
/*  READ                                                                       */
/* -------------------------------------------------------------------------- */

export async function listLiveSessions(
  filter?: { status?: LiveSessionStatus | LiveSessionStatus[] }
): Promise<LiveSession[]> {
  let q = supabase
    .from("live_sessions")
    .select(LIVE_SESSION_COLS)
    .order("created_at", { ascending: false })
    .limit(50);

  if (filter?.status) {
    if (Array.isArray(filter.status)) {
      q = q.in("status", filter.status);
    } else {
      q = q.eq("status", filter.status);
    }
  }

  const { data, error } = await q;
  if (error) {
    console.error("listLiveSessions error:", error);
    return [];
  }
  return (data as LiveSession[]) || [];
}

export async function getLiveSession(id: string): Promise<LiveSession | null> {
  if (!id) return null;

  const { data, error } = await supabase
    .from("live_sessions")
    .select(LIVE_SESSION_COLS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getLiveSession error:", error);
    return null;
  }
  return (data as LiveSession) || null;
}

/* -------------------------------------------------------------------------- */
/*  WRITE                                                                      */
/* -------------------------------------------------------------------------- */

export async function createLiveSession(
  payload: CreateLiveSessionPayload
): Promise<LiveSession> {
  const row = {
    title: String(payload.title || "").trim(),
    market_address: String(payload.market_address || "").trim(),
    host_wallet: String(payload.host_wallet || "").trim(),
    stream_url: String(payload.stream_url || "").trim(),
    status: payload.status || "live",
    thumbnail_url: payload.thumbnail_url ?? null,
  };

  if (!row.title) throw new Error("title is required");
  if (!row.market_address) throw new Error("market_address is required");
  if (!row.host_wallet) throw new Error("host_wallet is required");
  if (!row.stream_url) throw new Error("stream_url is required");

  const { data, error } = await supabase
    .from("live_sessions")
    .insert(row)
    .select(LIVE_SESSION_COLS)
    .single();

  if (error) {
    console.error("createLiveSession error:", error);
    throw error;
  }
  return data as LiveSession;
}

export async function updateLiveSession(
  id: string,
  patch: UpdateLiveSessionPatch
): Promise<void> {
  if (!id) throw new Error("id is required");

  const safePatch: Record<string, unknown> = {};
  if (patch.title !== undefined) safePatch.title = String(patch.title).trim();
  if (patch.stream_url !== undefined) safePatch.stream_url = String(patch.stream_url).trim();
  if (patch.status !== undefined) safePatch.status = patch.status;
  if (patch.thumbnail_url !== undefined) safePatch.thumbnail_url = patch.thumbnail_url;
  if (patch.pinned_outcome !== undefined) safePatch.pinned_outcome = patch.pinned_outcome;
  if (patch.ended_at !== undefined) safePatch.ended_at = patch.ended_at;

  const { error } = await supabase
    .from("live_sessions")
    .update(safePatch)
    .eq("id", id);

  if (error) {
    console.error("updateLiveSession error:", error);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  REALTIME                                                                   */
/* -------------------------------------------------------------------------- */

export function subscribeLiveSession(
  id: string,
  cb: (session: LiveSession) => void
) {
  const channel = supabase
    .channel(`live_session_${id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "live_sessions",
        filter: `id=eq.${id}`,
      },
      (payload) => {
        if (payload.new) cb(payload.new as LiveSession);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeLiveSessionsList(
  cb: (session: LiveSession, eventType: "INSERT" | "UPDATE" | "DELETE") => void
) {
  const channel = supabase
    .channel("live_sessions_list")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "live_sessions",
      },
      (payload) => {
        const eventType = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const session = (payload.new || payload.old) as LiveSession;
        if (session) cb(session, eventType);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
