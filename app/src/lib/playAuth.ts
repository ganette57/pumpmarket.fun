// app/src/lib/playAuth.ts
//
// Session-based wallet authentication for the Play Mode backend.
//
// The user signs ONCE, at sign-in. Every subsequent Play call (state,
// quote, trade, history) resolves its identity from an httpOnly session
// cookie — no wallet prompt, no signature, and no wallet address read
// from a request body.
//
//   1. POST /api/play/auth/nonce   -> server issues a single-use challenge
//   2. wallet.signMessage(message) -> ONE Phantom prompt, ever
//   3. POST /api/play/auth/verify  -> server verifies + burns the nonce,
//                                     then sets the play_session cookie
//   4. everything else             -> reads the cookie
//
// The session token is a stateless HMAC, matching the convention already
// used for admin sessions in lib/admin.ts. It is bound to the wallet and
// carries its own expiry, which is checked server-side — the cookie's own
// Max-Age is only a client-side hint and is never trusted.
//
// This module is Play-only. It does not touch, wrap or alter any existing
// Real authentication flow.

import crypto from "crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";

export const PLAY_COOKIE_NAME = "play_session";

/** How long a signed-in session lasts before the wallet must sign again. */
export const PLAY_SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days

/** How long an unredeemed sign-in challenge stays valid. */
export const PLAY_NONCE_TTL_SEC = 300; // 5 minutes

const TOKEN_VERSION = "v1";

/* -------------------------------------------------------------------------- */
/*  Secret                                                                     */
/* -------------------------------------------------------------------------- */

// Deliberately a separate secret from ADMIN_SESSION_SECRET: a leaked Play
// key must never be able to mint an admin session, or vice versa.
function getSessionSecret(): string {
  const s = String(process.env.PLAY_SESSION_SECRET || "").trim();
  if (!s) throw new Error("Missing env: PLAY_SESSION_SECRET");
  if (s.length < 32) {
    throw new Error("PLAY_SESSION_SECRET must be at least 32 characters");
  }
  return s;
}

function hmac(input: string): string {
  return crypto.createHmac("sha256", getSessionSecret()).update(input).digest("hex");
}

/* -------------------------------------------------------------------------- */
/*  Sign-in challenge                                                          */
/* -------------------------------------------------------------------------- */

/** Cryptographically random, single-use challenge value. */
export function generateNonce(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * The exact string the wallet signs.
 *
 * Deliberately contains only the wallet and the nonce — no timestamp and
 * no expiry. The nonce already carries a server-side TTL and is
 * single-use, so putting a formatted date in here would add nothing but a
 * class of "client and server serialized the timestamp differently"
 * verification failures.
 *
 * Exported so the client can build the identical string; the server always
 * rebuilds it from its own stored nonce and never trusts a client-supplied
 * message.
 */
export function playSignInMessage(args: {
  wallet: string;
  nonce: string;
}): string {
  return [
    "FunMarket Play — Sign in",
    "",
    `Wallet: ${args.wallet}`,
    `Nonce: ${args.nonce}`,
    "",
    "This signature proves you control this wallet.",
    "It is not a transaction and will not move any funds.",
  ].join("\n");
}

/** Low-level ed25519 detached-signature check. Never throws. */
export function verifyWalletSignature(args: {
  wallet: string;
  message: string;
  signature: string;
}): boolean {
  let pubKeyBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pubKeyBytes = bs58.decode(args.wallet);
    sigBytes = bs58.decode(args.signature);
  } catch {
    return false;
  }
  if (pubKeyBytes.length !== 32 || sigBytes.length !== 64) return false;

  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(args.message),
      sigBytes,
      pubKeyBytes
    );
  } catch {
    return false;
  }
}

/** Shape check only — does not prove ownership. */
export function isPlausibleWallet(wallet: unknown): wallet is string {
  const w = String(wallet ?? "").trim();
  if (w.length < 32 || w.length > 64) return false;
  try {
    return bs58.decode(w).length === 32;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Session token                                                              */
/* -------------------------------------------------------------------------- */

export type PlaySession = {
  wallet: string;
  /** Unix seconds. */
  expiresAt: number;
};

// Format: v1.<wallet>.<expUnix>.<hmac>
// The wallet is base58 and the expiry is digits, so neither can contain
// the '.' separator.
export function createPlaySessionToken(wallet: string): string {
  const exp = Math.floor(Date.now() / 1000) + PLAY_SESSION_MAX_AGE_SEC;
  const payload = `${TOKEN_VERSION}.${wallet}.${exp}`;
  return `${payload}.${hmac(payload)}`;
}

export function readPlaySessionToken(token: string | null): PlaySession | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [version, wallet, expStr, sig] = parts;
  if (version !== TOKEN_VERSION) return null;
  if (!wallet || !sig) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return null;

  // Server-side expiry. The cookie's Max-Age is a client-side hint only.
  if (Math.floor(Date.now() / 1000) >= exp) return null;

  const expected = hmac(`${version}.${wallet}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return { wallet, expiresAt: exp };
}

/* -------------------------------------------------------------------------- */
/*  Cookie plumbing                                                            */
/* -------------------------------------------------------------------------- */

function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

/**
 * The single entry point every authenticated Play route uses.
 * Returns the verified wallet, or null when there is no valid session.
 *
 * A wallet address present in the request body is IGNORED — it is not
 * identity and no Play route reads it.
 */
export function readPlaySession(req: Request): PlaySession | null {
  const cookies = parseCookieHeader(req.headers.get("cookie"));
  return readPlaySessionToken(cookies[PLAY_COOKIE_NAME] || null);
}

export const PLAY_COOKIE_OPTIONS = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: PLAY_SESSION_MAX_AGE_SEC,
};

export const PLAY_COOKIE_CLEAR_OPTIONS = {
  ...PLAY_COOKIE_OPTIONS,
  maxAge: 0,
};
