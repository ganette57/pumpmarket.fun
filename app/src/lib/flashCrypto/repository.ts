import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import type { LiveMicroRow, ResolutionOutcome } from "@/lib/liveMicro/repository";
import {
  FLASH_CRYPTO_GRADUATION_MICRO_TYPE,
  FLASH_CRYPTO_MICRO_TYPE,
  FLASH_CRYPTO_MICRO_TYPES,
} from "./types";

const ALL_CRYPTO_TYPES = [...FLASH_CRYPTO_MICRO_TYPES] as string[];

export async function createFlashCryptoLiveMicroRow(input: {
  tokenMint: string;
  linkedMarketId?: string | null;
  linkedMarketAddress?: string | null;
  windowStartIso: string;
  windowEndIso: string;
  priceStart: number;
  tokenSymbol: string;
  tokenName: string;
  tokenImageUri?: string | null;
  providerName?: string | null;
  startProviderSource?: string | null;
  sourceType?: "pump_fun" | "major" | null;
  majorSymbol?: string | null;
  majorPair?: string | null;
  campaignId: string;
  durationMinutes: number;
  createdByOperatorWallet: string;
}): Promise<LiveMicroRow> {
  return createFlashCryptoLiveMicroRowWithType({
    microType: FLASH_CRYPTO_MICRO_TYPE,
    tokenMint: input.tokenMint,
    linkedMarketId: input.linkedMarketId,
    linkedMarketAddress: input.linkedMarketAddress,
    windowStartIso: input.windowStartIso,
    windowEndIso: input.windowEndIso,
    tokenSymbol: input.tokenSymbol,
    tokenName: input.tokenName,
    tokenImageUri: input.tokenImageUri,
    providerName: input.providerName,
    startProviderSource: input.startProviderSource,
    sourceType: input.sourceType,
    majorSymbol: input.majorSymbol,
    majorPair: input.majorPair,
    campaignId: input.campaignId,
    durationMinutes: input.durationMinutes,
    createdByOperatorWallet: input.createdByOperatorWallet,
    extraStartPayload: {
      price_start: input.priceStart,
    },
  });
}

export async function createFlashCryptoGraduationLiveMicroRow(input: {
  tokenMint: string;
  linkedMarketId?: string | null;
  linkedMarketAddress?: string | null;
  windowStartIso: string;
  windowEndIso: string;
  progressStart: number;
  didGraduateStart: boolean;
  remainingToGraduateStart?: number | null;
  tokenSymbol: string;
  tokenName: string;
  tokenImageUri?: string | null;
  providerName?: string | null;
  startProviderSource?: string | null;
  sourceType?: "pump_fun" | "major" | null;
  majorSymbol?: string | null;
  majorPair?: string | null;
  campaignId: string;
  durationMinutes: number;
  createdByOperatorWallet: string;
}): Promise<LiveMicroRow> {
  return createFlashCryptoLiveMicroRowWithType({
    microType: FLASH_CRYPTO_GRADUATION_MICRO_TYPE,
    tokenMint: input.tokenMint,
    linkedMarketId: input.linkedMarketId,
    linkedMarketAddress: input.linkedMarketAddress,
    windowStartIso: input.windowStartIso,
    windowEndIso: input.windowEndIso,
    tokenSymbol: input.tokenSymbol,
    tokenName: input.tokenName,
    tokenImageUri: input.tokenImageUri,
    providerName: input.providerName,
    startProviderSource: input.startProviderSource,
    sourceType: input.sourceType,
    majorSymbol: input.majorSymbol,
    majorPair: input.majorPair,
    campaignId: input.campaignId,
    durationMinutes: input.durationMinutes,
    createdByOperatorWallet: input.createdByOperatorWallet,
    extraStartPayload: {
      progress_start: input.progressStart,
      did_graduate_start: input.didGraduateStart,
      remaining_to_graduate_start:
        Number.isFinite(Number(input.remainingToGraduateStart)) ? Number(input.remainingToGraduateStart) : null,
    },
  });
}

