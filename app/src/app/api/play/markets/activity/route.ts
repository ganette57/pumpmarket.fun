import { NextResponse } from "next/server";
import { getPlayMarketActivity, PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/markets/activity   { market_address, limit?, before? }
//
// Authoritative PUBLIC Play trade activity for ONE market.
//
// PUBLIC ON PURPOSE — no Play session required, exactly like
// /api/play/markets and /api/play/markets/history. Who traded what on a
// market is public market information in both modes (Real activity is already
// visible to signed-out visitors). What this route must never leak is
// account-scoped data, and it doesn't: the projection in getPlayMarketActivity
// drops account_id, client_trade_id, balances and every ledger field, and
// truncates the Play wallet server-side before it is serialized.
//
// Rows come from the append-only play_trades ledger — never from a client
// cache, never from chart points, never from Real transactions.
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

    const rawLimit = Number(body?.limit);
    const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
    const before =
      typeof body?.before === "string" && body.before.trim()
        ? body.before.trim()
        : undefined;

    const activity = await getPlayMarketActivity(marketAddress, {
      limit,
      before,
    });
    return NextResponse.json({ activity });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/markets/activity] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
