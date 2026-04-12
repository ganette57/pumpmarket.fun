import { NextResponse } from "next/server";
import {
  getTrafficMarketRuntimeByAddress,
  lockTrafficFlashMarketByThreshold,
} from "@/lib/traffic/repository";
import {
  getTrafficWorkerBaseUrl,
  stopTrafficCounter,
  type TrafficRoundStatus,
} from "@/lib/traffic/trafficCounter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeThreshold(value: unknown): number | null {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(10_000, n));
}

function pickPayloadValue(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined) return payload[key];
  }
  return undefined;
}

function normalizeStatus(value: unknown): "running" | "ended" | "stopped" {
  const text = String(value || "").trim().toLowerCase();
  if (text === "running" || text === "ended" || text === "stopped") return text;
  return "stopped";
}

function normalizeCount(value: unknown, fallback = 0): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.max(0, n);
}

function normalizeOptionalCount(value: unknown): number | null {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

function normalizeBool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text === "true" || text === "1" || text === "yes" || text === "open" || text === "opened";
  }
  return false;
}

function buildStoppedWorkerStatus(roundId: string): TrafficRoundStatus {
  return {
    roundId,
    status: "stopped",
    currentCount: 0,
    startedAt: 0,
    endsAt: 0,
    sourceOpened: false,
    lastFrameAt: null,
    detectionsLastFrame: 0,
    frameWidth: null,
    frameHeight: null,
    countingLineX: null,
    countingLineY: null,
    lastCountedTrackId: null,
    lastCrossingDirection: null,
    lastDecisionTrackId: null,
    lastDecisionReason: null,
    lastDecisionCounted: null,
    lastTrackDeltaX: null,
    lastTrackSamples: null,
  };
}

function normalizeWorkerStatus(roundId: string, payload: Record<string, unknown>): TrafficRoundStatus {
  const currentCountRaw = pickPayloadValue(payload, ["currentCount", "current_count", "count"]);
  const startedAtRaw = pickPayloadValue(payload, ["startedAt", "started_at"]);
  const endsAtRaw = pickPayloadValue(payload, ["endsAt", "ends_at", "endAt", "end_at"]);
  const sourceOpenedRaw = pickPayloadValue(payload, [
    "sourceOpened",
    "source_opened",
    "streamOpened",
    "stream_opened",
  ]);
  const lastFrameAtRaw = pickPayloadValue(payload, ["lastFrameAt", "last_frame_at"]);
  const detectionsLastFrameRaw = pickPayloadValue(payload, [
    "detectionsLastFrame",
    "detections_last_frame",
  ]);
  const frameWidthRaw = pickPayloadValue(payload, ["frameWidth", "frame_width"]);
  const frameHeightRaw = pickPayloadValue(payload, ["frameHeight", "frame_height"]);
  const countingLineXRaw = pickPayloadValue(payload, ["countingLineX", "counting_line_x"]);
  const countingLineYRaw = pickPayloadValue(payload, ["countingLineY", "counting_line_y"]);
  const lastCountedTrackIdRaw = pickPayloadValue(payload, ["lastCountedTrackId", "last_counted_track_id"]);
  const lastCrossingDirectionRaw = pickPayloadValue(payload, [
    "lastCrossingDirection",
    "last_crossing_direction",
  ]);
  const lastDecisionTrackIdRaw = pickPayloadValue(payload, ["lastDecisionTrackId", "last_decision_track_id"]);
  const lastDecisionReasonRaw = pickPayloadValue(payload, ["lastDecisionReason", "last_decision_reason"]);
  const lastDecisionCountedRaw = pickPayloadValue(payload, [
    "lastDecisionCounted",
    "last_decision_counted",
  ]);
  const lastTrackDeltaXRaw = pickPayloadValue(payload, ["lastTrackDeltaX", "last_track_delta_x"]);
  const lastTrackSamplesRaw = pickPayloadValue(payload, ["lastTrackSamples", "last_track_samples"]);

  return {
    roundId: String(pickPayloadValue(payload, ["roundId", "round_id"]) || roundId).trim() || roundId,
    status: normalizeStatus(pickPayloadValue(payload, ["status", "state"])),
    currentCount: normalizeCount(currentCountRaw, 0),
    startedAt: normalizeCount(startedAtRaw, 0),
    endsAt: normalizeCount(endsAtRaw, 0),
    sourceOpened: normalizeBool(sourceOpenedRaw),
    lastFrameAt: normalizeOptionalCount(lastFrameAtRaw),
    detectionsLastFrame: normalizeCount(detectionsLastFrameRaw, 0),
    frameWidth: normalizeOptionalCount(frameWidthRaw),
    frameHeight: normalizeOptionalCount(frameHeightRaw),
    countingLineX: normalizeOptionalCount(countingLineXRaw),
    countingLineY: normalizeOptionalCount(countingLineYRaw),
    lastCountedTrackId: normalizeOptionalCount(lastCountedTrackIdRaw),
    lastCrossingDirection: String(lastCrossingDirectionRaw ?? "").trim() || null,
    lastDecisionTrackId: normalizeOptionalCount(lastDecisionTrackIdRaw),
    lastDecisionReason: String(lastDecisionReasonRaw ?? "").trim() || null,
    lastDecisionCounted:
      typeof lastDecisionCountedRaw === "boolean"
        ? lastDecisionCountedRaw
        : normalizeBool(lastDecisionCountedRaw)
          ? true
          : null,
    lastTrackDeltaX:
      typeof lastTrackDeltaXRaw === "number" && Number.isFinite(lastTrackDeltaXRaw)
        ? Number(lastTrackDeltaXRaw)
        : null,
    lastTrackSamples: normalizeOptionalCount(lastTrackSamplesRaw),
  };
}