async function createFlashCryptoLiveMicroRowWithType(input: {
  microType: string;
  tokenMint: string;
  linkedMarketId?: string | null;
  linkedMarketAddress?: string | null;
  windowStartIso: string;
  windowEndIso: string;
  tokenSymbol: string;
  tokenName: string;
  tokenImageUri?: string | null;
  providerName?: string | null;
  startProviderSource?: string | null;
  sourceType?: "pump_fun" | "major" | null;
  majorSymbol?: string | null;
  majorPair?: string | null;
  campaignId: string;
  durationMinutes: number;
  createdByOperatorWallet: string;
  extraStartPayload: Record<string, unknown>;
}): Promise<LiveMicroRow> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();

  const payload = {
    provider_match_id: input.tokenMint,
    provider_name: String(input.providerName || "").trim() || "pump_fun",
    sport: "crypto",
    micro_market_type: input.microType,
    linked_market_id: input.linkedMarketId ?? null,
    linked_market_address: input.linkedMarketAddress ?? null,
    window_start: input.windowStartIso,
    window_end: input.windowEndIso,
    start_home_score: 0,
    start_away_score: 0,
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
    provider_payload_start: {
      type: input.microType,
      campaign_id: input.campaignId,
      token_mint: input.tokenMint,
      token_symbol: input.tokenSymbol,
      token_name: input.tokenName,
      token_image_uri: input.tokenImageUri || null,
      provider_source: String(input.startProviderSource || "").trim() || null,
      source_type: String(input.sourceType || "").trim().toLowerCase() || null,
      major_symbol: String(input.majorSymbol || "").trim().toUpperCase() || null,
      major_pair: String(input.majorPair || "").trim().toUpperCase() || null,
      duration_minutes: input.durationMinutes,
      ...input.extraStartPayload,
    },
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

  if (error) throw new Error(`flash_crypto live_micro_markets insert failed: ${error.message}`);
  return data as LiveMicroRow;
}

export async function upsertFlashCryptoMarketRow(input: {
  marketAddress: string;
  creator: string;
  question: string;
  description: string;
  endDateIso: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  tokenImageUri: string | null;
  priceStart: number;
  providerName?: string | null;
  startProviderSource?: string | null;
  sourceType?: "pump_fun" | "major" | null;
  majorSymbol?: string | null;
  majorPair?: string | null;
  durationMinutes: number;
  campaignId: string;
}): Promise<{ id: string | null; marketAddress: string }> {
  return upsertFlashCryptoMarketRowWithType({
    microType: FLASH_CRYPTO_MICRO_TYPE,
    marketAddress: input.marketAddress,
    creator: input.creator,
    question: input.question,
    description: input.description,
    endDateIso: input.endDateIso,
    tokenMint: input.tokenMint,
    tokenSymbol: input.tokenSymbol,
    tokenName: input.tokenName,
    tokenImageUri: input.tokenImageUri,
    providerName: input.providerName,
    startProviderSource: input.startProviderSource,
    sourceType: input.sourceType,
    majorSymbol: input.majorSymbol,
    majorPair: input.majorPair,
    durationMinutes: input.durationMinutes,
    campaignId: input.campaignId,
    extraSportMeta: {
      price_start: input.priceStart,
    },
  });
}

export async function upsertFlashCryptoGraduationMarketRow(input: {
  marketAddress: string;
  creator: string;
  question: string;
  description: string;
  endDateIso: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  tokenImageUri: string | null;
  progressStart: number;
  didGraduateStart: boolean;
  remainingToGraduateStart?: number | null;
  providerName?: string | null;
  startProviderSource?: string | null;
  sourceType?: "pump_fun" | "major" | null;
  majorSymbol?: string | null;
  majorPair?: string | null;
  durationMinutes: number;
  campaignId: string;
}): Promise<{ id: string | null; marketAddress: string }> {
  return upsertFlashCryptoMarketRowWithType({
    microType: FLASH_CRYPTO_GRADUATION_MICRO_TYPE,
    marketAddress: input.marketAddress,
    creator: input.creator,
    question: input.question,
    description: input.description,
    endDateIso: input.endDateIso,
    tokenMint: input.tokenMint,
    tokenSymbol: input.tokenSymbol,
    tokenName: input.tokenName,
    tokenImageUri: input.tokenImageUri,
    providerName: input.providerName,
    startProviderSource: input.startProviderSource,
    sourceType: input.sourceType,
    majorSymbol: input.majorSymbol,
    majorPair: input.majorPair,
    durationMinutes: input.durationMinutes,
    campaignId: input.campaignId,
    extraSportMeta: {
      progress_start: input.progressStart,
      did_graduate_start: input.didGraduateStart,
      remaining_to_graduate_start:
        Number.isFinite(Number(input.remainingToGraduateStart)) ? Number(input.remainingToGraduateStart) : null,
    },
  });
}

