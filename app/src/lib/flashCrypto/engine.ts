import "server-only";

import { assertLiveMicroGuards } from "@/lib/liveMicro/config";
import {
  createBinaryMarketOnchain,
  getOperatorPublicKeyBase58,
  proposeResolutionOnchain,
} from "@/lib/liveMicro/operator";
import { persistResolutionProposalToMarkets } from "@/lib/liveMicro/repository";

import { parsePumpTokenInput } from "./pumpToken";
import {
  getFlashCryptoEndSnapshot,
  getFlashCryptoLivePrice,
  getFlashCryptoStartSnapshot,
} from "./priceSource";
import {
  createFlashCryptoLiveMicroRow,
  upsertFlashCryptoMarketRow,
  listActiveFlashCryptoMicros,
  markFlashCryptoResolved,
  updateFlashCryptoMarketMeta,
  hasCampaignActiveMarket,
} from "./repository";
import {
  FLASH_CRYPTO_MICRO_TYPE,
  type FlashCryptoCampaign,
  type FlashCryptoCampaignStatus,
  type FlashCryptoPendingResolution,
} from "./types";
import type { LiveMicroRow } from "@/lib/liveMicro/repository";

// ── In-memory campaign store (like sports auto-tick) ──

const CAMPAIGNS_KEY = Symbol.for("FUNMARKET_FLASH_CRYPTO_CAMPAIGNS");

function getCampaignStore(): Map<string, FlashCryptoCampaign> {
  const host = (typeof process !== "undefined" ? process : globalThis) as any;
  if (!host[CAMPAIGNS_KEY]) {
    host[CAMPAIGNS_KEY] = new Map<string, FlashCryptoCampaign>();
  }
  return host[CAMPAIGNS_KEY] as Map<string, FlashCryptoCampaign>;
}

