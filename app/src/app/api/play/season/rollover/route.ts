import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import { rolloverSeason, currentSeason, PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/play/season/rollover  -> inspect the current season (admin)
// POST /api/play/season/rollover  -> close the expired season, open the next
//
// Auth: existing admin session cookie.
//
// Manual by design for Phase 1 — no Vercel cron is registered. The RPC is
// a no-op unless the open season's ends_at is actually in the past, so an
// accidental POST cannot wipe a live week's bankrolls.
//
// Boundary: Monday 00:00:00 UTC.
// Resets the competition bankroll only. Market odds, trades and ledger
// history are all preserved, and open positions stay settleable with
// their original season attribution.

export async function GET(req: Request) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const season = await currentSeason();
    return NextResponse.json({ season });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/season/rollover GET] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await rolloverSeason();
    return NextResponse.json(result);
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/season/rollover POST] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
