import { NextResponse } from "next/server";
import {
  playSignInMessage,
  verifyWalletSignature,
  isPlausibleWallet,
  createPlaySessionToken,
  PLAY_COOKIE_NAME,
  PLAY_COOKIE_OPTIONS,
  PLAY_SESSION_MAX_AGE_SEC,
} from "@/lib/playAuth";
import {
  consumeNonce,
  ensureAccount,
  ensureDailyGrant,
  currentSeason,
  PlayEngineError,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/auth/verify   { wallet, nonce, signature }
//
// Step 2 of 2. Verifies the wallet signature over the challenge, then
// issues the Play session cookie. This is the ONLY endpoint that ever
// asks the user's wallet to sign — from here on, every Play call reads
// the cookie.
//
// Ordering note: the nonce is CONSUMED BEFORE the signature is checked.
// That is deliberate. Consuming first means a stolen or guessed challenge
// gets exactly one verification attempt, and two concurrent redemptions
// race on the same row so only one can win. The cost is that a failed
// signature burns the challenge and the client must request a fresh one —
// the right trade for an authentication path.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const wallet = String(body?.wallet ?? "").trim();
    const nonce = String(body?.nonce ?? "").trim();
    const signature = String(body?.signature ?? "").trim();

    if (!isPlausibleWallet(wallet)) {
      return NextResponse.json(
        { error: "A valid Solana wallet address is required" },
        { status: 400 }
      );
    }
    if (!nonce || !signature) {
      return NextResponse.json(
        { error: "Missing required fields: nonce, signature" },
        { status: 400 }
      );
    }

    // Atomic single-use redemption. Also enforces wallet binding and TTL.
    const consumed = await consumeNonce({ nonce, wallet });
    if (!consumed) {
      return NextResponse.json(
        { error: "Sign-in challenge is invalid, expired or already used" },
        { status: 401 }
      );
    }

    // Rebuild the message from OUR stored nonce, never from the body.
    const message = playSignInMessage({
      wallet: consumed.wallet_address,
      nonce: consumed.nonce,
    });

    if (!verifyWalletSignature({ wallet, message, signature })) {
      return NextResponse.json(
        { error: "Signature verification failed" },
        { status: 403 }
      );
    }

    // Signature is good: the wallet is proven. Set up the Play account.
    const account = await ensureAccount(wallet);
    const balance = await ensureDailyGrant(account.id);
    const season = await currentSeason();

    const res = NextResponse.json({
      account: {
        id: account.id,
        wallet_address: account.wallet_address,
        balance_usd: balance,
        last_grant_date: account.last_grant_date,
        is_eligible: account.is_eligible,
        created_at: account.created_at,
      },
      season,
      session_expires_in_sec: PLAY_SESSION_MAX_AGE_SEC,
    });

    res.cookies.set(
      PLAY_COOKIE_NAME,
      createPlaySessionToken(account.wallet_address),
      PLAY_COOKIE_OPTIONS
    );

    return res;
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/auth/verify] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