function generateId(): string {
  return `fcc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function log(msg: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.log(`[flash-crypto] ${msg}`, payload);
    return;
  }
  console.log(`[flash-crypto] ${msg}`);
}

// ── Campaign Management ──

export type StartCampaignInput = {
  tokenMint: string;
  durationMinutes: 1 | 3 | 5;
  totalMarkets: number;
  launchIntervalMinutes?: number;
};

export type StartCampaignResult = {
  campaign: FlashCryptoCampaign;
  firstMarket: CreateFlashCryptoMarketResult | null;
};

export async function startFlashCryptoCampaign(input: StartCampaignInput): Promise<StartCampaignResult> {
  assertLiveMicroGuards({ requireOperator: true });

  const tokenMint = parsePumpTokenInput(input.tokenMint);

  const durationMinutes = input.durationMinutes;
  if (![1, 3, 5].includes(durationMinutes)) {
    throw new Error("durationMinutes must be 1, 3, or 5");
  }

  const totalMarkets = Math.max(1, Math.min(100, Math.floor(input.totalMarkets || 1)));
  const launchIntervalMinutes = Math.max(1, Math.min(60, Math.floor(input.launchIntervalMinutes ?? durationMinutes)));

  // Fetch token info
  const token = await getFlashCryptoLivePrice(tokenMint);

  const id = generateId();
  const nowMs = Date.now();

  const campaign: FlashCryptoCampaign = {
    id,
    type: "flash_crypto_price",
    status: "running",
    tokenMint: token.mint,
    tokenSymbol: token.symbol,
    tokenName: token.name,
    tokenImageUri: token.imageUri,
    durationMinutes,
    launchIntervalMinutes,
    totalMarkets,
    launchedCount: 0,
    nextLaunchAt: nowMs, // Launch first market immediately
    startedAt: new Date(nowMs).toISOString(),
    stoppedAt: null,
    lastError: null,
    marketIds: [],
  };

  getCampaignStore().set(id, campaign);
  log("campaign started", { id, tokenMint, totalMarkets, durationMinutes });

  // Launch first market immediately
  let firstMarket: CreateFlashCryptoMarketResult | null = null;
  try {
    firstMarket = await createFlashCryptoPriceMarket(campaign);
    campaign.launchedCount++;
    campaign.nextLaunchAt = nowMs + launchIntervalMinutes * 60_000;
    campaign.marketIds.push(firstMarket.marketAddress);
    log("first market created", { campaignId: id, marketAddress: firstMarket.marketAddress });
  } catch (e: any) {
    campaign.lastError = String(e?.message || e || "Failed to create first market");
    log("first market failed", { campaignId: id, error: campaign.lastError });
  }

  return { campaign, firstMarket };
}

export function stopFlashCryptoCampaign(campaignId: string): FlashCryptoCampaign | null {
  const store = getCampaignStore();
  const campaign = store.get(campaignId);
  if (!campaign) return null;
  campaign.status = "stopped";
  campaign.stoppedAt = new Date().toISOString();
  log("campaign stopped", { id: campaignId });
  return campaign;
}

export function getFlashCryptoCampaign(campaignId: string): FlashCryptoCampaign | null {
  return getCampaignStore().get(campaignId) || null;
}

export function listFlashCryptoCampaigns(): FlashCryptoCampaign[] {
  return Array.from(getCampaignStore().values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}

// ── Market Creation ──

export type CreateFlashCryptoMarketResult = {
  liveMicroId: string;
  marketAddress: string;
  marketId: string | null;
  createTxSig: string;
  windowStart: string;
  windowEnd: string;
  priceStart: number;
};

export async function createFlashCryptoPriceMarket(
  campaign: FlashCryptoCampaign,
): Promise<CreateFlashCryptoMarketResult> {
  assertLiveMicroGuards({ requireOperator: true });

  const token = await getFlashCryptoStartSnapshot(campaign.tokenMint);
  const priceStart = token.price;
  const tokenSymbol = String(token.symbol || campaign.tokenSymbol || token.mint.slice(0, 6)).trim();
  const tokenName = String(token.name || campaign.tokenName || tokenSymbol).trim();
  const tokenImageUri = token.imageUri || campaign.tokenImageUri || null;

  const windowStartIso = new Date().toISOString();
  const windowEndMs = Date.now() + campaign.durationMinutes * 60_000;
  const windowEndIso = new Date(windowEndMs).toISOString();
  const resolutionTimeSec = Math.floor(windowEndMs / 1000);

  const createResult = await createBinaryMarketOnchain({
    resolutionTimeSec,
    outcomes: ["YES", "NO"],
  });

  const operatorWallet = getOperatorPublicKeyBase58();
  if (!operatorWallet) throw new Error("Operator wallet unavailable");

  const question = `Will $${tokenSymbol} go UP in ${campaign.durationMinutes} minutes?`;
  const description = [
    `Flash Crypto Price Market`,
    `Token: $${tokenSymbol} (${tokenName})`,
    `Mint: ${token.mint}`,
    `Start Price: ${priceStart}`,
    `Start Source: ${token.source}`,
    `Duration: ${campaign.durationMinutes}m`,
    `Campaign: ${campaign.id}`,
  ].join("\n");

  const marketRow = await upsertFlashCryptoMarketRow({
    marketAddress: createResult.marketAddress,
    creator: operatorWallet,
    question,
    description,
    endDateIso: windowEndIso,
    tokenMint: token.mint,
    tokenSymbol,
    tokenName,
    tokenImageUri,
    priceStart,
    providerName: token.provider,
    startProviderSource: token.source,
    durationMinutes: campaign.durationMinutes,
    campaignId: campaign.id,
  });

  let row: LiveMicroRow;
  try {
    row = await createFlashCryptoLiveMicroRow({
      tokenMint: token.mint,
      linkedMarketId: marketRow.id,
      linkedMarketAddress: marketRow.marketAddress,
      windowStartIso,
      windowEndIso,
      priceStart,
      tokenSymbol,
      tokenName,
      tokenImageUri,
      providerName: token.provider,
      startProviderSource: token.source,
      campaignId: campaign.id,
      durationMinutes: campaign.durationMinutes,
      createdByOperatorWallet: operatorWallet,
    });
  } catch (lmErr: any) {
    // Cleanup orphan market row to avoid ghost entries
    log("live_micro_markets insert failed, cleaning up orphan market", {
      marketAddress: marketRow.marketAddress,
      error: String(lmErr?.message || lmErr),
    });
    try {
      const sb = (await import("@/lib/supabaseServer")).supabaseServer();
      await sb.from("markets").delete().eq("market_address", marketRow.marketAddress);
    } catch {
      // best-effort cleanup
    }
    throw new Error(
      `live_micro_markets insert failed: ${String(lmErr?.message || lmErr)}. ` +
      `Hint: run the migration in docs/migration-flash-crypto-constraints.sql to allow flash_crypto_price type.`,
    );
  }

  return {
    liveMicroId: row.id,
    marketAddress: marketRow.marketAddress,
    marketId: marketRow.id,
    createTxSig: createResult.txSig,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    priceStart,
  };
}

// ── Campaign Runner (called by auto-tick) ──

export async function tickFlashCryptoCampaigns(): Promise<{
  campaignsProcessed: number;
  marketsCreated: number;
  errors: string[];
}> {
  const store = getCampaignStore();
  const nowMs = Date.now();
  let campaignsProcessed = 0;
  let marketsCreated = 0;
  const errors: string[] = [];

  for (const campaign of Array.from(store.values())) {
    if (campaign.status !== "running") continue;

    // Check if campaign is complete
    if (campaign.launchedCount >= campaign.totalMarkets) {
      campaign.status = "completed";
      log("campaign completed", { id: campaign.id, launchedCount: campaign.launchedCount });
      continue;
    }

    // SEQUENTIAL: skip if previous market is still active (window not ended)
    try {
      const hasActive = await hasCampaignActiveMarket(campaign.id);
      if (hasActive) continue; // wait for current market to finish
    } catch {
      // If check fails, skip this tick to be safe
      continue;
    }

    campaignsProcessed++;

    try {
      const result = await createFlashCryptoPriceMarket(campaign);
      campaign.launchedCount++;
      campaign.marketIds.push(result.marketAddress);
      campaign.lastError = null;
      marketsCreated++;
      log("campaign market created", {
        campaignId: campaign.id,
        marketAddress: result.marketAddress,
        launchedCount: campaign.launchedCount,
        totalMarkets: campaign.totalMarkets,
      });
    } catch (e: any) {
      const errMsg = String(e?.message || e || "Unknown error creating flash crypto market");
      campaign.lastError = errMsg;
      errors.push(`campaign=${campaign.id}: ${errMsg}`);
      log("campaign market creation failed", { campaignId: campaign.id, error: errMsg });
    }
  }

  return { campaignsProcessed, marketsCreated, errors };
}

// ── Auto-Resolve (called by auto-tick) ──

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function tickFlashCryptoResolutions(): Promise<{
  resolved: number;
  pending: FlashCryptoPendingResolution[];
  errors: string[];
}> {
  const nowMs = Date.now();
  let resolved = 0;
  const pending: FlashCryptoPendingResolution[] = [];
  const errors: string[] = [];

  const activeMicros = await listActiveFlashCryptoMicros(50);

  for (const row of activeMicros) {
    const windowEndMs = new Date(row.window_end).getTime();
    if (!Number.isFinite(windowEndMs) || nowMs < windowEndMs) continue;

    // Already resolved
    if (row.resolution_outcome) continue;

    const payloadStart = asObject(row.provider_payload_start);
    if (payloadStart.type !== FLASH_CRYPTO_MICRO_TYPE) continue;

    const priceStart = Number(payloadStart.price_start);
    if (!Number.isFinite(priceStart) || priceStart <= 0) {
      errors.push(`row=${row.id}: invalid price_start`);
      continue;
    }

    const tokenMint = String(payloadStart.token_mint || "");
    if (!tokenMint) {
      errors.push(`row=${row.id}: missing token_mint`);
      continue;
    }

    try {
      const endSnapshot = await getFlashCryptoEndSnapshot(tokenMint);
      const priceEnd = endSnapshot.price;
      const autoResolvedOutcome: "YES" | "NO" = priceEnd > priceStart ? "YES" : "NO";
      const percentChange = ((priceEnd - priceStart) / priceStart) * 100;
      const marketAddress = String(row.linked_market_address || "").trim();
      if (!marketAddress) {
        errors.push(`row=${row.id}: missing linked_market_address`);
        continue;
      }

      const outcomeIndex: 0 | 1 = autoResolvedOutcome === "YES" ? 0 : 1;
      const proposal = await proposeResolutionOnchain({
        marketAddress,
        outcomeIndex,
      });

      const proofNote = JSON.stringify({
        source: "flash_crypto_price_auto_tick",
        live_micro_id: row.id,
        market_address: marketAddress,
        token_mint: tokenMint,
        price_start: priceStart,
        start_provider_source: String(payloadStart.provider_source || "").trim() || null,
        price_end: priceEnd,
        percent_change: percentChange,
        outcome: autoResolvedOutcome,
        proposed_outcome: autoResolvedOutcome,
        window_start: row.window_start,
        window_end: row.window_end,
        provider: endSnapshot.provider,
        provider_source: endSnapshot.source,
        onchain_tx_sig: proposal.txSig,
      });

      await persistResolutionProposalToMarkets({
        marketAddress,
        proposedWinningOutcome: proposal.proposedOutcome,
        contestDeadlineIso: proposal.contestDeadlineIso,
        proposedProofNote: proofNote,
      });

      await markFlashCryptoResolved({
        id: row.id,
        outcome: autoResolvedOutcome,
        priceEnd,
        resolutionStatus: "proposed",
        proposalTxSig: proposal.txSig,
        percentChange,
        providerSource: endSnapshot.source,
      });

      await updateFlashCryptoMarketMeta({
        marketAddress,
        priceEnd,
        autoResolvedOutcome,
        resolutionStatus: "proposed",
        proposalTxSig: proposal.txSig,
        percentChange,
        providerSource: endSnapshot.source,
        windowStart: row.window_start,
        windowEnd: row.window_end,
      });

      resolved++;

      pending.push({
        marketAddress,
        marketId: row.linked_market_id,
        liveMicroId: row.id,
        tokenMint,
        tokenSymbol: String(payloadStart.token_symbol || ""),
        tokenName: String(payloadStart.token_name || ""),
        priceStart,
        priceEnd,
        durationMinutes: Number(payloadStart.duration_minutes || 0),
        autoResolvedOutcome,
        resolutionStatus: "proposed",
        windowEnd: row.window_end,
        resolvedAt: new Date().toISOString(),
      });

      log("auto-resolved", {
        liveMicroId: row.id,
        tokenMint,
        priceStart,
        priceEnd,
        outcome: autoResolvedOutcome,
        txSig: proposal.txSig,
      });
    } catch (e: any) {
      errors.push(`row=${row.id}: ${String(e?.message || e)}`);
    }
  }

  return { resolved, pending, errors };
}

// ── Admin Confirm Resolution ──

export async function confirmFlashCryptoResolution(params: {
  marketAddress: string;
  outcome: "YES" | "NO";
}): Promise<{ txSig: string | null; outcome: string }> {
  assertLiveMicroGuards({ requireOperator: true });

  const outcomeIndex: 0 | 1 = params.outcome === "YES" ? 0 : 1;

  const proposal = await proposeResolutionOnchain({
    marketAddress: params.marketAddress,
    outcomeIndex,
  });

  const proofNote = JSON.stringify({
    source: "flash_crypto_price_admin_confirm",
    market_address: params.marketAddress,
    outcome: params.outcome,
    onchain_tx_sig: proposal.txSig,
  });

  await persistResolutionProposalToMarkets({
    marketAddress: params.marketAddress,
    proposedWinningOutcome: proposal.proposedOutcome,
    contestDeadlineIso: proposal.contestDeadlineIso,
    proposedProofNote: proofNote,
  });

  log("resolution confirmed", {
    marketAddress: params.marketAddress,
    outcome: params.outcome,
    txSig: proposal.txSig,
  });

  return { txSig: proposal.txSig, outcome: params.outcome };
}

// ── List auto-resolved / proposed crypto markets ──

export async function listPendingFlashCryptoResolutions(): Promise<FlashCryptoPendingResolution[]> {
  const supabase = (await import("@/lib/supabaseServer")).supabaseServer();

  const { data, error } = await supabase
    .from("markets")
    .select("id,market_address,question,sport_meta,resolution_status,resolution_proposed_at,total_volume,created_at")
    .eq("market_mode", "flash_crypto")
    .in("resolution_status", ["open", "proposed"])
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`pending flash crypto list failed: ${error.message}`);

  const results: FlashCryptoPendingResolution[] = [];

  for (const row of data || []) {
    const meta = asObject((row as any).sport_meta);
    const metaResolutionStatus = String(meta.resolution_status || "").trim().toLowerCase();
    if (metaResolutionStatus !== "pending_admin_confirmation" && metaResolutionStatus !== "proposed") continue;

    results.push({
      marketAddress: String((row as any).market_address || ""),
      marketId: (row as any).id || null,
      liveMicroId: "",
      tokenMint: String(meta.token_mint || ""),
      tokenSymbol: String(meta.token_symbol || ""),
      tokenName: String(meta.token_name || ""),
      priceStart: Number(meta.price_start || 0),
      priceEnd: Number(meta.price_end || 0),
      durationMinutes: Number(meta.duration_minutes || 0),
      autoResolvedOutcome: meta.auto_resolved_outcome === "YES" ? "YES" : "NO",
      resolutionStatus: metaResolutionStatus === "proposed" ? "proposed" : "pending_admin_confirmation",
      windowEnd: "",
      resolvedAt:
        (typeof meta.auto_resolved_at === "string" ? meta.auto_resolved_at : null) ||
        ((row as any).resolution_proposed_at as string | null) ||
        null,
    });
  }

  return results;
}