async function upsertFlashCryptoMarketRowWithType(input: {
  microType: string;
  marketAddress: string;
  creator: string;
  question: string;
  description: string;
  endDateIso: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  tokenImageUri: string | null;
  providerName?: string | null;
  startProviderSource?: string | null;
  sourceType?: "pump_fun" | "major" | null;
  majorSymbol?: string | null;
  majorPair?: string | null;
  durationMinutes: number;
  campaignId: string;
  extraSportMeta: Record<string, unknown>;
}): Promise<{ id: string | null; marketAddress: string }> {
  const supabase = supabaseServer();

  const payload: Record<string, unknown> = {
    market_address: input.marketAddress,
    creator: input.creator,
    question: input.question,
    description: input.description,
    category: "crypto",
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
    market_mode: "flash_crypto",
    sport_meta: {
      type: input.microType,
      campaign_id: input.campaignId,
      token_mint: input.tokenMint,
      token_symbol: input.tokenSymbol,
      token_name: input.tokenName,
      token_image_uri: input.tokenImageUri,
      provider_name: String(input.providerName || "").trim() || "pump_fun",
      provider_source_start: String(input.startProviderSource || "").trim() || null,
      source_type: String(input.sourceType || "").trim().toLowerCase() || null,
      major_symbol: String(input.majorSymbol || "").trim().toUpperCase() || null,
      major_pair: String(input.majorPair || "").trim().toUpperCase() || null,
      duration_minutes: input.durationMinutes,
      resolution_status: "open",
      ...input.extraSportMeta,
    },
  };

  if (input.tokenImageUri) {
    payload.image_url = input.tokenImageUri;
  }

  const { data, error } = await supabase
    .from("markets")
    .upsert(payload, { onConflict: "market_address" })
    .select("id,market_address")
    .maybeSingle();

  if (error) throw new Error(`flash_crypto markets upsert failed: ${error.message}`);

  return {
    id: (data as any)?.id ?? null,
    marketAddress: (data as any)?.market_address || input.marketAddress,
  };
}

export async function listFlashCryptoPendingResolution(): Promise<LiveMicroRow[]> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("live_micro_markets")
    .select("*")
    .in("micro_market_type", ALL_CRYPTO_TYPES)
    .eq("engine_status", "active")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`flash_crypto pending list failed: ${error.message}`);
  return (data || []) as LiveMicroRow[];
}

/**
 * Returns true if the campaign has an active micro market that hasn't ended yet.
 * Used by the sequential launcher to avoid creating the next market before the current one finishes.
 */
export async function hasCampaignActiveMarket(campaignId: string): Promise<boolean> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("live_micro_markets")
    .select("id,window_end,provider_payload_start")
    .in("micro_market_type", ALL_CRYPTO_TYPES)
    .eq("engine_status", "active")
    .gt("window_end", nowIso)
    .limit(50);

  if (error) return false;

  // Filter by campaign_id in the JSONB payload
  for (const row of data || []) {
    const payload = (row as any).provider_payload_start;
    const cid = typeof payload === "object" && payload ? payload.campaign_id : null;
    if (cid === campaignId) return true;
  }
  return false;
}

export async function listActiveFlashCryptoMicros(limit = 50): Promise<LiveMicroRow[]> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("live_micro_markets")
    .select("*")
    .in("micro_market_type", ALL_CRYPTO_TYPES)
    .eq("engine_status", "active")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`flash_crypto active list failed: ${error.message}`);
  return (data || []) as LiveMicroRow[];
}

