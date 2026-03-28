import { NextResponse } from "next/server";
import { getTrafficMarketRuntimeByAddress } from "@/lib/traffic/repository";
import {
  getTrafficRoundStatus,
  stopTrafficCounter,
  type TrafficRoundStatus,
} from "@/lib/traffic/trafficCounter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      const nowMs = Date.now();
      const endMs = Date.parse(String(row.end_date || ""));
      const resolutionStatus = String(row.resolution_status || "").trim().toLowerCase();
      const shouldStopByTime = Number.isFinite(endMs) && nowMs >= endMs;
      const shouldStopByStatus =
        row.resolved === true ||
        row.cancelled === true ||
        resolutionStatus === "proposed" ||
        resolutionStatus === "finalized" ||
        resolutionStatus === "cancelled";
      console.log("[traffic-flash:api-live] stop check", {
        roundId,
        workerStatus: workerStatus.status,
        shouldStopByTime,
        shouldStopByStatus,
        nowMs,
        endMs,
        endDate: row.end_date,
        resolutionStatus,
        resolved: row.resolved,
        cancelled: row.cancelled,
      });
      if ((shouldStopByTime || shouldStopByStatus) && workerStatus.status === "running") {
        console.log("[traffic-flash:api-live] STOPPING worker", {
          roundId,
          reason: shouldStopByStatus ? `market_status_${resolutionStatus || "terminal"}` : "end_time_reached",
        });
        await stopTrafficCounter(
          roundId,
          shouldStopByStatus ? `market_status_${resolutionStatus || "terminal"}` : "end_time_reached",
        );
        workerStatus = await getTrafficRoundStatus(roundId).catch(() => workerStatus);
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