function toLivePayload(workerStatus: TrafficRoundStatus) {
  return {
    currentCount: workerStatus.currentCount,
    status: workerStatus.status,
    sourceOpened: workerStatus.sourceOpened,
    lastFrameAt: workerStatus.lastFrameAt,
    detectionsLastFrame: workerStatus.detectionsLastFrame,
    frameWidth: workerStatus.frameWidth,
    frameHeight: workerStatus.frameHeight,
    countingLineX: workerStatus.countingLineX,
    countingLineY: workerStatus.countingLineY,
    lastCountedTrackId: workerStatus.lastCountedTrackId,
    lastCrossingDirection: workerStatus.lastCrossingDirection,
    lastDecisionTrackId: workerStatus.lastDecisionTrackId,
    lastDecisionReason: workerStatus.lastDecisionReason,
    lastDecisionCounted: workerStatus.lastDecisionCounted,
    lastTrackDeltaX: workerStatus.lastTrackDeltaX,
    lastTrackSamples: workerStatus.lastTrackSamples,
  };
}

async function fetchWorkerRoundStatus(roundId: string): Promise<{
  status: TrafficRoundStatus | null;
  payload: Record<string, unknown> | null;
}> {
  const workerUrl = `${getTrafficWorkerBaseUrl()}/rounds/${encodeURIComponent(roundId)}/status`;
  const workerRes = await fetch(workerUrl, { cache: "no-store" });

  if (workerRes.status === 404) {
    return { status: null, payload: null };
  }

  if (!workerRes.ok) {
    const text = await workerRes.text().catch(() => "");
    if (text.toLowerCase().includes("round not found")) {
      return { status: null, payload: null };
    }
    throw new Error(`traffic worker status failed (${workerRes.status}): ${text || "unknown error"}`);
  }

  const payload = (await workerRes.json().catch(() => ({}))) as Record<string, unknown>;
  const status = normalizeWorkerStatus(roundId, payload);
  return { status, payload };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const roundId = String(url.searchParams.get("roundId") || "").trim();
    const marketAddress = String(url.searchParams.get("marketAddress") || "").trim();
    console.log("[traffic-flash:api-live] live API requested with roundId", { roundId, marketAddress });
    if (!roundId) {
      return NextResponse.json({ error: "roundId param required" }, { status: 400 });
    }

    const row = marketAddress
      ? await getTrafficMarketRuntimeByAddress(marketAddress)
      : null;

    let workerStatus: TrafficRoundStatus;
    let workerPayload: Record<string, unknown> | null = null;
    try {
      const workerFetch = await fetchWorkerRoundStatus(roundId);
      if (!workerFetch.status) {
        workerStatus = buildStoppedWorkerStatus(roundId);
        return NextResponse.json(toLivePayload(workerStatus), {
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        });
      }
      workerStatus = workerFetch.status;
      workerPayload = workerFetch.payload;
      console.log("[traffic-flash:api-live] normalized worker status", {
        roundId,
        payload: workerPayload,
        normalized: toLivePayload(workerStatus),
      });
    } catch (error) {
      throw error;
    }

    if (row) {
      const resolutionStatus = String(row.resolution_status || "").trim().toLowerCase();
      const shouldStopByStatus =
        row.resolved === true ||
        row.cancelled === true ||
        resolutionStatus === "finalized" ||
        resolutionStatus === "cancelled";

      if (shouldStopByStatus && workerStatus.status === "running") {
        await stopTrafficCounter(roundId, `market_status_${resolutionStatus || "terminal"}`);
        const refreshed = await fetchWorkerRoundStatus(roundId).catch(() => null);
        if (refreshed?.status) {
          workerStatus = refreshed.status;
          workerPayload = refreshed.payload;
        }
      }

      const meta = row.sport_meta && typeof row.sport_meta === "object" ? row.sport_meta : {};
      const threshold = normalizeThreshold((meta as any).threshold);
      const currentCount = Math.max(0, Math.floor(Number(workerStatus.currentCount) || 0));
      const isTradable =
        row.resolved !== true &&
        row.cancelled !== true &&
        resolutionStatus !== "proposed" &&
        resolutionStatus !== "finalized" &&
        resolutionStatus !== "cancelled";
      const targetReached = threshold != null && currentCount >= threshold;
      if (isTradable && targetReached && !row.is_blocked && marketAddress) {
        const locked = await lockTrafficFlashMarketByThreshold({
          marketAddress,
          roundId,
          currentCount,
          threshold,
        });
        if (locked) {
          console.log("[traffic-flash:api-live] market locked early (threshold reached)", {
            marketAddress,
            roundId,
            currentCount,
            threshold,
          });
        }
      }
    }

    const currentCount = workerStatus.currentCount;
    console.log("[traffic-flash:api-live] live API returning count for roundId", {
      roundId,
      currentCount,
      sourceOpened: workerStatus.sourceOpened,
      rawCount: workerPayload
        ? pickPayloadValue(workerPayload, ["currentCount", "current_count", "count"])
        : null,
    });
    return NextResponse.json(
      toLivePayload({ ...workerStatus, currentCount }),
      {
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: String(error?.message || "Unknown error") },
      { status: 500 },
    );
  }
}