export async function markFlashCryptoResolved(params: {
  id: string;
  outcome: ResolutionOutcome;
  priceEnd: number;
  resolutionStatus?: "pending_admin_confirmation" | "proposed";
  proposalTxSig?: string | null;
  percentChange?: number | null;
  providerSource?: string | null;
}): Promise<void> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();
  const resolutionStatus = params.resolutionStatus || "proposed";

  const { error } = await supabase
    .from("live_micro_markets")
    .update({
      engine_status: "proposed",
      pending_outcome: params.outcome,
      resolution_outcome: params.outcome,
      resolved_at: nowIso,
      updated_at: nowIso,
      provider_payload_end: {
        price_end: params.priceEnd,
        auto_resolved_outcome: params.outcome,
        resolution_status: resolutionStatus,
        proposal_tx_sig: params.proposalTxSig || null,
        percent_change: Number.isFinite(Number(params.percentChange)) ? Number(params.percentChange) : null,
        provider_source: String(params.providerSource || "").trim() || null,
      },
      error_state: null,
      error_message: null,
    })
    .eq("id", params.id);

  if (error) throw new Error(`flash_crypto resolve update failed: ${error.message}`);
}

export async function markFlashCryptoGraduationResolved(params: {
  id: string;
  outcome: ResolutionOutcome;
  progressEnd: number;
  didGraduateEnd: boolean;
  remainingToGraduateEnd?: number | null;
  resolutionStatus?: "pending_admin_confirmation" | "proposed";
  proposalTxSig?: string | null;
  providerSource?: string | null;
}): Promise<void> {
  const supabase = supabaseServer();
  const nowIso = new Date().toISOString();
  const resolutionStatus = params.resolutionStatus || "proposed";

  const { error } = await supabase
    .from("live_micro_markets")
    .update({
      engine_status: "proposed",
      pending_outcome: params.outcome,
      resolution_outcome: params.outcome,
      resolved_at: nowIso,
      updated_at: nowIso,
      provider_payload_end: {
        progress_end: Number(params.progressEnd),
        did_graduate_end: !!params.didGraduateEnd,
        remaining_to_graduate_end:
          Number.isFinite(Number(params.remainingToGraduateEnd)) ? Number(params.remainingToGraduateEnd) : null,
        auto_resolved_outcome: params.outcome,
        resolution_status: resolutionStatus,
        proposal_tx_sig: params.proposalTxSig || null,
        provider_source: String(params.providerSource || "").trim() || null,
      },
      error_state: null,
      error_message: null,
    })
    .eq("id", params.id);

  if (error) throw new Error(`flash_crypto graduation resolve update failed: ${error.message}`);
}

export async function updateFlashCryptoMarketMeta(params: {
  marketAddress: string;
  priceEnd: number;
  autoResolvedOutcome: ResolutionOutcome;
  resolutionStatus?: "pending_admin_confirmation" | "proposed";
  proposalTxSig?: string | null;
  percentChange?: number | null;
  providerSource?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
}): Promise<void> {
  const supabase = supabaseServer();
  const resolutionStatus = params.resolutionStatus || "proposed";

  const { data: existing, error: fetchErr } = await supabase
    .from("markets")
    .select("sport_meta")
    .eq("market_address", params.marketAddress)
    .maybeSingle();

  if (fetchErr) throw new Error(`flash_crypto market meta fetch failed: ${fetchErr.message}`);

  const currentMeta = (existing as any)?.sport_meta || {};
  const nextMeta = {
    ...currentMeta,
    price_end: params.priceEnd,
    auto_resolved_outcome: params.autoResolvedOutcome,
    proposed_outcome: params.autoResolvedOutcome,
    auto_resolved_at: new Date().toISOString(),
    resolution_status: resolutionStatus,
    proposal_tx_sig: params.proposalTxSig || null,
    percent_change: Number.isFinite(Number(params.percentChange)) ? Number(params.percentChange) : null,
    provider_source: String(params.providerSource || "").trim() || null,
    window_start: String(params.windowStart || "").trim() || null,
    window_end: String(params.windowEnd || "").trim() || null,
  };

  const { error } = await supabase
    .from("markets")
    .update({ sport_meta: nextMeta })
    .eq("market_address", params.marketAddress);

  if (error) throw new Error(`flash_crypto market meta update failed: ${error.message}`);
}

