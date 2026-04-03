import { NextResponse } from "next/server";
import {
  getTrafficMarketRuntimeByAddress,
  lockTrafficFlashMarketByThreshold,
} from "@/lib/traffic/repository";
import {
  getTrafficRoundStatus,
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
    try {
      workerStatus = await getTrafficRoundStatus(roundId);
    } catch (error: any) {
      const message = String(error?.message || "");
      if (message.toLowerCase().includes("round not found")) {
        return NextResponse.json(
          {
            currentCount: 0,
            status: "stopped",
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
          },
          {
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate",
            },
          },
        );
      }
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
        workerStatus = await getTrafficRoundStatus(roundId).catch(() => workerStatus);
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
    });
    return NextResponse.json(
      {
        currentCount,
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
      },
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
