import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import {
  settleMarket,
  normalizeMarketAddress,
  PlayEngineError,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/settle   { market_address }
//
// Manually settles the Play side of a market that has already reached a
// terminal state in Supabase (resolution_status 'finalized' with a
// winning_outcome, or 'cancelled').
//
// Auth: the existing admin session cookie (middleware.ts + lib/admin.ts).
// This is an operator tool for Phase 1 testing, not a public endpoint.
//
// PHASE 1 DELIBERATELY DOES NOT touch the Real finalization routes. The
// recommended Phase 2 integration is documented in
// docs/play-mode-engine.md: call settleMarket() at the end of
//   /api/admin/market/approve/commit  and  /api/admin/market/cancel/commit
// inside a try/catch so a Play failure can never block a Real
// finalization, backed by a sweeper cron for anything that slips through.
//
// Settlement is idempotent: calling this twice credits exactly zero the
// second time, so a retry is always safe.
export async function POST(req: Request) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const marketAddress = normalizeMarketAddress(body?.market_address);

    const result = await settleMarket(marketAddress);
    return NextResponse.json(result);
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      // Admin-only endpoint: when the public message was softened for
      // traders, the operator still gets the engine's own words.
      return NextResponse.json(
        { error: e.message, ...(e.detail ? { detail: e.detail } : {}) },
        { status: e.status }
      );
    }
    console.error("[/api/play/settle] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
