import { NextResponse } from "next/server";
import { verifyPlaySignature } from "@/lib/playAuth";
import {
  quote,
  normalizeStake,
  normalizeOutcomeIndex,
  normalizeMarketAddress,
  PlayEngineError,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/quote
//
// Informational only. Nothing is written, no money moves, and the returned
// numbers are NOT binding: /api/play/trade recomputes everything under a
// row lock. A stale quote can therefore only produce a slightly different
// fill, never a corrupted one.
//
// Auth: signed wallet over
//   FUNMARKET_PLAY|quote|<market_address>|<outcome_index>|<stake_usd>|<ts>
//
// The stake and outcome are inside the signed message so a signature
// authorizing one quote cannot be replayed against a different one.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const marketAddress = normalizeMarketAddress(body?.market_address);
    const outcomeIndex = normalizeOutcomeIndex(body?.outcome_index);
    const stakeUsd = normalizeStake(body?.stake_usd);

    const auth = verifyPlaySignature({
      wallet: body?.wallet,
      signature: body?.signature,
      ts: body?.ts,
      action: "quote",
      parts: [marketAddress, outcomeIndex, stakeUsd],
    });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const result = await quote({
      wallet: auth.wallet,
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
