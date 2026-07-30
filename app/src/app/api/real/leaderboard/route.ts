import { NextResponse } from "next/server";
import { getRealLeaderboard } from "@/lib/realLeaderboard";
import { getSolUsdPrice } from "@/lib/solPrice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

// GET/POST /api/real/leaderboard   { limit?, wallet? }
//
// The Real "Road to $1M" ranking, by CLAIMED PROFIT in SOL.
//
// PUBLIC — no session required, like every other leaderboard here. Every
// field is public trading history: no balance, no private id, no session
// data, no admin field, no nonce, no signing material.
//
// `wallet` selects WHOSE public row to resolve for the "Your rank" card.
// Unlike Play there is no session cookie to prove Real identity — the
// wallet is simply the one the visitor has connected — but that grants
// nothing: the row returned carries exactly the same public stats as any
// other row on the board, so asking about someone else reveals nothing
// they could not already read from the ranking.
//
// The SOL/USD price is attached here, server-side, for DISPLAY ONLY.
// Ranking is in SOL and never in USD. When no defensible price exists the
// field is null and the client is required to hide every dollar figure.
//
// No fallback to Play data exists in this route or anywhere below it.
async function handle(limit: number | undefined, wallet: string | null) {
  // The price must never be able to break the ranking, so it is resolved
  // alongside and its failure mode is a null field, not an error.
  const [leaderboard, price] = await Promise.all([
    getRealLeaderboard({ limit, viewerWallet: wallet }),
    getSolUsdPrice().catch(() => null),
  ]);

  return NextResponse.json(
    {
      rows: leaderboard.rows,
      viewer: leaderboard.viewer,
      meta: leaderboard.meta,
      /** null when unavailable or stale — hide USD entirely in that case. */
      sol_usd: price,
    },
    { headers: NO_STORE }
  );
}

function fail(e: unknown) {
  console.error("[/api/real/leaderboard] error:", e);
  const message = String((e as { message?: string })?.message || "Server error");
  return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = Number(url.searchParams.get("limit"));
    return await handle(
      Number.isFinite(raw) ? raw : undefined,
      url.searchParams.get("wallet")
    );
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw = Number(body?.limit);
    const wallet = body?.wallet != null ? String(body.wallet) : null;
    return await handle(Number.isFinite(raw) ? raw : undefined, wallet);
  } catch (e) {
    return fail(e);
  }
}
