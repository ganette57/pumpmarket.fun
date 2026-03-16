import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";

export const LIVE_MICRO_TYPE = "soccer_next_goal_5m";
export const LIVE_MICRO_SPORT = "soccer";

export type ResolutionOutcome = "YES" | "NO";

export type LiveMicroRow = {
  id: string;
  provider_match_id: string;
  provider_name: string;
  sport: string;
  micro_market_type: string;
  linked_market_id: string | null;
  linked_market_address: string | null;
  window_start: string;
  window_end: string;
  start_home_score: number;
  start_away_score: number;
  end_home_score: number | null;
  end_away_score: number | null;
  last_polled_at: string | null;
  goal_observed: boolean | null;
  goal_observed_at: string | null;
  trading_locked_at: string | null;
  pending_outcome: ResolutionOutcome | null;
  engine_status: string;
  resolution_outcome: ResolutionOutcome | null;
  created_by_operator_wallet: string;
  provider_payload_start: Record<string, unknown> | null;
  provider_payload_end: Record<string, unknown> | null;
  error_state: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type LiveMicroLoopStatus = "active" | "halftime" | "ended" | "error";
export type LiveMicroLoopPhase = "first_half" | "halftime" | "second_half" | "ended";

export type LiveMicroMatchLoopRow = {
  id: string;
  provider_match_id: string;
  provider_name: string;
  sport: string;
  loop_status: LiveMicroLoopStatus;
  loop_phase: LiveMicroLoopPhase;
  first_half_count: number;
  second_half_count: number;
  halftime_started_at: string | null;
  activated_at: string;
  activated_by: string | null;
  scheduled_start_time: string | null;
  last_snapshot_payload: Record<string, unknown> | null;
  stop_reason: string | null;
  current_active_live_micro_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type LiveMicroLoopStepRef = {
  loopId: string;
  loopPhase: "first_half" | "second_half";
  loopSequence: number;
};

export async function getLiveMicroMatchLoopById(id: string): Promise<LiveMicroMatchLoopRow | null> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("live_micro_match_loops")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`live_micro_match_loops fetch failed: ${error.message}`);
  return (data as LiveMicroMatchLoopRow | null) || null;
}

export async function findLiveMicroMatchLoopByMatch(params: {
  providerMatchId: string;
  providerName: string;
}): Promise<LiveMicroMatchLoopRow | null> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("live_micro_match_loops")
    .select("*")
    .eq("provider_match_id", params.providerMatchId)
    .eq("provider_name", params.providerName)
    .eq("sport", LIVE_MICRO_SPORT)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`live_micro_match_loops lookup failed: ${error.message}`);
  return (data as LiveMicroMatchLoopRow | null) || null;
}

