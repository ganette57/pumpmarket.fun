import "server-only";

import { assertLiveMicroGuards } from "@/lib/liveMicro/config";
import {
  createBinaryMarketOnchain,
  getOperatorPublicKeyBase58,
  proposeResolutionOnchain,
} from "@/lib/liveMicro/operator";
import { persistResolutionProposalToMarkets } from "@/lib/liveMicro/repository";

import { parsePumpTokenInput } from "./pumpToken";
import { resolveFlashCryptoMajorSelection } from "./majors";
import {
  getFlashCryptoEndSnapshot,
  getFlashCryptoLivePrice,
  getFlashCryptoStartSnapshot,
} from "./priceSource";
import {
  getFlashCryptoGraduationEndSnapshot,
  getFlashCryptoGraduationSnapshot,
  getFlashCryptoGraduationStartSnapshot,
  listPumpFunGraduationCandidates,
} from "./graduationSource";
import {
  createFlashCryptoGraduationLiveMicroRow,
  createFlashCryptoLiveMicroRow,
  hasCampaignActiveMarket,
  listActiveFlashCryptoMicros,
  listRecentFlashCryptoTokenUsage,
  markFlashCryptoGraduationResolved,
  markFlashCryptoResolved,
  updateFlashCryptoGraduationMarketMeta,
  updateFlashCryptoMarketMeta,
  upsertFlashCryptoGraduationMarketRow,
  upsertFlashCryptoMarketRow,
} from "./repository";
import {
  FLASH_CRYPTO_GRADUATION_MICRO_TYPE,
  FLASH_CRYPTO_MICRO_TYPE,
  type FlashCryptoCampaign,
  type FlashCryptoDurationMinutes,
  type FlashCryptoMode,
  type FlashCryptoPendingResolution,
  type FlashCryptoSourceType,
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

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeDuration(mode: FlashCryptoMode, value: number): FlashCryptoDurationMinutes {
  const v = Math.floor(Number(value));
  if (mode === "graduation") {
    if ([10, 30, 60].includes(v)) return v as FlashCryptoDurationMinutes;
    throw new Error("Graduation durationMinutes must be 10, 30, or 60");
  }
  if ([1, 3, 5].includes(v)) return v as FlashCryptoDurationMinutes;
  throw new Error("Price durationMinutes must be 1, 3, or 5");
}

function formatDurationLabel(minutes: number): string {
  if (minutes === 60) return "1 hour";
  return `${minutes} minutes`;
}

function modeToMicroType(mode: FlashCryptoMode): "flash_crypto_price" | "flash_crypto_graduation" {
  return mode === "graduation" ? FLASH_CRYPTO_GRADUATION_MICRO_TYPE : FLASH_CRYPTO_MICRO_TYPE;
}

function microTypeToMode(value: unknown): FlashCryptoMode {
  const raw = String(value || "").trim().toLowerCase();
  return raw === FLASH_CRYPTO_GRADUATION_MICRO_TYPE ? "graduation" : "price";
}

// ── Campaign Management ──

export type StartCampaignInput = {
  tokenMint: string;
  mode?: FlashCryptoMode;
  sourceType?: FlashCryptoSourceType;
  majorSymbol?: string | null;
  majorPair?: string | null;
  durationMinutes: FlashCryptoDurationMinutes;
  totalMarkets: number;
};

export type StartCampaignResult = {
  campaign: FlashCryptoCampaign;
  firstMarket: CreateFlashCryptoMarketResult | null;
};

export async function startFlashCryptoCampaign(input: StartCampaignInput): Promise<StartCampaignResult> {
  assertLiveMicroGuards({ requireOperator: true });

  const mode: FlashCryptoMode = input.mode === "graduation" ? "graduation" : "price";
  const requestedSourceType: FlashCryptoSourceType =
    mode === "price" && String(input.sourceType || "").trim().toLowerCase() === "major"
      ? "major"
      : "pump_fun";
  const majorSelection =
    requestedSourceType === "major"
      ? resolveFlashCryptoMajorSelection({
          symbol: input.majorSymbol,
          pair: input.majorPair,
          raw: input.tokenMint,
        })
      : null;
  if (requestedSourceType === "major" && !majorSelection) {
    throw new Error("Unsupported major symbol. Choose BTC, ETH, SOL, or BNB.");
  }
  const tokenMint =
    requestedSourceType === "major" && majorSelection
      ? majorSelection.pair
      : parsePumpTokenInput(input.tokenMint);
  const durationMinutes = normalizeDuration(mode, Number(input.durationMinutes));

  const totalMarkets = Math.max(1, Math.min(100, Math.floor(input.totalMarkets || 1)));

  const id = generateId();
  const nowMs = Date.now();

  const token = mode === "graduation"
    ? await (async () => {
        const grad = await getFlashCryptoGraduationSnapshot(tokenMint);
        if (grad.didGraduate) {
          throw new Error("Selected token is already graduated. Choose a non-graduated token.");
        }
        return grad;
      })()
    : await getFlashCryptoLivePrice(tokenMint, {
        sourceType: requestedSourceType,
        majorSymbol: majorSelection?.symbol ?? input.majorSymbol,
        majorPair: majorSelection?.pair ?? input.majorPair,
      });

  const priceToken =
    mode === "price"
      ? (token as Awaited<ReturnType<typeof getFlashCryptoLivePrice>>)
      : null;
  const campaignSourceType: FlashCryptoSourceType =
    mode === "price" ? (priceToken?.sourceType || requestedSourceType) : "pump_fun";
  const campaignMajorSymbol =
    mode === "price" ? (priceToken?.majorSymbol || majorSelection?.symbol || null) : null;
  const campaignMajorPair =
    mode === "price" ? (priceToken?.majorPair || majorSelection?.pair || null) : null;

  const campaign: FlashCryptoCampaign = {
    id,
    type: modeToMicroType(mode),
    mode,
    status: "running",
    tokenMint: token.mint,
    tokenSymbol: token.symbol,
    tokenName: token.name,
    tokenImageUri: token.imageUri,
    sourceType: campaignSourceType,
    majorSymbol: campaignMajorSymbol,
    majorPair: campaignMajorPair,
    durationMinutes,
    totalMarkets,
    launchedCount: 0,
    nextLaunchAt: nowMs,
    startedAt: new Date(nowMs).toISOString(),
    stoppedAt: null,
    lastError: null,
    marketIds: [],
  };

  getCampaignStore().set(id, campaign);
  log("campaign started", {
    id,
    tokenMint,
    mode,
    sourceType: campaign.sourceType || "pump_fun",
    majorSymbol: campaign.majorSymbol || null,
    majorPair: campaign.majorPair || null,
    totalMarkets,
    durationMinutes,
  });

  let firstMarket: CreateFlashCryptoMarketResult | null = null;
  try {
    firstMarket = await createFlashCryptoMarket(campaign);
    campaign.launchedCount++;
    advanceNextLaunchAt(campaign, firstMarket.windowEnd);
    campaign.marketIds.push(firstMarket.marketAddress);
    log("first market created", {
      campaignId: id,
      mode,
      marketAddress: firstMarket.marketAddress,
    });
  } catch (e: any) {
    campaign.lastError = String(e?.message || e || "Failed to create first market");
    log("first market failed", { campaignId: id, mode, error: campaign.lastError });
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
  priceStart?: number | null;
  progressStart?: number | null;
  didGraduateStart?: boolean | null;
};

type ScheduledWindow = {
  windowStartMs: number;
  windowEndMs: number;
  windowStartIso: string;
  windowEndIso: string;
};

function getScheduledWindow(campaign: FlashCryptoCampaign): ScheduledWindow {
  const windowStartMs = Math.floor(campaign.nextLaunchAt);
  const windowEndMs = windowStartMs + campaign.durationMinutes * 60_000;
  return {
    windowStartMs,
    windowEndMs,
    windowStartIso: new Date(windowStartMs).toISOString(),
    windowEndIso: new Date(windowEndMs).toISOString(),
  };
}

function advanceNextLaunchAt(campaign: FlashCryptoCampaign, windowEndIso: string): void {
  const next = Date.parse(windowEndIso);
  if (Number.isFinite(next)) {
    campaign.nextLaunchAt = next;
    return;
  }
  campaign.nextLaunchAt += campaign.durationMinutes * 60_000;
}

async function cleanupOrphanMarket(marketAddress: string, error: unknown) {
  log("live_micro_markets insert failed, cleaning up orphan market", {
    marketAddress,
    error: String((error as any)?.message || error),
  });
  try {
    const sb = (await import("@/lib/supabaseServer")).supabaseServer();
    await sb.from("markets").delete().eq("market_address", marketAddress);
  } catch {
    // best-effort cleanup
  }
}

export async function createFlashCryptoPriceMarket(
  campaign: FlashCryptoCampaign,
  scheduledWindow: ScheduledWindow,
): Promise<CreateFlashCryptoMarketResult> {
  assertLiveMicroGuards({ requireOperator: true });

  const token = await getFlashCryptoStartSnapshot(campaign.tokenMint, {
    sourceType: campaign.sourceType || "pump_fun",
    majorSymbol: campaign.majorSymbol,
    majorPair: campaign.majorPair,
  });
  const priceStart = token.price;
  const tokenSymbol = String(token.symbol || campaign.tokenSymbol || token.mint.slice(0, 6)).trim();
  const tokenName = String(token.name || campaign.tokenName || tokenSymbol).trim();
  const tokenImageUri = token.imageUri || campaign.tokenImageUri || null;
  const sourceType: FlashCryptoSourceType = token.sourceType || campaign.sourceType || "pump_fun";
  const majorSymbol = String(token.majorSymbol || campaign.majorSymbol || "").trim().toUpperCase() || null;
  const majorPair = String(token.majorPair || campaign.majorPair || "").trim().toUpperCase() || null;
  const durationLabel = campaign.durationMinutes === 1 ? "1 minute" : `${campaign.durationMinutes} minutes`;

  const windowStartIso = scheduledWindow.windowStartIso;
  const windowEndMs = scheduledWindow.windowEndMs;
  const windowEndIso = scheduledWindow.windowEndIso;
  const resolutionTimeSec = Math.floor(windowEndMs / 1000);

  const createResult = await createBinaryMarketOnchain({
    resolutionTimeSec,
    outcomes: ["YES", "NO"],
  });

  const operatorWallet = getOperatorPublicKeyBase58();
  if (!operatorWallet) throw new Error("Operator wallet unavailable");

  const question =
    sourceType === "major"
      ? `Will ${tokenSymbol} go UP in ${durationLabel}?`
      : `Will $${tokenSymbol} go UP in ${campaign.durationMinutes} minutes?`;
  const description = [
    "Flash Crypto Price Market",
    `Token: ${sourceType === "major" ? tokenSymbol : `$${tokenSymbol}`} (${tokenName})`,
    `Identifier: ${token.mint}`,
    `Source Type: ${sourceType}`,
    `Major Symbol: ${majorSymbol ?? "n/a"}`,
    `Major Pair: ${majorPair ?? "n/a"}`,
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
    sourceType,
    majorSymbol,
    majorPair,
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
      sourceType,
      majorSymbol,
      majorPair,
      campaignId: campaign.id,
      durationMinutes: campaign.durationMinutes,
      createdByOperatorWallet: operatorWallet,
    });
  } catch (lmErr: any) {
    await cleanupOrphanMarket(marketRow.marketAddress, lmErr);
    throw new Error(
      `live_micro_markets insert failed: ${String(lmErr?.message || lmErr)}. ` +
        "Hint: run the migration in docs/migration-flash-crypto-constraints.sql to allow flash_crypto types.",
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

export async function createFlashCryptoGraduationMarket(
  campaign: FlashCryptoCampaign,
  scheduledWindow: ScheduledWindow,
): Promise<CreateFlashCryptoMarketResult> {
  assertLiveMicroGuards({ requireOperator: true });

  const token = await getFlashCryptoGraduationStartSnapshot(campaign.tokenMint);
  if (token.didGraduate) {
    throw new Error("Token already graduated at market start.");
  }

  const progressStart = clamp(Number(token.progressPct || 0), 0, 100);
  const tokenSymbol = String(token.symbol || campaign.tokenSymbol || token.mint.slice(0, 6)).trim();
  const tokenName = String(token.name || campaign.tokenName || tokenSymbol).trim();
  const tokenImageUri = token.imageUri || campaign.tokenImageUri || null;

  const windowStartIso = scheduledWindow.windowStartIso;
  const windowEndMs = scheduledWindow.windowEndMs;
  const windowEndIso = scheduledWindow.windowEndIso;
  const resolutionTimeSec = Math.floor(windowEndMs / 1000);

  const createResult = await createBinaryMarketOnchain({
    resolutionTimeSec,
    outcomes: ["YES", "NO"],
  });

  const operatorWallet = getOperatorPublicKeyBase58();
  if (!operatorWallet) throw new Error("Operator wallet unavailable");

  const question = `Will $${tokenSymbol} graduate in ${formatDurationLabel(campaign.durationMinutes)}?`;
  const description = [
    "Flash Crypto Graduation Market",
    `Token: $${tokenSymbol} (${tokenName})`,
    `Mint: ${token.mint}`,
    `Start Progress: ${progressStart.toFixed(2)}%`,
    `Did Graduate Start: ${token.didGraduate ? "true" : "false"}`,
    `Remaining To Graduate Start: ${token.remainingToGraduate ?? "n/a"}`,
    `Start Source: ${token.source}`,
    `Duration: ${campaign.durationMinutes}m`,
    `Campaign: ${campaign.id}`,
  ].join("\n");

  const marketRow = await upsertFlashCryptoGraduationMarketRow({
    marketAddress: createResult.marketAddress,
    creator: operatorWallet,
    question,
    description,
    endDateIso: windowEndIso,
    tokenMint: token.mint,
    tokenSymbol,
    tokenName,
    tokenImageUri,
    progressStart,
    didGraduateStart: token.didGraduate,
    remainingToGraduateStart: token.remainingToGraduate,
    providerName: token.provider,
    startProviderSource: token.source,
    durationMinutes: campaign.durationMinutes,
    campaignId: campaign.id,
  });

  let row: LiveMicroRow;
  try {
    row = await createFlashCryptoGraduationLiveMicroRow({
      tokenMint: token.mint,
      linkedMarketId: marketRow.id,
      linkedMarketAddress: marketRow.marketAddress,
      windowStartIso,
      windowEndIso,
      progressStart,
      didGraduateStart: token.didGraduate,
      remainingToGraduateStart: token.remainingToGraduate,
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
    await cleanupOrphanMarket(marketRow.marketAddress, lmErr);
    throw new Error(
      `live_micro_markets insert failed: ${String(lmErr?.message || lmErr)}. ` +
        "Hint: run the migration in docs/migration-flash-crypto-constraints.sql to allow flash_crypto types.",
    );
  }

  return {
    liveMicroId: row.id,
    marketAddress: marketRow.marketAddress,
    marketId: marketRow.id,
    createTxSig: createResult.txSig,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    progressStart,
    didGraduateStart: token.didGraduate,
  };
}

async function createFlashCryptoMarket(campaign: FlashCryptoCampaign): Promise<CreateFlashCryptoMarketResult> {
  const scheduledWindow = getScheduledWindow(campaign);
  if (campaign.mode === "graduation") {
    return createFlashCryptoGraduationMarket(campaign, scheduledWindow);
  }
  return createFlashCryptoPriceMarket(campaign, scheduledWindow);
}

// ── Campaign Runner (called by auto-tick) ──

export async function tickFlashCryptoCampaigns(): Promise<{
  campaignsProcessed: number;
  marketsCreated: number;
  errors: string[];
}> {
  const store = getCampaignStore();
  let campaignsProcessed = 0;
  let marketsCreated = 0;
  const errors: string[] = [];

  for (const campaign of Array.from(store.values())) {
    if (campaign.status !== "running") continue;

    if (campaign.launchedCount >= campaign.totalMarkets) {
      campaign.status = "completed";
      log("campaign completed", { id: campaign.id, launchedCount: campaign.launchedCount });
      continue;
    }

    if (Date.now() < campaign.nextLaunchAt) continue;

    try {
      const hasActive = await hasCampaignActiveMarket(campaign.id);
      if (hasActive) continue;
    } catch {
      continue;
    }

    campaignsProcessed++;

    try {
      const result = await createFlashCryptoMarket(campaign);
      campaign.launchedCount++;
      advanceNextLaunchAt(campaign, result.windowEnd);
      campaign.marketIds.push(result.marketAddress);
      campaign.lastError = null;
      marketsCreated++;
      log("campaign market created", {
        campaignId: campaign.id,
        mode: campaign.mode,
        marketAddress: result.marketAddress,
        launchedCount: campaign.launchedCount,
        totalMarkets: campaign.totalMarkets,
      });
    } catch (e: any) {
      const errMsg = String(e?.message || e || "Unknown error creating flash crypto market");
      campaign.lastError = errMsg;
      errors.push(`campaign=${campaign.id}: ${errMsg}`);
      log("campaign market creation failed", { campaignId: campaign.id, mode: campaign.mode, error: errMsg });
    }
  }

  return { campaignsProcessed, marketsCreated, errors };
}

// ── Auto-Resolve (called by auto-tick) ──

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

    if (row.resolution_outcome) continue;

    const payloadStart = asObject(row.provider_payload_start);
    const microType = String(payloadStart.type || row.micro_market_type || "").trim().toLowerCase();
    const tokenMint = String(payloadStart.token_mint || "").trim();
    const marketAddress = String(row.linked_market_address || "").trim();

    if (!tokenMint) {
      errors.push(`row=${row.id}: missing token_mint`);
      continue;
    }
    if (!marketAddress) {
      errors.push(`row=${row.id}: missing linked_market_address`);
      continue;
    }

    try {
      if (microType === FLASH_CRYPTO_GRADUATION_MICRO_TYPE) {
        const progressStart = Number(payloadStart.progress_start);
        if (!Number.isFinite(progressStart)) {
          errors.push(`row=${row.id}: invalid progress_start`);
          continue;
        }

        const endSnapshot = await getFlashCryptoGraduationEndSnapshot(tokenMint);
        const progressEnd = clamp(Number(endSnapshot.progressPct || 0), 0, 100);
        const didGraduateEnd = !!endSnapshot.didGraduate;
        const autoResolvedOutcome: "YES" | "NO" = didGraduateEnd ? "YES" : "NO";

        const outcomeIndex: 0 | 1 = autoResolvedOutcome === "YES" ? 0 : 1;
        const proposal = await proposeResolutionOnchain({
          marketAddress,
          outcomeIndex,
        });

        const proofNote = JSON.stringify({
          source: "flash_crypto_graduation_auto_tick",
          type: FLASH_CRYPTO_GRADUATION_MICRO_TYPE,
          live_micro_id: row.id,
          market_address: marketAddress,
          token_mint: tokenMint,
          progress_start: progressStart,
          progress_end: progressEnd,
          did_graduate_start: String(payloadStart.did_graduate_start || "").toLowerCase() === "true" || payloadStart.did_graduate_start === true,
          did_graduate_end: didGraduateEnd,
          remaining_to_graduate_start:
            Number.isFinite(Number(payloadStart.remaining_to_graduate_start))
              ? Number(payloadStart.remaining_to_graduate_start)
              : null,
          remaining_to_graduate_end:
            Number.isFinite(Number(endSnapshot.remainingToGraduate)) ? Number(endSnapshot.remainingToGraduate) : null,
          outcome: autoResolvedOutcome,
          proposed_outcome: autoResolvedOutcome,
          window_start: row.window_start,
          window_end: row.window_end,
          provider: endSnapshot.provider,
          provider_source: endSnapshot.source,
          graduate_status_final: didGraduateEnd,
          onchain_tx_sig: proposal.txSig,
        });

        await persistResolutionProposalToMarkets({
          marketAddress,
          proposedWinningOutcome: proposal.proposedOutcome,
          contestDeadlineIso: proposal.contestDeadlineIso,
          proposedProofNote: proofNote,
        });

        await markFlashCryptoGraduationResolved({
          id: row.id,
          outcome: autoResolvedOutcome,
          progressEnd,
          didGraduateEnd,
          remainingToGraduateEnd: endSnapshot.remainingToGraduate,
          resolutionStatus: "proposed",
          proposalTxSig: proposal.txSig,
          providerSource: endSnapshot.source,
        });

        await updateFlashCryptoGraduationMarketMeta({
          marketAddress,
          progressEnd,
          didGraduateEnd,
          remainingToGraduateEnd: endSnapshot.remainingToGraduate,
          autoResolvedOutcome,
          resolutionStatus: "proposed",
          proposalTxSig: proposal.txSig,
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
          priceStart: 0,
          priceEnd: 0,
          progressStart,
          progressEnd,
          didGraduateEnd,
          durationMinutes: Number(payloadStart.duration_minutes || 0),
          mode: "graduation",
          autoResolvedOutcome,
          resolutionStatus: "proposed",
          windowEnd: row.window_end,
          resolvedAt: new Date().toISOString(),
        });

        log("auto-resolved graduation", {
          liveMicroId: row.id,
          tokenMint,
          progressStart,
          progressEnd,
          didGraduateEnd,
          outcome: autoResolvedOutcome,
          txSig: proposal.txSig,
        });

        continue;
      }

      if (microType !== FLASH_CRYPTO_MICRO_TYPE) continue;

      const priceStart = Number(payloadStart.price_start);
      if (!Number.isFinite(priceStart) || priceStart <= 0) {
        errors.push(`row=${row.id}: invalid price_start`);
        continue;
      }

      const sourceType: FlashCryptoSourceType =
        String(payloadStart.source_type || "").trim().toLowerCase() === "major"
          ? "major"
          : "pump_fun";
      const majorSymbol = String(payloadStart.major_symbol || "").trim().toUpperCase() || null;
      const majorPair = String(payloadStart.major_pair || "").trim().toUpperCase() || null;

      const endSnapshot = await getFlashCryptoEndSnapshot(tokenMint, {
        sourceType,
        majorSymbol,
        majorPair,
      });
      const priceEnd = endSnapshot.price;
      const autoResolvedOutcome: "YES" | "NO" = priceEnd > priceStart ? "YES" : "NO";
      const percentChange = ((priceEnd - priceStart) / priceStart) * 100;

      const outcomeIndex: 0 | 1 = autoResolvedOutcome === "YES" ? 0 : 1;
      const proposal = await proposeResolutionOnchain({
        marketAddress,
        outcomeIndex,
      });

      const proofNote = JSON.stringify({
        source: "flash_crypto_price_auto_tick",
        type: FLASH_CRYPTO_MICRO_TYPE,
        live_micro_id: row.id,
        market_address: marketAddress,
        token_mint: tokenMint,
        source_type: endSnapshot.sourceType || sourceType,
        major_symbol: endSnapshot.majorSymbol || majorSymbol,
        major_pair: endSnapshot.majorPair || majorPair,
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
        progressStart: null,
        progressEnd: null,
        didGraduateEnd: null,
        sourceType: endSnapshot.sourceType || sourceType,
        majorSymbol: endSnapshot.majorSymbol || majorSymbol,
        majorPair: endSnapshot.majorPair || majorPair,
        durationMinutes: Number(payloadStart.duration_minutes || 0),
        mode: "price",
        autoResolvedOutcome,
        resolutionStatus: "proposed",
        windowEnd: row.window_end,
        resolvedAt: new Date().toISOString(),
      });

      log("auto-resolved price", {
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
    source: "flash_crypto_admin_confirm",
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

// ── Suggestions (graduation) ──

export type FlashCryptoGraduationSuggestion = {
  mint: string;
  symbol: string;
  name: string;
  imageUri: string | null;
  durationMinutes: 10 | 30 | 60;
  thresholdPct: 40 | 60;
  progressPct: number;
  didGraduate: boolean;
  remainingToGraduate: number | null;
  lastTradeAt: string | null;
  volumeUsd: number | null;
  activityCount: number | null;
  momentum: number | null;
  recentlyUsed: boolean;
  recentlyUsedCount: number;
  score: number;
  scoreBreakdown: {
    progressWeight: number;
    proximityWeight: number;
    activityWeight: number;
    volumeWeight: number;
    momentumWeight: number;
    recentDuplicatePenalty: number;
  };
};

function recommendationThreshold(durationMinutes: number): 40 | 60 {
  if (durationMinutes === 10) return 40;
  return 60;
}

function volumeScore(value: number | null): number {
  if (value == null || value <= 0) return 0;
  const normalized = Math.log10(value + 1) / Math.log10(1_000_000 + 1);
  return clamp(normalized * 100, 0, 100);
}

function activityScore(lastTradeAt: string | null, activityCount: number | null): number {
  const nowMs = Date.now();
  const lastMs = Date.parse(String(lastTradeAt || ""));
  const recencyMin = Number.isFinite(lastMs) ? Math.max(0, (nowMs - lastMs) / 60_000) : 999;
  const recency = recencyMin >= 180 ? 0 : clamp(100 - recencyMin * 0.8, 0, 100);
  const activity = activityCount != null ? clamp((Math.log10(activityCount + 1) / Math.log10(120 + 1)) * 100, 0, 100) : 0;
  return clamp(recency * 0.7 + activity * 0.3, 0, 100);
}

function momentumScore(momentum: number | null): number {
  if (momentum == null) return 0;
  const abs = Math.abs(momentum);
  return clamp(abs <= 1 ? abs * 100 : abs, 0, 100);
}

function isRecentEnough(lastTradeAt: string | null): boolean {
  const ts = Date.parse(String(lastTradeAt || ""));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= 120 * 60_000;
}

export async function listFlashCryptoGraduationSuggestions(params: {
  durationMinutes: 10 | 30 | 60;
  limit?: number;
}): Promise<FlashCryptoGraduationSuggestion[]> {
  const durationMinutes = params.durationMinutes;
  const thresholdPct = recommendationThreshold(durationMinutes);
  const cap = Math.max(3, Math.min(60, Math.floor(params.limit ?? 20)));

  const [candidates, recentUsage] = await Promise.all([
    listPumpFunGraduationCandidates(220),
    listRecentFlashCryptoTokenUsage(180),
  ]);

  const recentUsageByMint = new Map<string, { count: number; lastUsedAt: string | null }>();
  for (const usage of recentUsage) {
    const mint = usage.tokenMint;
    const prev = recentUsageByMint.get(mint);
    if (!prev) {
      recentUsageByMint.set(mint, { count: 1, lastUsedAt: usage.createdAt || null });
      continue;
    }
    recentUsageByMint.set(mint, {
      count: prev.count + 1,
      lastUsedAt: prev.lastUsedAt || usage.createdAt || null,
    });
  }

  const out: FlashCryptoGraduationSuggestion[] = [];

  for (const token of candidates) {
    if (!token.mint || !token.symbol || !token.name) continue;
    if (token.didGraduate) continue;
    if (!Number.isFinite(token.progressPct)) continue;
    if (token.progressPct < thresholdPct) continue;

    const usage = recentUsageByMint.get(token.mint);
    const recentlyUsedCount = usage?.count || 0;
    const recentlyUsed = recentlyUsedCount > 0;

    // Hard anti-spam for very recent duplicates in the latest feed.
    if (recentlyUsedCount >= 3) continue;

    const progressNorm = clamp(token.progressPct, 0, 100);
    const proximityNorm = clamp(100 - Math.max(0, 100 - token.progressPct), 0, 100);
    const activityNorm = activityScore(token.lastTradeAt, token.activityCount);
    const volumeNorm = volumeScore(token.volumeUsd);
    const momentumNorm = momentumScore(token.momentum);

    if (!isRecentEnough(token.lastTradeAt) && activityNorm < 15 && (token.volumeUsd || 0) < 1000) {
      continue;
    }

    const progressWeight = progressNorm * 0.30;
    const proximityWeight = proximityNorm * 0.25;
    const activityWeight = activityNorm * 0.20;
    const volumeWeight = volumeNorm * 0.15;
    const momentumWeight = momentumNorm * 0.10;
    const recentDuplicatePenalty = recentlyUsed ? Math.min(35, 12 + recentlyUsedCount * 8) : 0;

    const score =
      progressWeight +
      proximityWeight +
      activityWeight +
      volumeWeight +
      momentumWeight -
      recentDuplicatePenalty;

    out.push({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      imageUri: token.imageUri,
      durationMinutes,
      thresholdPct,
      progressPct: clamp(token.progressPct, 0, 100),
      didGraduate: token.didGraduate,
      remainingToGraduate: token.remainingToGraduate,
      lastTradeAt: token.lastTradeAt,
      volumeUsd: token.volumeUsd,
      activityCount: token.activityCount,
      momentum: token.momentum,
      recentlyUsed,
      recentlyUsedCount,
      score: Number(score.toFixed(2)),
      scoreBreakdown: {
        progressWeight: Number(progressWeight.toFixed(2)),
        proximityWeight: Number(proximityWeight.toFixed(2)),
        activityWeight: Number(activityWeight.toFixed(2)),
        volumeWeight: Number(volumeWeight.toFixed(2)),
        momentumWeight: Number(momentumWeight.toFixed(2)),
        recentDuplicatePenalty: Number(recentDuplicatePenalty.toFixed(2)),
      },
    });
  }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.progressPct !== a.progressPct) return b.progressPct - a.progressPct;
    const aTs = Date.parse(String(a.lastTradeAt || ""));
    const bTs = Date.parse(String(b.lastTradeAt || ""));
    const sa = Number.isFinite(aTs) ? aTs : 0;
    const sb = Number.isFinite(bTs) ? bTs : 0;
    return sb - sa;
  });

  return out.slice(0, cap);
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

    const mode = microTypeToMode(meta.type);

    results.push({
      marketAddress: String((row as any).market_address || ""),
      marketId: (row as any).id || null,
      liveMicroId: "",
      tokenMint: String(meta.token_mint || ""),
      tokenSymbol: String(meta.token_symbol || ""),
      tokenName: String(meta.token_name || ""),
      priceStart: Number(meta.price_start || 0),
      priceEnd: Number(meta.price_end || 0),
      progressStart: Number.isFinite(Number(meta.progress_start)) ? Number(meta.progress_start) : null,
      progressEnd: Number.isFinite(Number(meta.progress_end)) ? Number(meta.progress_end) : null,
      didGraduateEnd:
        mode === "graduation"
          ? (typeof meta.did_graduate_end === "boolean"
              ? meta.did_graduate_end
              : String(meta.did_graduate_end || "").trim().toLowerCase() === "true")
          : null,
      sourceType: String(meta.source_type || "").trim().toLowerCase() === "major" ? "major" : "pump_fun",
      majorSymbol: String(meta.major_symbol || "").trim().toUpperCase() || null,
      majorPair: String(meta.major_pair || "").trim().toUpperCase() || null,
      durationMinutes: Number(meta.duration_minutes || 0),
      mode,
      autoResolvedOutcome: String(meta.auto_resolved_outcome || "").toUpperCase() === "YES" ? "YES" : "NO",
      resolutionStatus: metaResolutionStatus === "proposed" ? "proposed" : "pending_admin_confirmation",
      windowEnd: String(meta.window_end || ""),
      resolvedAt:
        (typeof meta.auto_resolved_at === "string" ? meta.auto_resolved_at : null) ||
        ((row as any).resolution_proposed_at as string | null) ||
        null,
    });
  }

  return results;
}
