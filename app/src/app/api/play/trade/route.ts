import { NextResponse } from "next/server";
import { readPlaySession } from "@/lib/playAuth";
import {
  executeTrade,
  normalizeStake,
  normalizeOutcomeIndex,
  normalizeMarketAddress,
  normalizeClientTradeId,
  PlayEngineError,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/trade
//   { market_address, outcome_index, stake_usd, client_trade_id }
//
// Executes a virtual buy. Everything below the session check happens
// inside a single Postgres transaction (play_execute_trade): grant, season
// check, market gate, market-state row lock, authoritative re-quote,
// conditional balance debit, supply/pool update, trade row, ledger row.
//
// Nothing the client sends about price, shares, supply, pool, payout or
// balance is trusted or even read — those all come from the locked row.
//
// Auth: the play_session cookie ONLY. The wallet is taken from the signed
// session token; a `wallet` field in the body is ignored. A user cannot
// place a trade against another wallet's balance by editing a request.
//
// Idempotency is unchanged by the move to sessions and still rests on
// client_trade_id: the engine has a unique index on
// (account_id, client_trade_id), so a double-tapped button or a retried
// request returns the ORIGINAL trade with `replayed: true` and moves no
// money.
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
    const clientTradeId = normalizeClientTradeId(body?.client_trade_id);

    const result = await executeTrade({
      wallet: session.wallet,
      marketAddress,
      outcomeIndex,
      stakeUsd,
      clientTradeId,
    });

    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/trade] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
