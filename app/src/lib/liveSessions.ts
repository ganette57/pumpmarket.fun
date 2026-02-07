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
  started_at?: string | null;
  lock_at?: string | null;
  end_at?: string | null;
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
  Pick<
    LiveSession,
    "title" | "stream_url" | "status" | "thumbnail_url" | "pinned_outcome" |
    "started_at" | "lock_at" | "end_at" | "ended_at"
  >
>;

/* -------------------------------------------------------------------------- */
/*  SELECT columns                                                             */
/* -------------------------------------------------------------------------- */

const LIVE_SESSION_COLS =
  "id,created_at,title,market_address,host_wallet,stream_url,status,thumbnail_url,pinned_outcome,started_at,lock_at,end_at,ended_at";

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
): Promise<LiveSession> {
  if (!id) throw new Error("id is required");

  const safePatch: Record<string, unknown> = {};
  if (patch.title !== undefined) safePatch.title = String(patch.title).trim();
  if (patch.stream_url !== undefined) safePatch.stream_url = String(patch.stream_url).trim();
  if (patch.status !== undefined) safePatch.status = patch.status;
  if (patch.thumbnail_url !== undefined) safePatch.thumbnail_url = patch.thumbnail_url;
  if (patch.pinned_outcome !== undefined) safePatch.pinned_outcome = patch.pinned_outcome;

  // Timestamp columns — accept ISO string or null
  if (patch.started_at !== undefined) safePatch.started_at = patch.started_at;
  if (patch.lock_at !== undefined) safePatch.lock_at = patch.lock_at;
  if (patch.end_at !== undefined) safePatch.end_at = patch.end_at;
  if (patch.ended_at !== undefined) safePatch.ended_at = patch.ended_at;

  // Step 1: run the update (no select — avoids "Cannot coerce" on 0/multi rows)
  const { error: updateError } = await supabase
    .from("live_sessions")
    .update(safePatch)
    .eq("id", id);

  if (updateError) {
    console.error("updateLiveSession error:", updateError);
    if (updateError.code === "42501" || updateError.message?.includes("policy")) {
      throw new Error("Permission denied — you may not be the session host, or RLS policies are missing.");
    }
    throw updateError;
  }

  // Step 2: re-fetch the row to return fresh state
  const { data, error: fetchError } = await supabase
    .from("live_sessions")
    .select(LIVE_SESSION_COLS)
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    console.error("updateLiveSession re-fetch error:", fetchError);
    throw fetchError;
  }
  if (!data) {
    throw new Error("Live session not found or permission denied (RLS).");
  }
  return data as LiveSession;
}

/* -------------------------------------------------------------------------- */
/*  DISCOVERABILITY QUERIES                                                    */
/* -------------------------------------------------------------------------- */

const ACTIVE_STATUSES: LiveSessionStatus[] = ["live", "locked"];

/**
 * Returns a map of market_address -> session id for all active live sessions.
 * Used by the home feed to render LIVE badges without N+1 queries.
 */
export async function listActiveLiveSessionsMap(): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("live_sessions")
    .select("id,market_address,status,created_at")
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("listActiveLiveSessionsMap error:", error);
    return {};
  }

  const map: Record<string, string> = {};
  for (const row of (data || []) as { id: string; market_address: string }[]) {
    if (!map[row.market_address]) {
      map[row.market_address] = row.id;
    }
  }
  return map;
}

/**
 * Returns the latest active live session for a specific market, or null.
 * Used by the trade page to show a "Watch Live" banner.
 */
export async function getActiveLiveSessionForMarket(
  marketAddress: string
): Promise<{ id: string; title: string; status: LiveSessionStatus } | null> {
  if (!marketAddress) return null;

  const { data, error } = await supabase
    .from("live_sessions")
    .select("id,title,status")
    .eq("market_address", marketAddress)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getActiveLiveSessionForMarket error:", error);
    return null;
  }
  return data as { id: string; title: string; status: LiveSessionStatus } | null;
}

/* -------------------------------------------------------------------------- */
/*  LIVE ACTIVITY (recent trades for a market)                                 */
/* -------------------------------------------------------------------------- */

export type RecentTrade = {
  id: string;
  created_at: string;
  user_address: string;
  is_buy: boolean;
  is_yes: boolean | null;
  shares: number;
  cost: number;
  outcome_index: number | null;
  outcome_name: string | null;
};

export async function fetchRecentTrades(
  marketAddress: string,
  limit = 20
): Promise<RecentTrade[]> {
  if (!marketAddress) return [];
  const { data, error } = await supabase
    .from("transactions")
    .select("id,created_at,user_address,is_buy,is_yes,shares,cost,outcome_index,outcome_name")
    .eq("market_address", marketAddress)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("fetchRecentTrades error:", error);
    return [];
  }
  return (data as RecentTrade[]) || [];
}

export function subscribeRecentTrades(
  marketAddress: string,
  cb: (trade: RecentTrade) => void
) {
  const channel = supabase
    .channel(`live_trades_${marketAddress}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "transactions",
        filter: `market_address=eq.${marketAddress}`,
      },
      (payload) => {
        if (payload.new) cb(payload.new as RecentTrade);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
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
