import { NextResponse } from "next/server";
import { verifyPlaySignature } from "@/lib/playAuth";
import {
  ensureAccount,
  ensureDailyGrant,
  currentSeason,
  PlayEngineError,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/account
//
// Resolves (or creates) the Play account for a verified wallet and applies
// the daily grant if this is the wallet's first Play interaction today.
//
// Auth: signed wallet. The client must sign
//   FUNMARKET_PLAY|account|<ts>
// with signMessage() and send { wallet, signature, ts }.
//
// A wallet address alone is never accepted as identity.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const auth = verifyPlaySignature({
      wallet: body?.wallet,
      signature: body?.signature,
      ts: body?.ts,
      action: "account",
      parts: [],
    });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const account = await ensureAccount(auth.wallet);
    const balance = await ensureDailyGrant(account.id);
    const season = await currentSeason();

    return NextResponse.json({
      account: {
        id: account.id,
        wallet_address: account.wallet_address,
        balance_usd: balance,
        last_grant_date: account.last_grant_date,
        is_eligible: account.is_eligible,
        created_at: account.created_at,
      },
      season,
    });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/account] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
