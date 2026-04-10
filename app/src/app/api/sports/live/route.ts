// GET /api/sports/live?provider=thesportsdb&event_id=ID&sport=basketball
// Returns live score data for a single event.
// NBA/basketball now uses TheSportsDB, same as other sports.
// Server-only. Never throws — returns status "unknown" on error.

import { NextRequest, NextResponse } from "next/server";
import { fetchLiveScore } from "@/lib/sportsProviders/theSportsDbProvider";

const NO_STORE = { "Cache-Control": "no-store" };

function normalizeProvider(input: string | null, sport: string): "thesportsdb" | "" {
  const p = String(input || "").trim().toLowerCase();
  if (p === "thesportsdb" || p === "the-sports-db") return "thesportsdb";

  // Backward compatibility: old NBA calls may still send api-nba.
  if (p === "api-nba") return "thesportsdb";

  // If no provider is passed but a sport is known, default to TheSportsDB.
  if (!p && sport) return "thesportsdb";
  return "";
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const eventId = String(searchParams.get("event_id") || "").trim();
  const sport = String(searchParams.get("sport") || "").trim().toLowerCase();
  const provider = normalizeProvider(searchParams.get("provider"), sport);

  if (!eventId) {
    return NextResponse.json(
      { error: "Missing required param: event_id" },
      { status: 400 },
    );
  }

  if (!provider) {
    return NextResponse.json(
      { error: "Missing required param: provider (or sport for auto-routing)" },
      { status: 400 },
    );
  }

  try {
    const result = await fetchLiveScore(eventId);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch {
    return NextResponse.json({
      provider: "thesportsdb",
      provider_event_id: eventId,
      status: "unknown",
      home_team: "",
      away_team: "",
      home_score: null,
      away_score: null,
      minute: null,
      start_time: null,
      league: null,
      raw: {},
    });
  }
}
