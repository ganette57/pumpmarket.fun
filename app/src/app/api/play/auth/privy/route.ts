import { NextResponse } from "next/server";
import {
  createPlaySessionToken,
  PLAY_COOKIE_NAME,
  PLAY_COOKIE_OPTIONS,
  PLAY_SESSION_MAX_AGE_SEC,
} from "@/lib/playAuth";
import {
  ensureAccountForPrivy,
  ensureDailyGrant,
  currentSeason,
  PlayEngineError,
} from "@/lib/playEngine";
import {
  PrivyAuthError,
  isPrivyServerConfigured,
  readBearerToken,
  verifyPrivyToken,
} from "@/lib/privyServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/auth/privy      Authorization: Bearer <privy access token>
//
// The Google sign-in path into Play. The wallet-signature path
// (/auth/nonce + /auth/verify) is untouched and still serves legacy
// users; this is a second door into the same room, and both end by
// setting the identical play_session cookie. Every other Play route is
// unchanged and cannot tell which door was used.
//
// WHY THERE IS NO REQUEST BODY
// ----------------------------
// There is nothing a client could put in one that this endpoint would
// believe. The DID comes from a cryptographically verified token; the
// wallet address is read back from Privy's API using that DID. A body
// carrying either would be an invitation to claim someone else's Play
// account by naming it — see the note at the top of lib/privyServer.ts.
//
// The one wallet-signature guarantee this path deliberately does NOT
// reproduce is proof of Solana key custody. It does not need it: Play is
// virtual money, and the user's claim is on a Google account, not on a
// keypair. Real trading still requires an actual signature for every
// transaction, from whichever wallet holds the funds.
export async function POST(req: Request) {
  try {
    if (!isPrivyServerConfigured()) {
      // A deployment without Privy env vars still runs; it just cannot
      // offer this login. 501 rather than 500: nothing is broken, the
      // feature is simply not configured here.
      return NextResponse.json(
        { error: "Google sign-in is not configured on this deployment" },
        { status: 501 }
      );
    }

    const token = readBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { error: "Missing Privy access token" },
        { status: 401 }
      );
    }

    const identity = await verifyPrivyToken(token);

    // The embedded wallet is created by Privy at login. If the very first
    // request beats that, say so plainly and let the client retry —
    // inventing a placeholder address here would create a Play account
    // pinned to an address the user does not own.
    if (!identity.embeddedSolanaAddress) {
      return NextResponse.json(
        {
          error: "Your wallet is still being created. Try again in a moment.",
          retryable: true,
        },
        { status: 409 }
      );
    }

    const account = await ensureAccountForPrivy({
      privyUserId: identity.userId,
      wallet: identity.embeddedSolanaAddress,
    });

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

    // The SAME cookie the wallet path issues, bound to the account's
    // pinned wallet_address. That is what lets /state, /quote, /trade,
    // /history, /profile, /leaderboard and /contest stay exactly as they
    // are — they read a session, not a login method.
    res.cookies.set(
      PLAY_COOKIE_NAME,
      createPlaySessionToken(account.wallet_address),
      PLAY_COOKIE_OPTIONS
    );

    return res;
  } catch (e: unknown) {
    if (e instanceof PrivyAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/auth/privy] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
