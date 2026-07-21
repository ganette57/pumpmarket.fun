import { NextResponse } from "next/server";
import { PLAY_COOKIE_NAME, PLAY_COOKIE_CLEAR_OPTIONS } from "@/lib/playAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/auth/logout
//
// Clears the Play session cookie. Safe to call without a session.
//
// Note: the session token is a stateless HMAC, so this expires the
// browser's copy rather than revoking the token server-side. A copy
// captured before logout stays valid until its own expiry. Acceptable for
// a wallet-only internal beta; server-side revocation (a session table or
// a per-account token epoch) is the upgrade path if it is ever needed.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PLAY_COOKIE_NAME, "", PLAY_COOKIE_CLEAR_OPTIONS);
  return res;
}
