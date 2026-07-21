// app/src/lib/playAuth.ts
//
// Signed-wallet authentication for the Play Mode backend.
//
// This deliberately reuses the ed25519 scheme this repo already runs in
// production for live-session host actions (see
// app/src/app/api/live-sessions/[id]/status/route.ts): the caller signs a
// domain-prefixed message with their Solana wallet and we verify the
// detached signature against the base58 public key. No new dependency,
// no new concept for the frontend to learn.
//
// A wallet address in a request body is NOT identity. It becomes identity
// only after nacl.sign.detached.verify() succeeds over a message that
// contains that same wallet, a fresh timestamp, and the parameters of the
// action being authorized.
//
// KNOWN LIMITATION (internal beta, documented deliberately)
// --------------------------------------------------------
// There is no server-issued nonce, so a captured signature can be
// replayed inside the MAX_DRIFT_MS window. This is contained:
//   * /api/play/trade is bound to a client_trade_id, and the engine's
//     unique (account_id, client_trade_id) index makes a replay a no-op
//     that returns the original trade and moves no money;
//   * every other Play route is a read.
// A nonce table (issue -> sign -> consume) is the Phase 1.5 hardening
// step and is required before Play Mode is exposed to the public.

import nacl from "tweetnacl";
import bs58 from "bs58";

/** Same replay window the live-session routes already use. */
const MAX_DRIFT_MS = 2 * 60_000;

const DOMAIN = "FUNMARKET_PLAY";

export type PlayAuthOk = { ok: true; wallet: string };
export type PlayAuthErr = { ok: false; error: string; status: number };
export type PlayAuthResult = PlayAuthOk | PlayAuthErr;

/**
 * Canonical message for a Play action. The frontend must build the exact
 * same string and sign it with `signMessage`.
 *
 *   FUNMARKET_PLAY|<action>|<part>|...|<ts>
 *
 * Parts bind the signature to the specific action, so a signature
 * authorizing a $10 quote cannot be replayed as a $10,000 trade.
 */
export function playMessage(
  action: string,
  parts: (string | number)[],
  ts: number
): string {
  return [DOMAIN, action, ...parts.map(String), String(ts)].join("|");
}

/**
 * Verifies that `signature` is a valid ed25519 signature by `wallet` over
 * the canonical message for this action. Returns the verified wallet on
 * success; never throws.
 */
export function verifyPlaySignature(input: {
  wallet?: unknown;
  signature?: unknown;
  ts?: unknown;
  action: string;
  parts: (string | number)[];
}): PlayAuthResult {
  const wallet = String(input.wallet ?? "").trim();
  const signature = String(input.signature ?? "").trim();
  const ts = Number(input.ts);

  if (!wallet || !signature || !Number.isFinite(ts)) {
    return {
      ok: false,
      status: 400,
      error: "Missing required fields: wallet, signature, ts",
    };
  }

  // Replay window.
  if (Math.abs(Date.now() - ts) > MAX_DRIFT_MS) {
    return {
      ok: false,
      status: 400,
      error: "Timestamp too far from server time (replay protection)",
    };
  }

  const message = playMessage(input.action, input.parts, ts);
  const messageBytes = new TextEncoder().encode(message);

  let pubKeyBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pubKeyBytes = bs58.decode(wallet);
    sigBytes = bs58.decode(signature);
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Invalid base58 in wallet or signature",
    };
  }

  if (pubKeyBytes.length !== 32 || sigBytes.length !== 64) {
    return { ok: false, status: 400, error: "Malformed wallet or signature" };
  }

  let verified = false;
  try {
    verified = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes);
  } catch {
    verified = false;
  }

  if (!verified) {
    return { ok: false, status: 403, error: "Signature verification failed" };
  }

  return { ok: true, wallet };
}
