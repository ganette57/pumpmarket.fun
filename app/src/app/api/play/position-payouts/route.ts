import { NextResponse } from "next/server";
import { readPlaySession } from "@/lib/playAuth";
import {
  getPlayProfile,
  normalizeMarketAddress,
  PlayEngineError,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only current-position estimates for the account proven by the Play
// session. The shared profile builder owns grouping and authoritative payout
// inputs, so Trade and Profile cannot drift into separate payout engines.
export async function POST(req: Request) {
  try {
    const session = readPlaySession(req);
    if (!session) {
      return NextResponse.json({ error: "Play session required" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const marketAddress = normalizeMarketAddress(body?.market_address);
    const profile = await getPlayProfile(session.wallet, { viewerWallet: session.wallet });
    const positions = profile.positions
      .filter((position) =>
        position.status === "open" && position.market_address === marketAddress
      )
      .map((position) => ({
        market_address: position.market_address,
        outcome_index: position.outcome_index,
        total_shares: position.total_shares,
        estimated_payout_usd: position.estimated_payout_usd,
      }));
    return NextResponse.json({ positions });
  } catch (error: unknown) {
    if (error instanceof PlayEngineError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[/api/play/position-payouts] error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
