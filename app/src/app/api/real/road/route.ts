import { NextResponse } from "next/server";
import { getRealLeaderboard } from "@/lib/realLeaderboard";
import { getSolUsdPrice } from "@/lib/solPrice";
import { computeRoadProgress } from "@/lib/realRoad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

// GET/POST /api/real/road
//
// The community Road to $100M, WITHOUT the trader ranking.
//
// WHY THIS EXISTS RATHER THAN A SECOND CALCULATION
// ------------------------------------------------
// /treasury and /leaderboard must never disagree about how much volume
// has been traded, what the next milestone is, or how far along it is.
// The only way to guarantee that is for both to be the SAME computation,
// so this route delegates to getRealLeaderboard and computeRoadProgress
// exactly as the leaderboard route does — it derives nothing of its own.
//
// The previous /treasury page proved the point: it summed a different
// column, priced SOL at a hardcoded $150, and carried its own 12-rung
// milestone ladder, so the two pages disagreed on the dollar figure by
// roughly 2x and never named the same next milestone.
//
// WHY NOT JUST CALL /api/real/leaderboard
// ---------------------------------------
// The treasury renders no trader, so it should not receive a list of
// wallets, usernames and avatars it will not display. Same numbers,
// smaller surface.
//
// PUBLIC — no session required. Carries no wallet, no balance, no private
// id and no admin field. Environment gating and the DEVNET flag come
// through unchanged from the leaderboard layer.
async function handle() {
  const [leaderboard, price] = await Promise.all([
    // limit: 1 — the rows are discarded; only meta.total_real_volume_sol
    // and the environment flags are read.
    getRealLeaderboard({ limit: 1 }),
    getSolUsdPrice().catch(() => null),
  ]);

  const road = computeRoadProgress({
    volumeSol: leaderboard.meta.total_real_volume_sol,
    solUsd: price?.usd ?? null,
    priceAsOf: price?.as_of ?? null,
  });

  return NextResponse.json(
    {
      road,
      cluster: leaderboard.meta.cluster,
      is_test_data: leaderboard.meta.is_test_data,
      generated_at: leaderboard.meta.generated_at,
      sol_usd: price,
    },
    { headers: NO_STORE }
  );
}

function fail(e: unknown) {
  console.error("[/api/real/road] error:", e);
  const message = String((e as { message?: string })?.message || "Server error");
  return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
}

export async function GET() {
  try {
    return await handle();
  } catch (e) {
    return fail(e);
  }
}

export async function POST() {
  try {
    return await handle();
  } catch (e) {
    return fail(e);
  }
}
