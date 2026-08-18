// app/src/lib/privyServer.ts
//
// Server-side Privy identity. The ONLY place the app decides "this
// request really is Privy user X".
//
// THE RULE THIS FILE EXISTS TO ENFORCE
// ------------------------------------
// A Privy DID in a JSON body proves nothing. Neither does a client user
// object, nor a wallet address. The client sends ONE thing — a Privy
// access token — and everything else about the user is read back from
// Privy's API using the id inside that verified token.
//
// In particular the embedded wallet address is fetched here, server-side,
// and never taken from the request. Accepting a client-supplied address
// would let anyone claim any Play account by naming its wallet.
//
// Mirrors the existing convention in lib/admin.ts and lib/playAuth.ts:
// secrets are read from env at call time (never at module scope, so a
// missing var fails the one request that needs it rather than the build),
// and nothing here is importable from client code.

import { PrivyClient } from "@privy-io/node";

/** Public app id — the same value the browser bundle already carries. */
function appId(): string {
  const id = String(process.env.NEXT_PUBLIC_PRIVY_APP_ID || "").trim();
  if (!id) throw new Error("Missing env: NEXT_PUBLIC_PRIVY_APP_ID");
  return id;
}

/** Server-only. Never prefixed NEXT_PUBLIC_ — it authenticates as the app. */
function appSecret(): string {
  const secret = String(process.env.PRIVY_APP_SECRET || "").trim();
  if (!secret) throw new Error("Missing env: PRIVY_APP_SECRET");
  return secret;
}

export function isPrivyServerConfigured(): boolean {
  return (
    String(process.env.NEXT_PUBLIC_PRIVY_APP_ID || "").trim().length > 0 &&
    String(process.env.PRIVY_APP_SECRET || "").trim().length > 0
  );
}

let cached: PrivyClient | null = null;

function client(): PrivyClient {
  if (cached) return cached;
  cached = new PrivyClient({
    appId: appId(),
    appSecret: appSecret(),
    // Optional. Supplying the dashboard's verification key lets token
    // verification run entirely locally instead of fetching JWKS on a cold
    // start. Absent, the SDK resolves the key itself.
    jwtVerificationKey: process.env.PRIVY_VERIFICATION_KEY || undefined,
  });
  return cached;
}

/** Raised for anything that should become a 401, never a 500. */
export class PrivyAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "PrivyAuthError";
    this.status = status;
  }
}

export type PrivyIdentity = {
  /** The Privy DID — stable for the life of the account. THE identity. */
  userId: string;
  /**
   * The user's embedded Solana wallet address, or null if Privy has not
   * created one yet (a race with `createOnLogin`, or an external-wallet-only
   * user). Read from Privy's API, never from the client.
   */
  embeddedSolanaAddress: string | null;
  /** Present when the user linked Google. Diagnostics only — not identity. */
  googleEmail: string | null;
};

/**
 * Verifies a Privy access token and returns who it belongs to.
 *
 * Two round trips, both authoritative:
 *   1. verifyAccessToken — cryptographic proof of the DID
 *   2. users._get(did)   — the user's real linked accounts
 *
 * Throws PrivyAuthError on any failure. The caller turns that into a 401;
 * it must never fall through to a "trust the body" path.
 */
export async function verifyPrivyToken(accessToken: string): Promise<PrivyIdentity> {
  const token = String(accessToken || "").trim();
  if (!token) throw new PrivyAuthError("Missing Privy access token");

  const privy = client();

  let userId: string;
  try {
    const claims = await privy.utils().auth().verifyAccessToken(token);
    userId = String(claims.user_id || "").trim();
  } catch {
    // Deliberately opaque: expired, malformed and forged tokens all look
    // the same to the caller. The detail stays in Privy's own error.
    throw new PrivyAuthError("Invalid or expired Privy session");
  }
  if (!userId) throw new PrivyAuthError("Privy token carries no user id");

  let user;
  try {
    user = await privy.users()._get(userId);
  } catch (e) {
    // The token verified but the lookup failed — an upstream problem, not
    // an authentication one, so it must not read as "bad credentials".
    throw new PrivyAuthError("Could not load your Privy account", 502);
  }

  let embeddedSolanaAddress: string | null = null;
  let googleEmail: string | null = null;

  for (const account of user.linked_accounts ?? []) {
    if (
      account.type === "wallet" &&
      account.chain_type === "solana" &&
      account.connector_type === "embedded"
    ) {
      // First one wins. Privy creates exactly one Solana embedded wallet
      // per user under our config (createOnLogin, no createAdditional).
      embeddedSolanaAddress ??= account.address;
    } else if (account.type === "google_oauth") {
      googleEmail ??= account.email ?? null;
    }
  }

  return { userId, embeddedSolanaAddress, googleEmail };
}

/**
 * Pulls the bearer token out of an Authorization header.
 *
 * Header rather than a JSON field on purpose: it keeps the credential out
 * of request bodies that get logged, and matches how every other Privy
 * example passes it.
 */
export function readBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
