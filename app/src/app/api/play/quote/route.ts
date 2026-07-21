import { NextResponse } from "next/server";
import { readPlaySession } from "@/lib/playAuth";
import {
  quote,
  normalizeStake,
  normalizeOutcomeIndex,
  normalizeMarketAddress,
  PlayEngineError,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/quote   { market_address, outcome_index, stake_usd }
//
// Informational only. Nothing is written, no money moves, and the returned
// numbers are NOT binding: /api/play/trade recomputes everything under a
// row lock. A stale quote can therefore only produce a slightly different
// fill, never a corrupted one.
//
// Auth: the play_session cookie. Called on every amount keystroke, so it
// must never touch the wallet.
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
    const outcomeIndex = normalizeOutcomeIndex(body?.outcome_index);
    const stakeUsd = normalizeStake(body?.stake_usd);

    const result = await quote({
      wallet: session.wallet,
      marketAddress,
      outcomeIndex,
      stakeUsd,
    });

    return NextResponse.json({ quote: result });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/quote] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
