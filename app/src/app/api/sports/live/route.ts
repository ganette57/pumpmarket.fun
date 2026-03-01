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

type NbaGameResult = {
  home_score: number;
  away_score: number;
  status: string;
  status_long: string;
  clock: string | null;
  home_team: string;
  away_team: string;
};

function parseNbaGame(game: any): NbaGameResult | null {
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
}

/** Try direct game ID lookup on API-NBA */
async function fetchApiNbaById(gameId: string): Promise<NbaGameResult | null> {
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
      console.error(`[api-nba] HTTP ${res.status} for games?id=${gameId}`);
      return null;
    }

    const data = await res.json();
    const game = data?.response?.[0];
    if (!game) {
      console.warn(`[api-nba] No game found for id=${gameId} (results: ${data?.results ?? 0})`);
      return null;
    }
    return parseNbaGame(game);
  } catch (err) {
    console.error("[api-nba] fetchById error:", err);
    return null;
  }
}

/**
 * Search API-NBA for a game by date + team name matching.
 * Used when the stored event ID is a TheSportsDB ID (not an API-NBA ID).
 */
async function searchApiNbaByTeams(
  homeTeam: string,
  awayTeam: string,
  dateHint: string | null,
): Promise<NbaGameResult | null> {
  if (!APISPORTS_KEY || (!homeTeam && !awayTeam)) return null;

  // Use provided date or today
  const dateStr = dateHint
    ? dateHint.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  console.log(`[api-nba] Searching games on ${dateStr} for "${homeTeam}" vs "${awayTeam}"`);

  try {
    const res = await fetch(`${API_NBA_URL}/games?date=${dateStr}`, {
      headers: { "x-apisports-key": APISPORTS_KEY },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`[api-nba] HTTP ${res.status} for games?date=${dateStr}`);
      return null;
    }

    const data = await res.json();
    const games: any[] = data?.response || [];
    console.log(`[api-nba] Found ${games.length} games on ${dateStr}`);

    if (games.length === 0) return null;

    // Normalize team name for matching: lowercase, strip city prefixes
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Check if name a is contained in name b or vice-versa (fuzzy city/nickname match)
    const teamMatch = (dbName: string, nbaName: string): boolean => {
      const a = norm(dbName);
      const b = norm(nbaName);
      if (!a || !b) return false;
      if (a === b) return true;
      // Match partial: "Brooklyn Nets" vs "Nets", "Cleveland Cavaliers" vs "Cavaliers"
      // Split into words and check if any meaningful word (>3 chars) overlaps
      const wordsA = dbName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const wordsB = nbaName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      return wordsA.some((wa) => wordsB.some((wb) => wa === wb || wa.includes(wb) || wb.includes(wa)));
    };

    // Try to find the matching game
    for (const g of games) {
      const nbaHome = g.teams?.home?.name || "";
      const nbaAway = g.teams?.visitors?.name || "";

      const homeOk = teamMatch(homeTeam, nbaHome) || teamMatch(homeTeam, nbaAway);
      const awayOk = teamMatch(awayTeam, nbaHome) || teamMatch(awayTeam, nbaAway);

      if (homeOk && awayOk) {
        console.log(`[api-nba] Matched: ${nbaHome} vs ${nbaAway} (id=${g.id})`);
        return parseNbaGame(g);
      }
    }

    // If only one game today and no match (name format might differ a lot), use it
    if (games.length === 1) {
      console.log(`[api-nba] Only one game today, using it as fallback`);
      return parseNbaGame(games[0]);
    }

    console.warn(`[api-nba] No team match found among ${games.length} games`);
    return null;
  } catch (err) {
    console.error("[api-nba] searchByTeams error:", err);
    return null;
  }
}

/**
 * Main NBA fetch: try direct ID first, then fall back to date+team search.
 * The eventId may be a TheSportsDB ID, so we use TheSportsDB to get team names
 * and then search API-NBA by date + teams.
 */
async function fetchApiNbaLive(
  eventId: string,
  tsdbHomeTeam?: string,
  tsdbAwayTeam?: string,
  tsdbDate?: string | null,
): Promise<NbaGameResult | null> {
  // 1) Try direct API-NBA ID lookup
  const direct = await fetchApiNbaById(eventId);
  if (direct) return direct;

  // 2) Direct lookup failed — the eventId is likely a TheSportsDB ID.
  //    Search API-NBA by date + team names.
  if (tsdbHomeTeam && tsdbAwayTeam) {
    console.log(`[api-nba] Direct id=${eventId} not found, searching by teams`);
    return searchApiNbaByTeams(tsdbHomeTeam, tsdbAwayTeam, tsdbDate || null);
  }

  return null;
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
    // First get event metadata from TheSportsDB (team names + date) so we can
    // search API-NBA by date+teams if the direct ID lookup fails (the stored
    // provider_event_id is typically a TheSportsDB ID, not an API-NBA ID).
    let tsdbHome = "";
    let tsdbAway = "";
    let tsdbDate: string | null = null;
    try {
      const tsdb = await fetchLiveScore(eventId);
      tsdbHome = tsdb.home_team || "";
      tsdbAway = tsdb.away_team || "";
      tsdbDate = tsdb.start_time || (tsdb.raw as any)?.date_event || null;
    } catch {
      // TheSportsDB lookup failed — we'll still try direct API-NBA ID
    }

    const nba = await fetchApiNbaLive(eventId, tsdbHome, tsdbAway, tsdbDate);
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
    // Fallback to TheSportsDB if API-NBA fails entirely
    console.warn(`[LIVE] API-NBA failed for basketball event ${eventId}, falling back to TheSportsDB`);
  }

  // ------------------------------------------------------------------
  // All other sports → TheSportsDB
  // ------------------------------------------------------------------
  const effectiveProvider = provider || (sport ? "thesportsdb" : "");

  if (!effectiveProvider) {
    return NextResponse.json(
      { error: "Missing required param: provider (or sport for auto-routing)" },
      { status: 400 },
    );
  }

  if (effectiveProvider !== "thesportsdb" && effectiveProvider !== "api-nba") {
    return NextResponse.json(
      { error: `Unsupported provider: ${effectiveProvider}. Supported: thesportsdb, api-nba` },
      { status: 400 },
    );
  }

  try {
    const result = await fetchLiveScore(eventId);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch {
    return NextResponse.json({
      provider: effectiveProvider || "thesportsdb",
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
