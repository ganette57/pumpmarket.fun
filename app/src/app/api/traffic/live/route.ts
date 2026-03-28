import { NextResponse } from "next/server";
import { getTrafficMarketRuntimeByAddress } from "@/lib/traffic/repository";
import { getTrafficRoundStatus, stopTrafficCounter } from "@/lib/traffic/trafficCounter";

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

    if (marketAddress) {
      const row = await getTrafficMarketRuntimeByAddress(marketAddress);
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
        if (shouldStopByTime || shouldStopByStatus) {
          if (shouldStopByTime) {
            console.log("[traffic-flash:api-live] traffic round reached end_time", {
              roundId,
              marketAddress,
              endDate: row.end_date,
            });
          }
          await stopTrafficCounter(
            roundId,
            shouldStopByStatus ? `market_status_${resolutionStatus || "terminal"}` : "end_time_reached",
          );
        }
      }
    }

    const workerStatus = await getTrafficRoundStatus(roundId);
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
