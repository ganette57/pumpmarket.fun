import { NextResponse } from "next/server";
import { verifyPlaySignature } from "@/lib/playAuth";
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

// POST /api/play/state
//
// Everything the (future) Play UI needs on load: balance, active season,
// open positions, and optionally one market's Play book.
//
// POST rather than GET on purpose — the signature belongs in a body, not
// in a URL that ends up in access logs and browser history.
//
// Auth: signed wallet over  FUNMARKET_PLAY|state|<ts>
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const auth = verifyPlaySignature({
      wallet: body?.wallet,
      signature: body?.signature,
      ts: body?.ts,
      action: "state",
      parts: [],
    });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const account = await ensureAccount(auth.wallet);
    const balance = await ensureDailyGrant(account.id);
    const season = await currentSeason();
    const openTrades = await getTrades({
      accountId: account.id,
      status: "open",
      limit: 200,
    });

    // Optional: include one market's Play book in the same round trip.
    let marketState = null;
    if (body?.market_address) {
      marketState = await getMarketState(
        normalizeMarketAddress(body.market_address)
      );
    }

    return NextResponse.json({
      account: {
        id: account.id,
        wallet_address: account.wallet_address,
        balance_usd: balance,
        last_grant_date: account.last_grant_date,
        is_eligible: account.is_eligible,
      },
      season,
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