export async function listRunnableLiveMicroMatchLoops(limit = 20): Promise<LiveMicroMatchLoopRow[]> {
  const supabase = supabaseServer();
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  const { data, error } = await supabase
    .from("live_micro_match_loops")
    .select("*")
    .eq("sport", LIVE_MICRO_SPORT)
    .in("loop_status", ["active", "halftime"])
    .order("loop_status", { ascending: true })
    .order("current_active_live_micro_id", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(n);

  if (error) throw new Error(`live_micro_match_loops list failed: ${error.message}`);
  return (data || []) as LiveMicroMatchLoopRow[];
}

export async function listRecentLiveMicroMatchLoops(limit = 20): Promise<LiveMicroMatchLoopRow[]> {
  const supabase = supabaseServer();
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  const { data, error } = await supabase
    .from("live_micro_match_loops")
    .select("*")
    .eq("sport", LIVE_MICRO_SPORT)
    .order("updated_at", { ascending: false })
    .limit(n);

  if (error) throw new Error(`live_micro_match_loops recent list failed: ${error.message}`);
  return (data || []) as LiveMicroMatchLoopRow[];
}

export async function countRunnableLiveMicroMatchLoops(): Promise<number> {
  const supabase = supabaseServer();
  const { count, error } = await supabase
    .from("live_micro_match_loops")
    .select("id", { count: "exact", head: true })
    .eq("sport", LIVE_MICRO_SPORT)
    .in("loop_status", ["active", "halftime"]);

  if (error) throw new Error(`live_micro_match_loops count failed: ${error.message}`);
  return Number(count || 0);
}

export async function activateLiveMicroMatchLoop(params: {
  providerMatchId: string;
  providerName: string;
  activatedBy?: string | null;
  scheduledStartTimeIso?: string | null;
  lastSnapshotPayload?: Record<string, unknown> | null;
}): Promise<LiveMicroMatchLoopRow> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();

  const payload: Record<string, unknown> = {
    provider_match_id: params.providerMatchId,
    provider_name: params.providerName,
    sport: LIVE_MICRO_SPORT,
    loop_status: "active",
    loop_phase: "first_half",
    first_half_count: 0,
    second_half_count: 0,
    halftime_started_at: null,
    activated_at: nowIso,
    activated_by: params.activatedBy || null,
    last_snapshot_payload: params.lastSnapshotPayload ?? null,
    stop_reason: null,
    current_active_live_micro_id: null,
    error_message: null,
    updated_at: nowIso,
  };
  if (params.scheduledStartTimeIso) {
    payload.scheduled_start_time = params.scheduledStartTimeIso;
  }

  const { data, error } = await supabase
    .from("live_micro_match_loops")
    .upsert(payload, { onConflict: "provider_match_id,provider_name,sport" })
    .select("*")
    .single();

  if (error) throw new Error(`live_micro_match_loops activate failed: ${error.message}`);
  return data as LiveMicroMatchLoopRow;
}

export async function updateLiveMicroMatchLoop(params: {
  id: string;
  loopStatus?: LiveMicroLoopStatus;
  loopPhase?: LiveMicroLoopPhase;
  firstHalfCount?: number;
  secondHalfCount?: number;
  halftimeStartedAtIso?: string | null;
  scheduledStartTimeIso?: string | null;
  currentActiveLiveMicroId?: string | null;
  lastSnapshotPayload?: Record<string, unknown> | null;
  stopReason?: string | null;
  errorMessage?: string | null;
}): Promise<LiveMicroMatchLoopRow> {
  const supabase = supabaseServer();
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (params.loopStatus) patch.loop_status = params.loopStatus;
  if (params.loopPhase) patch.loop_phase = params.loopPhase;
  if (typeof params.firstHalfCount === "number") patch.first_half_count = Math.max(0, Math.floor(params.firstHalfCount));
  if (typeof params.secondHalfCount === "number") patch.second_half_count = Math.max(0, Math.floor(params.secondHalfCount));
  if (params.halftimeStartedAtIso !== undefined) patch.halftime_started_at = params.halftimeStartedAtIso;
  if (params.scheduledStartTimeIso !== undefined && params.scheduledStartTimeIso !== null) {
    patch.scheduled_start_time = params.scheduledStartTimeIso;
  }
  if (params.currentActiveLiveMicroId !== undefined) patch.current_active_live_micro_id = params.currentActiveLiveMicroId;
  if (params.lastSnapshotPayload !== undefined) patch.last_snapshot_payload = params.lastSnapshotPayload;
  if (params.stopReason !== undefined) patch.stop_reason = params.stopReason;
  if (params.errorMessage !== undefined) patch.error_message = params.errorMessage;

  const { data, error } = await supabase
    .from("live_micro_match_loops")
    .update(patch)
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) throw new Error(`live_micro_match_loops update failed: ${error.message}`);
  return data as LiveMicroMatchLoopRow;
}

