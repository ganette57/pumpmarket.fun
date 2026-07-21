import { NextResponse } from "next/server";
import { readPlaySession } from "@/lib/playAuth";
import {
  ensureAccount,
  ensureDailyGrant,
  currentSeason,
  getTrades,
  getMarketState,
  normalizeMarketAddress,
  PlayEngineError,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/state   { market_address? }
//
// Everything the Play UI needs on load: balance, active season, open
// positions, and optionally one market's Play book.
//
// Auth: the play_session cookie. No signature, no wallet prompt. A
// `wallet` field in the body is ignored — identity comes from the session
// and nowhere else.
//
// Also the daily-grant touchpoint: opening the app on a new UTC day
// credits the $10,000 bankroll.
export async function POST(req: Request) {
  try {
    const session = readPlaySession(req);
    if (!session) {
      return NextResponse.json(
        { error: "Play session required" },
        { status: 401 }
      );
    }

    // Optional: include one market's Play book in the same round trip.
    const body = await req.json().catch(() => ({}));
    const marketAddress = body?.market_address
      ? normalizeMarketAddress(body.market_address)
      : null;

    const account = await ensureAccount(session.wallet);
    const balance = await ensureDailyGrant(account.id);
    const season = await currentSeason();
    const openTrades = await getTrades({
      accountId: account.id,
      status: "open",
      limit: 200,
    });

    const marketState = marketAddress
      ? await getMarketState(marketAddress)
      : null;

    return NextResponse.json({
      account: {
        id: account.id,
        wallet_address: account.wallet_address,
        balance_usd: balance,
        last_grant_date: account.last_grant_date,
        is_eligible: account.is_eligible,
      },
      season,
      session_expires_at: session.expiresAt,
      open_trades: openTrades,
      market_state: marketState,
    });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/state] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
