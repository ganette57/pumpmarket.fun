import { NextResponse } from "next/server";
import { getPlayStartingBankroll, PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/play/settings   {}
//
// The one public Play setting the UI has to be able to state out loud: the
// starting bankroll (play_settings.daily_grant_usd).
//
// PUBLIC ON PURPOSE — like /api/play/leaderboard and /api/play/markets. It
// takes no body, reads no session and returns no per-account data; the value
// is the same for every visitor and is already implied by every Play balance
// on the site.
//
// It exists so onboarding can say "start with $X" from the row the daily
// grant actually credits from, instead of a hardcoded number in a component
// that would silently drift the day the setting changes. Nothing here writes.
export async function POST() {
  try {
    const startingBankrollUsd = await getPlayStartingBankroll();
    return NextResponse.json({ starting_bankroll_usd: startingBankrollUsd });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/settings] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
