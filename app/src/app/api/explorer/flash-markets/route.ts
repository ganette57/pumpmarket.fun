import { NextResponse } from "next/server";
import { getExplorerFlashMarkets } from "@/lib/liveMicro/flashMarkets";
import type { FlashMarketKind } from "@/lib/flashMarkets/types";

export const dynamic = "force-dynamic";

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 6;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function parseFilter(raw: string | null): "open" | "resolved" {
  if (raw === "resolved") return "resolved";
  return "open";
}

function parseKind(raw: string | null): FlashMarketKind | "all" {
  if (raw === "sport") return "sport";
  if (raw === "crypto") return "crypto";
  return "all";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const filter = parseFilter(url.searchParams.get("status"));
    const kind = parseKind(url.searchParams.get("kind"));
    const markets = await getExplorerFlashMarkets(limit, filter, kind);

    return NextResponse.json(
      { markets },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  } catch (error) {
    console.error("/api/explorer/flash-markets failed:", error);
    return NextResponse.json({ markets: [] }, { status: 200 });
  }
}
