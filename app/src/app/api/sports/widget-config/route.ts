// GET /api/sports/widget-config?event_id=THESPORTSDB_ID
// Resolves a TheSportsDB event ID → API-NBA game ID and returns widget config.
// Returns { apiKey, gameId, host } for the client-side API-Sports widget.

import { NextRequest, NextResponse } from "next/server";
import { fetchLiveScore } from "@/lib/sportsProviders/theSportsDbProvider";

const APISPORTS_KEY = process.env.APISPORTS_KEY || "";
const API_NBA_URL = process.env.API_NBA_URL || "https://v2.nba.api-sports.io";
const NO_STORE = { "Cache-Control": "no-store" };

// ---------------------------------------------------------------------------
// Resolve TheSportsDB event ID → API-NBA game ID
// ---------------------------------------------------------------------------

/** Search API-NBA games by date and fuzzy-match team names. Returns the game ID. */
async function resolveApiNbaGameId(
  homeTeam: string,
  awayTeam: string,
  dateHint: string | null,
): Promise<number | null> {
  if (!APISPORTS_KEY || (!homeTeam && !awayTeam)) return null;

  const dateStr = dateHint
    ? dateHint.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  try {
    const res = await fetch(`${API_NBA_URL}/games?date=${dateStr}`, {
      headers: { "x-apisports-key": APISPORTS_KEY },
      cache: "no-store",
    });

    if (!res.ok) return null;

    const data = await res.json();
    const games: any[] = data?.response || [];
    if (games.length === 0) return null;

    const teamMatch = (dbName: string, nbaName: string): boolean => {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const a = norm(dbName);
      const b = norm(nbaName);
      if (!a || !b) return false;
      if (a === b) return true;
      const wordsA = dbName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const wordsB = nbaName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      return wordsA.some((wa) => wordsB.some((wb) => wa === wb || wa.includes(wb) || wb.includes(wa)));
    };

    for (const g of games) {
      const nbaHome = g.teams?.home?.name || "";
      const nbaAway = g.teams?.visitors?.name || "";
      const homeOk = teamMatch(homeTeam, nbaHome) || teamMatch(homeTeam, nbaAway);
      const awayOk = teamMatch(awayTeam, nbaHome) || teamMatch(awayTeam, nbaAway);
      if (homeOk && awayOk) return g.id;
    }

    // Fallback: if only one game today, use it
    if (games.length === 1) return games[0].id;

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("event_id");

  if (!eventId) {
    return NextResponse.json(
      { error: "Missing required param: event_id" },
      { status: 400 },
    );
  }

  // 1) Try direct API-NBA ID lookup (eventId might already be an API-NBA ID)
  if (APISPORTS_KEY) {
    try {
      const directRes = await fetch(`${API_NBA_URL}/games?id=${eventId}`, {
        headers: { "x-apisports-key": APISPORTS_KEY },
        cache: "no-store",
      });
      if (directRes.ok) {
        const directData = await directRes.json();
        const directGame = directData?.response?.[0];
        if (directGame?.id) {
          return NextResponse.json(
            {
              apiKey: APISPORTS_KEY,
              gameId: String(directGame.id),
              host: "v2.nba.api-sports.io",
            },
            { headers: NO_STORE },
          );
        }
      }
    } catch {
      // Direct lookup failed, try team search below
    }
  }

  // 2) eventId is a TheSportsDB ID — get team names, then search API-NBA
  let tsdbHome = "";
  let tsdbAway = "";
  let tsdbDate: string | null = null;

  try {
    const tsdb = await fetchLiveScore(eventId);
    tsdbHome = tsdb.home_team || "";
    tsdbAway = tsdb.away_team || "";
    tsdbDate = tsdb.start_time || (tsdb.raw as any)?.date_event || null;
  } catch {
    return NextResponse.json(
      { error: "Could not resolve event from TheSportsDB" },
      { status: 404 },
    );
  }

  const nbaGameId = await resolveApiNbaGameId(tsdbHome, tsdbAway, tsdbDate);

  if (!nbaGameId) {
    return NextResponse.json(
      { error: "Could not find matching API-NBA game" },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      apiKey: APISPORTS_KEY,
      gameId: String(nbaGameId),
      host: "v2.nba.api-sports.io",
    },
    { headers: NO_STORE },
  );
}
