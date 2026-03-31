import "server-only";

import { assertLiveMicroGuards } from "@/lib/liveMicro/config";
import {
  createBinaryMarketOnchain,
  getOperatorPublicKeyBase58,
  proposeResolutionOnchain,
} from "@/lib/liveMicro/operator";
import { persistResolutionProposalToMarkets } from "@/lib/liveMicro/repository";
import { TRAFFIC_CAMERAS } from "@/lib/traffic/config";
import {
  listPendingTrafficFlashResolutions,
  listRecentTrafficFlashMarkets,
  updateTrafficFlashMarketMeta,
  upsertTrafficFlashMarketRow,
  type TrafficRecentMarket,
} from "@/lib/traffic/repository";
import {
  getTrafficCount,
  startTrafficCounter,
  stopTrafficCounter,
} from "@/lib/traffic/trafficCounter";
import {
  TRAFFIC_FLASH_TYPE,
  type TrafficFlashDurationSec,
  type TrafficRoundParams,
} from "@/lib/traffic/types";

type TrafficFlashRuntimeState = {
  enabled: boolean;
};

const TRAFFIC_FLASH_RUNTIME_KEY = Symbol.for("FUNMARKET_TRAFFIC_FLASH_RUNTIME");

function getRuntimeState(): TrafficFlashRuntimeState {
  const host = (typeof process !== "undefined" ? process : globalThis) as Record<PropertyKey, unknown>;
  const existing = host[TRAFFIC_FLASH_RUNTIME_KEY] as TrafficFlashRuntimeState | undefined;
  if (existing) return existing;
  const created: TrafficFlashRuntimeState = { enabled: true };
  host[TRAFFIC_FLASH_RUNTIME_KEY] = created;
  return created;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeDurationSec(value: unknown): TrafficFlashDurationSec {
  const n = Math.floor(Number(value));
  if (n === 180) return 180;
  if (n === 300) return 300;
  return 60;
}

function normalizeThreshold(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 12;
  return Math.max(1, Math.min(10_000, n));
}

function resolveCamera(cameraId: string | null | undefined) {
  const requested = String(cameraId || "").trim().toLowerCase();
  const selected = TRAFFIC_CAMERAS.find((camera) => camera.id.toLowerCase() === requested);
  return selected || TRAFFIC_CAMERAS[0];
}

function generateRoundId(): string {
  return `tfr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function log(msg: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.log(`[traffic-flash] ${msg}`, payload);
    return;
  }
  console.log(`[traffic-flash] ${msg}`);
}

export type StartTrafficFlashInput = Partial<TrafficRoundParams>;

export type StartTrafficFlashResult = {
  marketAddress: string;
  marketId: string | null;
  createTxSig: string;
  roundId: string;
  threshold: number;
  durationSec: TrafficFlashDurationSec;
  cameraId: string;
  cameraName: string;
  windowStart: string;
  windowEnd: string;
};

export function setTrafficFlashEnabled(enabled: boolean): { enabled: boolean } {
  const state = getRuntimeState();
  state.enabled = !!enabled;
  return { enabled: state.enabled };
}

export function getTrafficFlashRuntimeStatus(): {
  enabled: boolean;
  cameras: typeof TRAFFIC_CAMERAS;
} {
  const state = getRuntimeState();
  return {
    enabled: state.enabled,
    cameras: TRAFFIC_CAMERAS,
  };
}

export async function startTrafficFlash(input: StartTrafficFlashInput = {}): Promise<StartTrafficFlashResult> {
  assertLiveMicroGuards({ requireOperator: true });

  const state = getRuntimeState();
  if (!state.enabled) throw new Error("Traffic Flash is disabled.");

  const threshold = normalizeThreshold(input.threshold);
  const durationSec = normalizeDurationSec(input.durationSec);
  const camera = resolveCamera(input.cameraId);
  const roundId = generateRoundId();
  const nowMs = Date.now();
  const windowStartIso = new Date(nowMs).toISOString();
  const windowEndMs = nowMs + durationSec * 1000;
  const windowEndIso = new Date(windowEndMs).toISOString();
  const resolutionTimeSec = Math.floor(windowEndMs / 1000);
  console.log("[traffic-flash:engine] round created", {
    roundId,
    threshold,
    durationSec,
    cameraId: camera.id,
    windowStart: windowStartIso,
    windowEnd: windowEndIso,
  });
  const countStart = await startTrafficCounter(roundId, {
    streamUrl: camera.streamUrl,
    cameraId: camera.id,
    sourceType: camera.sourceType,
    durationSec,
    line: camera.line,
    classes: ["car", "bus", "truck", "motorcycle"],
    tracker: "bytetrack",
  });
  console.log("[traffic-flash:engine] traffic round still tradable until exact end", {
    roundId,
    exactEndTime: windowEndIso,
  });
  console.log("[traffic-flash:engine] round start count", {
    roundId,
    currentCount: countStart,
  });

  const createResult = await createBinaryMarketOnchain({
    resolutionTimeSec,
    outcomes: ["YES", "NO"],
  });

  const operatorWallet = getOperatorPublicKeyBase58();
  if (!operatorWallet) throw new Error("Operator wallet unavailable");

  const question = `Will ${threshold}+ vehicles cross in ${durationSec}s?`;
  const description = [
    "Traffic Flash Market",
    `Round ID: ${roundId}`,
    `Source: traffic`,
    `Threshold: ${threshold}`,
    `Duration: ${durationSec}s`,
    `Camera: ${camera.id} (${camera.name})`,
    `Window Start: ${windowStartIso}`,
    `Window End: ${windowEndIso}`,
  ].join("\n");

  const marketRow = await upsertTrafficFlashMarketRow({
    marketAddress: createResult.marketAddress,
    creator: operatorWallet,
    question,
    description,
    endDateIso: windowEndIso,
    roundId,
    threshold,
    durationSec,
    cameraId: camera.id,
    cameraName: camera.name,
    windowStartIso,
    windowEndIso,
    startCount: countStart,
  });

  log("traffic market started", {
    marketAddress: marketRow.marketAddress,
    roundId,
    threshold,
    durationSec,
    cameraId: camera.id,
  });

  return {
    marketAddress: marketRow.marketAddress,
    marketId: marketRow.id,
    createTxSig: createResult.txSig,
    roundId,
    threshold,
    durationSec,
    cameraId: camera.id,
    cameraName: camera.name,
    windowStart: windowStartIso,
    windowEnd: windowEndIso,
  };
}

export async function tickTrafficFlashResolutions(): Promise<{
  resolved: number;
  errors: string[];
}> {
  const recent = await listRecentTrafficFlashMarkets(120);
  for (const row of recent) {
    const meta = asObject(row.sport_meta);
    const roundId = String(meta.round_id || meta.roundId || "").trim();
    if (!roundId) continue;
    const status = String(row.resolution_status || "").trim().toLowerCase();
    const terminal =
      row.resolved === true ||
      status === "finalized" ||
      status === "cancelled";
    if (!terminal) continue;
    console.log("[traffic-flash:engine] stop check", {
      roundId,
      status,
      resolved: row.resolved === true,
      shouldStopWorker: terminal,
    });
    await stopTrafficCounter(roundId, `market_status_${status || "terminal"}`);
  }

  const pending = await listPendingTrafficFlashResolutions(100);
  let resolved = 0;
  const errors: string[] = [];

  for (const row of pending) {
    const marketAddress = String(row.market_address || "").trim();
    if (!marketAddress) continue;

    try {
      const meta = asObject(row.sport_meta);
      const source = String(meta.source || "").trim().toLowerCase();
      if (source && source !== "traffic") continue;
      const roundId = String(meta.round_id || meta.roundId || marketAddress).trim();
      const threshold = normalizeThreshold(meta.threshold);
      const durationSec = normalizeDurationSec(meta.duration_sec ?? meta.durationSec);
      const cameraId = String(meta.camera_id || meta.cameraId || "").trim() || null;
      const windowStart = String(meta.window_start || meta.windowStart || "").trim() || null;
      const windowEnd = String(meta.window_end || meta.windowEnd || row.end_date || "").trim() || null;

      const count = await getTrafficCount(roundId);
      const stoppedCount = await stopTrafficCounter(roundId, "proposal_triggered");
      const frozenCount = stoppedCount ?? count;
      console.log("[traffic-flash:engine] traffic proposal triggered with final frozen count", {
        marketAddress,
        roundId,
        threshold,
        finalFrozenCount: frozenCount,
      });
      const outcome: "YES" | "NO" = frozenCount >= threshold ? "YES" : "NO";
      const outcomeIndex: 0 | 1 = outcome === "YES" ? 0 : 1;
      const proposal = await proposeResolutionOnchain({ marketAddress, outcomeIndex });

      const proofNote = JSON.stringify({
        source: "traffic_flash_auto_tick",
        type: TRAFFIC_FLASH_TYPE,
        market_address: marketAddress,
        round_id: roundId,
        threshold,
        duration_sec: durationSec,
        camera_id: cameraId,
        current_count: frozenCount,
        outcome,
        proposed_outcome: outcome,
        onchain_tx_sig: proposal.txSig,
      });

      await persistResolutionProposalToMarkets({
        marketAddress,
        proposedWinningOutcome: proposal.proposedOutcome,
        contestDeadlineIso: proposal.contestDeadlineIso,
        proposedProofNote: proofNote,
      });

      await updateTrafficFlashMarketMeta({
        marketAddress,
        patch: {
          type: TRAFFIC_FLASH_TYPE,
          source: "traffic",
          round_id: roundId,
          threshold,
          duration_sec: durationSec,
          camera_id: cameraId,
          window_start: windowStart,
          window_end: windowEnd,
          current_count: frozenCount,
          end_count: frozenCount,
          auto_resolved_outcome: outcome,
          proposed_outcome: outcome,
          resolution_status: "proposed",
          proposal_tx_sig: proposal.txSig,
          auto_resolved_at: new Date().toISOString(),
        },
      });

      resolved += 1;
      log("traffic market auto-resolved", {
        marketAddress,
        roundId,
        threshold,
        count: frozenCount,
        outcome,
        txSig: proposal.txSig,
      });
    } catch (e: any) {
      errors.push(`market=${marketAddress}: ${String(e?.message || e)}`);
    }
  }

  return { resolved, errors };
}

export async function listRecentTrafficFlash(limit = 20): Promise<TrafficRecentMarket[]> {
  return listRecentTrafficFlashMarkets(limit);
}
