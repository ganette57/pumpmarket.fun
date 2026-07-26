import { NextResponse } from "next/server";
import { readPlaySession } from "@/lib/playAuth";
import { getPlayProfile, PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/profile   { wallet }
//
// One wallet's Play profile: identity, grouped positions and authoritative
// realized P&L.
//
// PUBLIC BY WALLET, OWNER-ONLY BALANCE
// ------------------------------------
// /profile/[wallet] is already a public page in Real Mode, so a Play profile
// is readable by wallet without a session — username, avatar, realized P&L,
// pick count and grouped win/loss history are the public performance record.
//
// The CURRENT BALANCE is the one field that is not. It is spendable state,
// not history, so it is released only when the request carries a Play session
// cookie whose wallet matches the requested wallet. `wallet` in the body
// selects WHOSE PUBLIC PROFILE to read and can never grant ownership: the
// comparison is against the HMAC-verified session wallet, never against a
// body field. A public viewer gets balance_usd: null and is_owner: false.
//
// The projection in getPlayProfile carries no account id, no client_trade_id,
// no ledger row, no season attribution and no session data.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const wallet = String(body?.wallet ?? "").trim();
    if (!wallet) {
      return NextResponse.json({ error: "wallet is required" }, { status: 400 });
    }

    // Identity comes from the cookie and nowhere else.
    const session = readPlaySession(req);

    const profile = await getPlayProfile(wallet, {
      viewerWallet: session?.wallet ?? null,
    });

    return NextResponse.json({ profile });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/profile] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
