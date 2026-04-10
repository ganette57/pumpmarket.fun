import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import { TRAFFIC_FLASH_MARKET_MODE, TRAFFIC_FLASH_TYPE } from "@/lib/traffic/types";

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function upsertTrafficFlashMarketRow(input: {
  marketAddress: string;
  creator: string;
  question: string;
  description: string;
  endDateIso: string;
  roundId: string;
  threshold: number;
  durationSec: number;
  cameraId: string;
  cameraName: string;
  windowStartIso: string;
  windowEndIso: string;
  startCount: number;
}): Promise<{ id: string | null; marketAddress: string }> {
  const supabase = supabaseServer();
  console.log("[traffic-flash:repo] upsert traffic market row", {
    roundId: input.roundId,
    marketAddress: input.marketAddress,
    threshold: input.threshold,
    durationSec: input.durationSec,
    cameraId: input.cameraId,
    startCount: input.startCount,
  });

  const payload: Record<string, unknown> = {
    market_address: input.marketAddress,
    creator: input.creator,
    question: input.question,
    description: input.description,
    category: "traffic",
    end_date: input.endDateIso,
    start_time: null,
    end_time: input.endDateIso,
    market_type: 0,
    outcome_names: ["YES", "NO"],
    outcome_supplies: [0, 0],
    yes_supply: 0,
    no_supply: 0,
    total_volume: 0,
    resolved: false,
    cancelled: false,
    resolution_status: "open",
    contested: false,
    contest_count: 0,
    market_mode: TRAFFIC_FLASH_MARKET_MODE,
    sport_meta: {
      type: TRAFFIC_FLASH_TYPE,
      source: "traffic",
      round_id: input.roundId,
      threshold: input.threshold,
      duration_sec: input.durationSec,
      camera_id: input.cameraId,
      camera_name: input.cameraName,
      window_start: input.windowStartIso,
      window_end: input.windowEndIso,
      start_count: input.startCount,
      current_count: input.startCount,
      resolution_status: "open",
    },
  };

  const { data, error } = await supabase
    .from("markets")
    .upsert(payload, { onConflict: "market_address" })
    .select("id,market_address")
    .maybeSingle();

  if (error) throw new Error(`traffic markets upsert failed: ${error.message}`);

  return {
    id: (data as any)?.id ?? null,
    marketAddress: (data as any)?.market_address || input.marketAddress,
  };
}

export type PendingTrafficResolutionRow = {
  market_address: string;
  sport_meta: Record<string, unknown> | null;
  end_date: string | null;
  question: string | null;
  resolution_status: string | null;
  resolved: boolean | null;
};

export async function listPendingTrafficFlashResolutions(limit = 100): Promise<PendingTrafficResolutionRow[]> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();
  const cap = Math.max(1, Math.min(500, Math.floor(limit)));

  const { data, error } = await supabase
    .from("markets")
    .select("market_address,sport_meta,end_date,question,resolution_status,resolved")
    .eq("market_mode", TRAFFIC_FLASH_MARKET_MODE)
    .eq("resolution_status", "open")
    .eq("resolved", false)
    .lte("end_date", nowIso)
    .order("created_at", { ascending: true })
    .limit(cap);

  if (error) throw new Error(`traffic pending list failed: ${error.message}`);
  console.log("[traffic-flash:repo] pending traffic markets", {
    pendingCount: (data || []).length,
  });
  return (data || []) as PendingTrafficResolutionRow[];
}

export async function updateTrafficFlashMarketMeta(params: {
  marketAddress: string;
  patch: Record<string, unknown>;
}): Promise<void> {
  const supabase = supabaseServer();

  const { data: existing, error: fetchErr } = await supabase
    .from("markets")
    .select("sport_meta")
    .eq("market_address", params.marketAddress)
    .maybeSingle();

  if (fetchErr) throw new Error(`traffic market meta fetch failed: ${fetchErr.message}`);

  const currentMeta = asObject((existing as any)?.sport_meta);
  const nextMeta = {
    ...currentMeta,
    ...params.patch,
  };

  const { error } = await supabase
    .from("markets")
    .update({ sport_meta: nextMeta })
    .eq("market_address", params.marketAddress);

  if (error) throw new Error(`traffic market meta update failed: ${error.message}`);
}

