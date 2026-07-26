import { NextResponse } from "next/server";
import { readPlaySession } from "@/lib/playAuth";
import { getPlayLeaderboard, PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/leaderboard   { limit? }
//
// The public Play leaderboard, ranked by authoritative realized P&L.
//
// PUBLIC ON PURPOSE — no Play session required, exactly like
// /api/play/markets, /api/play/markets/history and /api/play/markets/activity.
// A leaderboard is public performance data in both modes; a signed-out visitor
// sees the same ranking as everyone else.
//
// The one session-dependent field is `viewer`: the caller's OWN row, including
// their rank when they fall outside the visible page. Identity for it comes
// from the HMAC-verified session cookie and never from a body field, so a
// caller can only ever ask about themselves. It carries the same public stats
// as any other row — no balance.
//
// getPlayLeaderboard reads only settled play_trades rows via the service-role
// client (Play tables have RLS with no anon policies, so this is the only path
// in). Its projection carries no balance, no play_accounts UUID, no
// client_trade_id, no ledger row and no session data.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const rawLimit = Number(body?.limit);
    const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;

    const session = readPlaySession(req);

    const leaderboard = await getPlayLeaderboard({
      limit,
      viewerWallet: session?.wallet ?? null,
    });

    return NextResponse.json({ leaderboard });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/leaderboard] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