export async function tryTouchLiveMicroMatchLoop(params: {
  id: string;
  expectedUpdatedAt: string;
}): Promise<LiveMicroMatchLoopRow | null> {
  const id = String(params.id || "").trim();
  const expectedUpdatedAt = String(params.expectedUpdatedAt || "").trim();
  if (!id || !expectedUpdatedAt) return null;

  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("live_micro_match_loops")
    .update({
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .in("loop_status", ["active", "halftime"])
    .select("*")
    .maybeSingle();

  if (error) throw new Error(`live_micro_match_loops touch failed: ${error.message}`);
  return (data as LiveMicroMatchLoopRow | null) || null;
}

export async function findActiveLiveMicroByMatch(params: {
  providerMatchId: string;
  providerName: string;
}): Promise<LiveMicroRow | null> {
  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("live_micro_markets")
    .select("*")
    .eq("provider_match_id", params.providerMatchId)
    .eq("provider_name", params.providerName)
    .eq("micro_market_type", LIVE_MICRO_TYPE)
    .eq("engine_status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`live_micro_markets lookup failed: ${error.message}`);
  return (data as LiveMicroRow | null) || null;
}

export async function getLiveMicroById(id: string): Promise<LiveMicroRow | null> {
  const supabase = supabaseServer();
  const { data, error } = await supabase.from("live_micro_markets").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`live_micro_markets fetch failed: ${error.message}`);
  return (data as LiveMicroRow | null) || null;
}

export async function listActiveLiveMicros(limit = 20): Promise<LiveMicroRow[]> {
  const supabase = supabaseServer();
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  const { data, error } = await supabase
    .from("live_micro_markets")
    .select("*")
    .eq("micro_market_type", LIVE_MICRO_TYPE)
    .eq("engine_status", "active")
    .order("created_at", { ascending: true })
    .limit(n);

  if (error) throw new Error(`live_micro_markets list failed: ${error.message}`);
  return (data || []) as LiveMicroRow[];
}

function parseLoopStepFromPayload(payloadStart: Record<string, unknown> | null): LiveMicroLoopStepRef | null {
  const payload = asObject(payloadStart);
  const loopContext = asObject(payload.loop_context);
  const loopId = String(loopContext.id || "").trim();
  const phase = String(loopContext.phase || "").trim();
  const sequence = Number(loopContext.sequence);
  if (!loopId) return null;
  if (phase !== "first_half" && phase !== "second_half") return null;
  if (!Number.isFinite(sequence)) return null;
  return {
    loopId,
    loopPhase: phase,
    loopSequence: Math.max(1, Math.floor(sequence)),
  };
}

export async function findRecentLiveMicroForLoopStep(params: {
  providerMatchId: string;
  providerName: string;
  loopId: string;
  loopPhase: "first_half" | "second_half";
  loopSequence: number;
  limit?: number;
}): Promise<LiveMicroRow | null> {
  const supabase = supabaseServer();
  const n = Math.max(1, Math.min(100, Math.floor(params.limit || 40)));

  const { data, error } = await supabase
    .from("live_micro_markets")
    .select("*")
    .eq("provider_match_id", params.providerMatchId)
    .eq("provider_name", params.providerName)
    .eq("micro_market_type", LIVE_MICRO_TYPE)
    .order("created_at", { ascending: false })
    .limit(n);

  if (error) throw new Error(`live_micro_markets step lookup failed: ${error.message}`);

  const rows = (data || []) as LiveMicroRow[];
  for (const row of rows) {
    const loopStep = parseLoopStepFromPayload(row.provider_payload_start);
    if (!loopStep) continue;
    if (
      loopStep.loopId === params.loopId &&
      loopStep.loopPhase === params.loopPhase &&
      loopStep.loopSequence === Math.max(1, Math.floor(params.loopSequence))
    ) {
      return row;
    }
  }

  return null;
}

export async function createLiveMicroRow(input: {
  providerMatchId: string;
  providerName: string;
  linkedMarketId?: string | null;
  linkedMarketAddress?: string | null;
  windowStartIso: string;
  windowEndIso: string;
  startHomeScore: number;
  startAwayScore: number;
  createdByOperatorWallet: string;
  payloadStart: Record<string, unknown>;
}): Promise<LiveMicroRow> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();

  const payload = {
    provider_match_id: input.providerMatchId,
    provider_name: input.providerName,
    sport: LIVE_MICRO_SPORT,
    micro_market_type: LIVE_MICRO_TYPE,
    linked_market_id: input.linkedMarketId ?? null,
    linked_market_address: input.linkedMarketAddress ?? null,
    window_start: input.windowStartIso,
    window_end: input.windowEndIso,
    start_home_score: Math.floor(input.startHomeScore),
    start_away_score: Math.floor(input.startAwayScore),
    end_home_score: null,
    end_away_score: null,
    last_polled_at: null,
    goal_observed: false,
    goal_observed_at: null,
    trading_locked_at: null,
    pending_outcome: null,
    engine_status: "active",
    resolution_outcome: null,
    created_by_operator_wallet: input.createdByOperatorWallet,
    provider_payload_start: input.payloadStart,
    provider_payload_end: null,
    error_state: null,
    error_message: null,
    resolved_at: null,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from("live_micro_markets")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(`live_micro_markets insert failed: ${error.message}`);
  return data as LiveMicroRow;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function markGoalObservedAndLockTrading(params: {
  id: string;
  linkedMarketAddress?: string | null;
  goalObservedAtIso?: string | null;
  tradingLockedAtIso?: string | null;
}): Promise<void> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();
  const goalObservedAtIso = params.goalObservedAtIso || nowIso;
  const tradingLockedAtIso = params.tradingLockedAtIso || nowIso;

  const { error: microError } = await supabase
    .from("live_micro_markets")
    .update({
      goal_observed: true,
      goal_observed_at: goalObservedAtIso,
      pending_outcome: "YES",
      trading_locked_at: tradingLockedAtIso,
      updated_at: nowIso,
      error_state: null,
      error_message: null,
    })
    .eq("id", params.id);

  if (microError) throw new Error(`live_micro_markets goal lock update failed: ${microError.message}`);

  const marketAddress = String(params.linkedMarketAddress || "").trim();
  if (!marketAddress) return;

  const { data: market, error: marketFetchErr } = await supabase
    .from("markets")
    .select("sport_meta,is_blocked,blocked_reason,blocked_at")
    .eq("market_address", marketAddress)
    .maybeSingle();

  if (marketFetchErr) throw new Error(`markets lock fetch failed: ${marketFetchErr.message}`);

  const currentMeta = asObject((market as any)?.sport_meta);
  const currentLiveMicroMeta = asObject(currentMeta.live_micro);

  const nextSportMeta: Record<string, unknown> = {
    ...currentMeta,
    trading_locked: true,
    trading_locked_at: tradingLockedAtIso,
    live_micro: {
      ...currentLiveMicroMeta,
      goal_observed: true,
      goal_observed_at: goalObservedAtIso,
      pending_outcome: "YES",
      trading_locked: true,
      trading_locked_at: tradingLockedAtIso,
    },
  };

  const patch: Record<string, unknown> = {
    sport_meta: nextSportMeta,
    is_blocked: true,
    blocked_reason: (market as any)?.blocked_reason || "Locked by live micro engine: goal observed during active window",
    blocked_at: (market as any)?.blocked_at || tradingLockedAtIso,
  };

  const { error: marketUpdateErr } = await supabase
    .from("markets")
    .update(patch)
    .eq("market_address", marketAddress);

  if (marketUpdateErr) throw new Error(`markets lock update failed: ${marketUpdateErr.message}`);
}

export async function updateLiveMicroSnapshot(params: {
  id: string;
  homeScore: number;
  awayScore: number;
  payloadEnd: Record<string, unknown>;
  errorState?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();

  const patch = {
    end_home_score: Math.floor(params.homeScore),
    end_away_score: Math.floor(params.awayScore),
    provider_payload_end: params.payloadEnd,
    last_polled_at: nowIso,
    updated_at: nowIso,
    error_state: params.errorState ?? null,
    error_message: params.errorMessage ?? null,
  };

  const { error } = await supabase.from("live_micro_markets").update(patch).eq("id", params.id);
  if (error) throw new Error(`live_micro_markets snapshot update failed: ${error.message}`);
}

export async function markLiveMicroResolved(params: {
  id: string;
  outcome: ResolutionOutcome;
  homeScore: number;
  awayScore: number;
  payloadEnd: Record<string, unknown>;
}): Promise<void> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();

  const patch = {
    end_home_score: Math.floor(params.homeScore),
    end_away_score: Math.floor(params.awayScore),
    provider_payload_end: params.payloadEnd,
    last_polled_at: nowIso,
    engine_status: "proposed",
    pending_outcome: params.outcome,
    resolution_outcome: params.outcome,
    resolved_at: nowIso,
    updated_at: nowIso,
    error_state: null,
    error_message: null,
  };

  const { error } = await supabase.from("live_micro_markets").update(patch).eq("id", params.id);
  if (error) throw new Error(`live_micro_markets resolve update failed: ${error.message}`);
}

export async function markLiveMicroError(params: {
  id: string;
  errorState: string;
  errorMessage: string;
}): Promise<void> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("live_micro_markets")
    .update({
      error_state: params.errorState,
      error_message: params.errorMessage,
      updated_at: nowIso,
    })
    .eq("id", params.id);

  if (error) throw new Error(`live_micro_markets error update failed: ${error.message}`);
}

export async function upsertLinkedMarketRow(input: {
  marketAddress: string;
  creator: string;
  question: string;
  description: string;
  endDateIso: string;
  sportMeta: Record<string, unknown>;
  sportEventId?: string | null;
}): Promise<{ id: string | null; marketAddress: string }> {
  const supabase = supabaseServer();

  const payload: Record<string, unknown> = {
    market_address: input.marketAddress,
    creator: input.creator,
    question: input.question,
    description: input.description,
    category: "sports",
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
    resolution_status: "open",
    contested: false,
    contest_count: 0,
    market_mode: "sport_live",
    sport_meta: input.sportMeta,
  };

  if (input.sportEventId) payload.sport_event_id = input.sportEventId;

  const { data, error } = await supabase
    .from("markets")
    .upsert(payload, { onConflict: "market_address" })
    .select("id,market_address")
    .maybeSingle();

  if (error) throw new Error(`markets upsert failed: ${error.message}`);

  return {
    id: (data as any)?.id ?? null,
    marketAddress: (data as any)?.market_address || input.marketAddress,
  };
}

export async function findSportEventIdByProviderMatchId(providerMatchId: string): Promise<string | null> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("sport_events")
    .select("id")
    .eq("provider_event_id", providerMatchId)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return (data as any)?.id ?? null;
}

export async function persistResolutionProposalToMarkets(input: {
  marketAddress: string;
  proposedWinningOutcome: number;
  contestDeadlineIso: string;
  proposedProofNote: string;
}): Promise<void> {
  const supabase = supabaseServer();

  const patch = {
    resolution_status: "proposed",
    proposed_winning_outcome: Math.floor(input.proposedWinningOutcome),
    resolution_proposed_at: new Date().toISOString(),
    contest_deadline: input.contestDeadlineIso,
    contested: false,
    contest_count: 0,
    proposed_proof_url: null,
    proposed_proof_image: null,
    proposed_proof_note: input.proposedProofNote,
  };

  const { error } = await supabase
    .from("markets")
    .update(patch)
    .eq("market_address", input.marketAddress);

  if (error) throw new Error(`markets proposal update failed: ${error.message}`);
}
