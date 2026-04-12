import { NextResponse } from "next/server";
import { getTrafficDebugFrameUrl } from "@/lib/traffic/trafficCounter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const roundId = String(url.searchParams.get("roundId") || "").trim();
    if (!roundId) {
      return NextResponse.json({ error: "roundId param required" }, { status: 400 });
    }

    const workerRes = await fetch(getTrafficDebugFrameUrl(roundId), {
      cache: "no-store",
    });

    if (workerRes.status === 404) {
      return NextResponse.json({ error: "No debug frame available yet" }, { status: 404 });
    }
    if (!workerRes.ok) {
      const text = await workerRes.text().catch(() => "");
      return NextResponse.json(
        { error: text || `Worker frame fetch failed (${workerRes.status})` },
        { status: workerRes.status },
      );
    }

    const image = await workerRes.arrayBuffer();
    return new NextResponse(image, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: String(error?.message || "Unknown error") },
      { status: 500 },
    );
  }
}
