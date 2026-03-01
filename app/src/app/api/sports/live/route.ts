// GET /api/sports/live?provider=thesportsdb&event_id=ID&sport=basketball
// Returns live score data for a single event.
// For basketball/NBA: uses API-NBA (api-sports.io) for faster updates.
// For everything else: uses TheSportsDB.
// Server-only. Never throws — returns status "unknown" on error.

import { NextRequest, NextResponse } from "next/server";
import { fetchLiveScore } from "@/lib/sportsProviders/theSportsDbProvider";

// ---------------------------------------------------------------------------
// API-NBA helpers (v2.nba.api-sports.io)
// ---------------------------------------------------------------------------

const APISPORTS_KEY = process.env.APISPORTS_KEY || "";
const API_NBA_URL = process.env.API_NBA_URL || "https://v2.nba.api-sports.io";

function mapApiNbaStatus(s: string): string {
  const map: Record<string, string> = {
    NS: "scheduled",
    Q1: "live",
    Q2: "live",
    Q3: "live",
    Q4: "live",
    OT: "live",
    BT: "live",
    HT: "live",
    FT: "finished",
    AOT: "finished",
    POST: "finished",
    CANC: "cancelled",
    SUSP: "suspended",
    AWD: "finished",
    ABD: "cancelled",
  };
  return map[s] || "scheduled";
}

async function fetchApiNbaLive(gameId: string) {
  if (!APISPORTS_KEY) {
    console.error("[api-nba] APISPORTS_KEY not set");
    return null;
  }

  try {
    const res = await fetch(`${API_NBA_URL}/games?id=${gameId}`, {
      headers: { "x-apisports-key": APISPORTS_KEY },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("[api-nba] fetch error:", res.status);
      return null;
    }

    const data = await res.json();
    const game = data?.response?.[0];
    if (!game) return null;

    return {
      home_score: game.scores?.home?.total ?? 0,
      away_score: game.scores?.away?.total ?? 0,
      status: game.status?.short ?? "NS",
      status_long: game.status?.long ?? "Not Started",
      clock: game.status?.timer ?? null,
      home_team: game.teams?.home?.name ?? "",
      away_team: game.teams?.visitors?.name ?? "",
    };
  } catch (err) {
    console.error("[api-nba] fetch error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const provider = searchParams.get("provider");
  const eventId = searchParams.get("event_id");
  const sport = (searchParams.get("sport") || "").toLowerCase();

  if (!eventId) {
    return NextResponse.json(
      { error: "Missing required param: event_id" },
      { status: 400 },
    );
  }

  // ------------------------------------------------------------------
  // Basketball / NBA → use API-NBA for live scores
  // ------------------------------------------------------------------
  if (sport === "basketball" || sport === "nba") {
    const nba = await fetchApiNbaLive(eventId);
    if (nba) {
      return NextResponse.json(
        {
          provider: "api-nba",
          provider_event_id: eventId,
          status: mapApiNbaStatus(nba.status),
          home_team: nba.home_team,
          away_team: nba.away_team,
          home_score: nba.home_score,
          away_score: nba.away_score,
          minute: nba.clock,
          start_time: null,
          league: "NBA",
          raw: { status_short: nba.status, status_long: nba.status_long, clock: nba.clock },
        },
        { headers: NO_STORE },
      );
    }
    // Fallback to TheSportsDB if API-NBA fails
  }

  // ------------------------------------------------------------------
  // All other sports → TheSportsDB
  // ------------------------------------------------------------------
  if (!provider) {
    return NextResponse.json(
      { error: "Missing required param: provider (or sport for auto-routing)" },
      { status: 400 },
    );
  }

  if (provider !== "thesportsdb" && provider !== "api-nba") {
    return NextResponse.json(
      { error: `Unsupported provider: ${provider}. Supported: thesportsdb, api-nba` },
      { status: 400 },
    );
  }

  try {
    const result = await fetchLiveScore(eventId);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch {
    return NextResponse.json({
      provider: provider || "thesportsdb",
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
