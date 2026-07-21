import { NextResponse } from "next/server";
import {
  generateNonce,
  playSignInMessage,
  isPlausibleWallet,
  PLAY_NONCE_TTL_SEC,
} from "@/lib/playAuth";
import { issueNonce, PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/auth/nonce   { wallet }
//
// Step 1 of 2 in Play sign-in. Issues a single-use, short-lived challenge
// bound to the supplied wallet and returns the exact message to sign.
//
// This endpoint is intentionally unauthenticated — it IS the start of
// authentication. Handing out a nonce grants nothing: it is worthless
// without a valid ed25519 signature from the wallet it is bound to, it
// expires in PLAY_NONCE_TTL_SEC, and play_issue_nonce caps the number of
// simultaneously outstanding challenges per wallet.
//
// The `message` returned here is a convenience for the client. The server
// rebuilds it from its own stored nonce at verify time and never trusts a
// client-supplied message.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const wallet = String(body?.wallet ?? "").trim();

    if (!isPlausibleWallet(wallet)) {
      return NextResponse.json(
        { error: "A valid Solana wallet address is required" },
        { status: 400 }
      );
    }

    const nonce = generateNonce();
    const row = await issueNonce({
      wallet,
      nonce,
      ttlSeconds: PLAY_NONCE_TTL_SEC,
    });

    return NextResponse.json({
      nonce: row.nonce,
      message: playSignInMessage({ wallet, nonce: row.nonce }),
      expires_at: row.expires_at,
    });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/auth/nonce] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