export type TrafficRecentMarket = {
  market_address: string;
  question: string | null;
  created_at: string | null;
  end_date: string | null;
  resolution_status: string | null;
  resolved: boolean | null;
  sport_meta: Record<string, unknown> | null;
};

export type TrafficMarketRuntimeRow = {
  market_address: string;
  end_date: string | null;
  resolution_status: string | null;
  resolved: boolean | null;
  cancelled: boolean | null;
  is_blocked: boolean | null;
  blocked_reason: string | null;
  blocked_at: string | null;
  sport_meta: Record<string, unknown> | null;
};

export async function getTrafficMarketRuntimeByAddress(marketAddress: string): Promise<TrafficMarketRuntimeRow | null> {
  const address = String(marketAddress || "").trim();
  if (!address) return null;
  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("markets")
    .select("market_address,end_date,resolution_status,resolved,cancelled,is_blocked,blocked_reason,blocked_at,sport_meta")
    .eq("market_mode", TRAFFIC_FLASH_MARKET_MODE)
    .eq("market_address", address)
    .maybeSingle();

  if (error) throw new Error(`traffic market runtime fetch failed: ${error.message}`);
  return (data as TrafficMarketRuntimeRow | null) || null;
}

export async function listRecentTrafficFlashMarkets(limit = 20): Promise<TrafficRecentMarket[]> {
  const supabase = supabaseServer();
  const cap = Math.max(1, Math.min(100, Math.floor(limit)));

  const { data, error } = await supabase
    .from("markets")
    .select("market_address,question,created_at,end_date,resolution_status,resolved,sport_meta")
    .eq("market_mode", TRAFFIC_FLASH_MARKET_MODE)
    .order("created_at", { ascending: false })
    .limit(cap);

  if (error) throw new Error(`traffic recent list failed: ${error.message}`);
  return (data || []) as TrafficRecentMarket[];
}

export async function lockTrafficFlashMarketByThreshold(params: {
  marketAddress: string;
  roundId: string;
  currentCount: number;
  threshold: number;
}): Promise<boolean> {
  const marketAddress = String(params.marketAddress || "").trim();
  if (!marketAddress) return false;
  const supabase = supabaseServer();

  const { data: market, error: fetchErr } = await supabase
    .from("markets")
    .select("sport_meta,resolution_status,resolved,cancelled,is_blocked,blocked_reason,blocked_at")
    .eq("market_mode", TRAFFIC_FLASH_MARKET_MODE)
    .eq("market_address", marketAddress)
    .maybeSingle();

  if (fetchErr) throw new Error(`traffic market lock fetch failed: ${fetchErr.message}`);
  if (!market) return false;

  const status = String((market as any).resolution_status || "").trim().toLowerCase();
  const terminal =
    (market as any).resolved === true ||
    (market as any).cancelled === true ||
    status === "finalized" ||
    status === "cancelled" ||
    status === "proposed";
  if (terminal) return false;

  const nowIso = new Date().toISOString();
  const currentMeta = asObject((market as any).sport_meta);
  const alreadyTargetReached = !!currentMeta.target_reached;
  const alreadyBlocked = !!(market as any).is_blocked;
  if (alreadyTargetReached && alreadyBlocked) return false;

  const nextMeta: Record<string, unknown> = {
    ...currentMeta,
    source: "traffic",
    round_id: String(params.roundId || currentMeta.round_id || currentMeta.roundId || "").trim(),
    current_count: Math.max(0, Math.floor(Number(params.currentCount) || 0)),
    threshold: Math.max(1, Math.floor(Number(params.threshold) || 1)),
    target_reached: true,
    target_reached_at: String(currentMeta.target_reached_at || nowIso),
    trading_locked: true,
    trading_locked_at: String(currentMeta.trading_locked_at || nowIso),
    resolution_status: String(currentMeta.resolution_status || "open"),
  };

  const { error: updateErr } = await supabase
    .from("markets")
    .update({
      sport_meta: nextMeta,
      is_blocked: true,
      blocked_reason:
        (market as any).blocked_reason || "Locked by traffic flash engine: threshold reached during active window",
      blocked_at: (market as any).blocked_at || nowIso,
    })
    .eq("market_mode", TRAFFIC_FLASH_MARKET_MODE)
    .eq("market_address", marketAddress);

  if (updateErr) throw new Error(`traffic market lock update failed: ${updateErr.message}`);
  return true;
}
