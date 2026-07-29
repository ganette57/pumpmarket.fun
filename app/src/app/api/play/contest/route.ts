import { NextResponse } from "next/server";
import { readPlaySession } from "@/lib/playAuth";
import { getPublicPlayContestView } from "@/lib/playContests";
import { PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET/POST /api/play/contest   { limit? }
//
// The current PUBLIC Play competition: the contest, its ranking, the
// caller's own row, and enough meta for a visitor to know how final any
// of it is.
//
// PUBLIC ON PURPOSE — no Play session required, exactly like
// /api/play/leaderboard, /api/play/markets and /api/play/profile. A
// competition and its standings are public by definition.
//
// The one session-dependent field is `viewer`: the caller's OWN row,
// including their rank when it falls outside the visible page. Identity
// for it comes from the HMAC-verified Play session cookie and never from
// a body field, so a caller can only ever ask about themselves. It
// carries the same public stats as any other row — no balance.
//
// WHAT THIS ROUTE CANNOT LEAK
// ---------------------------
// getPublicPlayContestView builds a separate, strictly narrower shape
// rather than deleting fields from the admin one, so created_by,
// frozen_by, verified_by, notes, timezone, prize_status,
// payment_reference, admin_note, paid_at, play_accounts UUIDs,
// client_trade_ids, ledger rows and session data have no path to this
// response at all.
//
// GET is the natural verb and is what the contract specifies; POST is
// accepted too because every other Play client call goes through one
// shared POST transport.
async function handle(limit: number | undefined, req: Request) {
  const session = readPlaySession(req);

  const view = await getPublicPlayContestView({
    limit,
    viewerWallet: session?.wallet ?? null,
  });

  return NextResponse.json(view, {
    headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" },
  });
}

function fail(e: unknown) {
  if (e instanceof PlayEngineError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[/api/play/contest] error:", e);
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const raw = Number(new URL(req.url).searchParams.get("limit"));
    return await handle(Number.isFinite(raw) ? raw : undefined, req);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw = Number(body?.limit);
    return await handle(Number.isFinite(raw) ? raw : undefined, req);
  } catch (e) {
    return fail(e);
  }
}
