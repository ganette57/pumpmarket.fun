// src/lib/playContestApi.ts
//
// Shared plumbing for the /api/admin/play-contests/* routes.
//
// ADMIN PROTECTION — the SAME gate every other admin route uses
// -------------------------------------------------------------
// adminWalletFromRequest verifies the HMAC-signed `admin_session` cookie
// (issued by /api/admin/auth, 7-day expiry, timing-safe compare) and then
// checks the wallet it carries against NEXT_PUBLIC_ADMIN_WALLET. Every
// contest route refuses without it: there is no public read path and no
// public write path to a contest, a frozen result or an audit.
//
// The service-role Supabase client lives entirely inside playContests.ts,
// which is `server-only`. No route returns a service key, and both contest
// tables have RLS enabled with no anon/authenticated policies, so the
// browser has no route to them at all.

import { NextResponse } from "next/server";
import { adminWalletFromRequest } from "@/lib/admin";
import { PlayEngineError } from "@/lib/playEngine";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

/** The verified admin wallet, or a 401 response to return as-is. */
export async function requireAdmin(
  req: Request
): Promise<{ wallet: string; deny: null } | { wallet: null; deny: NextResponse }> {
  const wallet = await adminWalletFromRequest(req).catch(() => null);
  if (!wallet) {
    return {
      wallet: null,
      deny: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS }
      ),
    };
  }
  return { wallet, deny: null };
}

/** Explicit, operator-readable errors. Never a silent fallback. */
export function contestError(e: unknown, label: string): NextResponse {
  if (e instanceof PlayEngineError) {
    return NextResponse.json(
      { error: e.message },
      { status: e.status, headers: NO_STORE_HEADERS }
    );
  }
  console.error(`[${label}] error:`, e);
  const message = String((e as { message?: string })?.message || "Server error");
  return NextResponse.json(
    { error: message },
    { status: 500, headers: NO_STORE_HEADERS }
  );
}

export function contestOk(body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { headers: NO_STORE_HEADERS });
}

export async function readJsonBody(req: Request): Promise<any> {
  return req.json().catch(() => ({}));
}
