import { NextResponse } from "next/server";
import { readPlaySession } from "@/lib/playAuth";
import {
  getPlaySettlementBook,
  normalizeMarketAddress,
  normalizeOutcomeIndex,
  PlayEngineError,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/settlement-preview   { market_address, winning_outcome }
//
// The two market-wide numbers play_settle_market divides by, so a PROVISIONAL
// result can state an estimated payout instead of an empty row.
//
// READ-ONLY, and named for it. It does not call play_settle_market, does not
// settle, does not credit, does not touch a balance and writes no row — it is
// two SELECTs and an exact integer sum. Unlike /api/play/state it also grants
// nothing, which matters because the live surfaces reach this while polling.
//
// Auth: the play_session cookie. The response carries nothing user-scoped —
// the virtual pool is market-wide and the share total is an aggregate over
// every trader — but the session is still required so Play's read surface
// stays uniformly session-gated.
//
// A null `book` means "cannot be stated exactly" (no Play state on this
// market, an unreadable row, or too many open winning trades to sum in one
// pass). Callers must render no payout at all in that case, never a zero.
export async function POST(req: Request) {
  try {
    const session = readPlaySession(req);
    if (!session) {
      return NextResponse.json(
        { error: "Play session required" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const marketAddress = normalizeMarketAddress(body?.market_address);
    const winningOutcome = normalizeOutcomeIndex(body?.winning_outcome);

    const book = await getPlaySettlementBook(marketAddress, winningOutcome);

    return NextResponse.json({ book });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/settlement-preview] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
