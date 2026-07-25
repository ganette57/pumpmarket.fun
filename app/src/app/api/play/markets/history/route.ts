import { NextResponse } from "next/server";
import { getPlayMarketHistory, PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/markets/history   { market_address, max_points? }
//
// Authoritative Play probability history for ONE market's chart.
//
// PUBLIC ON PURPOSE — no Play session required, exactly like
// /api/play/markets. Probability history is public market information; it
// returns nothing user-scoped (no balances, no positions, no wallet — the
// underlying play_trades rows are aggregated into per-outcome odds only).
//
// The series is reconstructed server-side from the append-only play_trades
// ledger plus the backend-seeded opening book (see getPlayMarketHistory).
// It never touches Real tables and never falls back to Real odds.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const marketAddress = String(body?.market_address ?? "").trim();
    if (!marketAddress) {
      return NextResponse.json(
        { error: "market_address is required" },
        { status: 400 }
      );
    }

    const rawMax = Number(body?.max_points);
    const maxPoints = Number.isFinite(rawMax) ? rawMax : undefined;

    const history = await getPlayMarketHistory(marketAddress, { maxPoints });
    return NextResponse.json({ history });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/markets/history] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
