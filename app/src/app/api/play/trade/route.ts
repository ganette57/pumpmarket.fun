import { NextResponse } from "next/server";
import { verifyPlaySignature } from "@/lib/playAuth";
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
//
// Executes a virtual buy. Everything below the signature check happens
// inside a single Postgres transaction (play_execute_trade): grant, season
// check, market gate, market-state row lock, authoritative re-quote,
// conditional balance debit, supply/pool update, trade row, ledger row.
//
// Nothing the client sends about price, shares, supply, pool, payout or
// balance is trusted or even read — those all come from the locked row.
//
// Auth: signed wallet over
//   FUNMARKET_PLAY|trade|<market_address>|<outcome_index>|<stake_usd>|<client_trade_id>|<ts>
//
// Replay safety: the signature is bound to client_trade_id, and the engine
// has a unique index on (account_id, client_trade_id). Replaying a captured
// request returns the ORIGINAL trade with `replayed: true` and moves no
// money — which is also exactly what a double-tapped button does.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const marketAddress = normalizeMarketAddress(body?.market_address);
    const outcomeIndex = normalizeOutcomeIndex(body?.outcome_index);
    const stakeUsd = normalizeStake(body?.stake_usd);
    const clientTradeId = normalizeClientTradeId(body?.client_trade_id);

    const auth = verifyPlaySignature({
      wallet: body?.wallet,
      signature: body?.signature,
      ts: body?.ts,
      action: "trade",
      parts: [marketAddress, outcomeIndex, stakeUsd, clientTradeId],
    });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const result = await executeTrade({
      wallet: auth.wallet,
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