export async function updateFlashCryptoGraduationMarketMeta(params: {
  marketAddress: string;
  progressEnd: number;
  didGraduateEnd: boolean;
  remainingToGraduateEnd?: number | null;
  autoResolvedOutcome: ResolutionOutcome;
  resolutionStatus?: "pending_admin_confirmation" | "proposed";
  proposalTxSig?: string | null;
  providerSource?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
}): Promise<void> {
  const supabase = supabaseServer();
  const resolutionStatus = params.resolutionStatus || "proposed";

  const { data: existing, error: fetchErr } = await supabase
    .from("markets")
    .select("sport_meta")
    .eq("market_address", params.marketAddress)
    .maybeSingle();

  if (fetchErr) throw new Error(`flash_crypto graduation meta fetch failed: ${fetchErr.message}`);

  const currentMeta = (existing as any)?.sport_meta || {};
  const nextMeta = {
    ...currentMeta,
    progress_end: Number(params.progressEnd),
    did_graduate_end: !!params.didGraduateEnd,
    remaining_to_graduate_end:
      Number.isFinite(Number(params.remainingToGraduateEnd)) ? Number(params.remainingToGraduateEnd) : null,
    auto_resolved_outcome: params.autoResolvedOutcome,
    proposed_outcome: params.autoResolvedOutcome,
    auto_resolved_at: new Date().toISOString(),
    resolution_status: resolutionStatus,
    proposal_tx_sig: params.proposalTxSig || null,
    provider_source: String(params.providerSource || "").trim() || null,
    window_start: String(params.windowStart || "").trim() || null,
    window_end: String(params.windowEnd || "").trim() || null,
  };

  const { error } = await supabase
    .from("markets")
    .update({ sport_meta: nextMeta })
    .eq("market_address", params.marketAddress);

  if (error) throw new Error(`flash_crypto graduation market meta update failed: ${error.message}`);
}

export async function listFlashCryptoMarketsForExplorer(maxRows: number): Promise<Array<{
  liveMicro: LiveMicroRow;
  market: {
    id: string | null;
    market_address: string;
    question: string | null;
    total_volume: number | null;
    resolution_status: string | null;
    sport_meta: Record<string, unknown> | null;
    image_url: string | null;
    created_at: string | null;
    is_blocked: boolean | null;
    start_time: string | null;
    end_time: string | null;
  } | null;
}>> {
  const supabase = supabaseServer();
  const limit = Math.max(1, Math.min(500, Math.floor(maxRows)));

  const { data: liveRows, error: liveErr } = await supabase
    .from("live_micro_markets")
    .select("*")
    .in("micro_market_type", ALL_CRYPTO_TYPES)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (liveErr) throw new Error(`flash_crypto explorer fetch failed: ${liveErr.message}`);

  const rows = (liveRows || []) as LiveMicroRow[];
  if (!rows.length) return [];

  const addresses = Array.from(
    new Set(rows.map((r) => r.linked_market_address).filter(Boolean) as string[]),
  );

  if (!addresses.length) return rows.map((r) => ({ liveMicro: r, market: null }));

  const { data: marketRows, error: marketErr } = await supabase
    .from("markets")
    .select("id,market_address,question,total_volume,resolution_status,sport_meta,image_url,created_at,is_blocked,start_time,end_time")
    .in("market_address", addresses);

  if (marketErr) throw new Error(`flash_crypto markets fetch failed: ${marketErr.message}`);

  const marketByAddress = new Map<string, any>();
  for (const m of marketRows || []) {
    marketByAddress.set(String((m as any).market_address || ""), m);
  }

  return rows.map((r) => ({
    liveMicro: r,
    market: marketByAddress.get(String(r.linked_market_address || "")) || null,
  }));
}

export async function listRecentFlashCryptoTokenUsage(limit = 120): Promise<Array<{
  tokenMint: string;
  createdAt: string;
  marketAddress: string;
}>> {
  const supabase = supabaseServer();
  const cap = Math.max(10, Math.min(500, Math.floor(limit)));

  const { data, error } = await supabase
    .from("markets")
    .select("market_address,created_at,sport_meta")
    .eq("market_mode", "flash_crypto")
    .order("created_at", { ascending: false })
    .limit(cap);

  if (error) throw new Error(`flash_crypto recent usage fetch failed: ${error.message}`);

  const out: Array<{ tokenMint: string; createdAt: string; marketAddress: string }> = [];
  for (const row of data || []) {
    const meta = ((row as any)?.sport_meta || {}) as Record<string, unknown>;
    const tokenMint = String((meta as any).token_mint || "").trim();
    if (!tokenMint) continue;
    out.push({
      tokenMint,
      createdAt: String((row as any).created_at || ""),
      marketAddress: String((row as any).market_address || ""),
    });
  }
  return out;
}
