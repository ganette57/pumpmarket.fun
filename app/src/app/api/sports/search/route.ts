import { NextResponse } from "next/server";
import {
  isAvailable as isOddsFeedAvailable,
  searchMatches,
} from "@/lib/sportsProviders/oddsFeedProvider";

// ---------------------------------------------------------------------------
// In-memory TTL cache (60s)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { ts: number; data: any[] }>();

function getCached(key: string): any[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any[]) {
  cache.set(key, { ts: Date.now(), data });
  // Prune old entries (prevent unbounded growth)
  if (cache.size > 200) {
    const now = Date.now();
    Array.from(cache.entries()).forEach(([k, v]) => {
      if (now - v.ts > CACHE_TTL_MS) cache.delete(k);
    });
  }
}

// ---------------------------------------------------------------------------
// Mock fallback (used when RAPIDAPI_KEY is not set)
// ---------------------------------------------------------------------------

type MockMatch = {
  provider: string;
  provider_event_id: string;
  sport: string;
  league: string;
  home_team: string;
  away_team: string;
  start_time: string;
  end_time: string;
};

function futureISO(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
}

function buildMockMatches(): MockMatch[] {
  return [
    // Soccer
    {
      provider: "mock",
      provider_event_id: "mock_psg_om",
      sport: "soccer",
      league: "Ligue 1",
      home_team: "PSG",
      away_team: "Marseille",
      start_time: futureISO(24),
      end_time: futureISO(25.75),
    },
    {
      provider: "mock",
      provider_event_id: "mock_rma_barca",
      sport: "soccer",
      league: "La Liga",
      home_team: "Real Madrid",
      away_team: "Barcelona",
      start_time: futureISO(48),
      end_time: futureISO(49.75),
    },
    {
      provider: "mock",
      provider_event_id: "mock_liv_mancity",
      sport: "soccer",
      league: "Premier League",
      home_team: "Liverpool",
      away_team: "Manchester City",
      start_time: futureISO(36),
      end_time: futureISO(37.75),
    },
    // Basketball
    {
      provider: "mock",
      provider_event_id: "mock_lakers_celtics",
      sport: "basketball",
      league: "NBA",
      home_team: "LA Lakers",
      away_team: "Boston Celtics",
      start_time: futureISO(20),
      end_time: futureISO(22.5),
    },
    {
      provider: "mock",
      provider_event_id: "mock_warriors_bucks",
      sport: "basketball",
      league: "NBA",
      home_team: "Golden State Warriors",
      away_team: "Milwaukee Bucks",
      start_time: futureISO(44),
      end_time: futureISO(46.5),
    },
    // Tennis
    {
      provider: "mock",
      provider_event_id: "mock_alcaraz_djokovic",
      sport: "tennis",
      league: "Roland Garros",
      home_team: "Alcaraz",
      away_team: "Djokovic",
      start_time: futureISO(30),
      end_time: futureISO(33),
    },
    {
      provider: "mock",
      provider_event_id: "mock_sinner_zverev",
      sport: "tennis",
      league: "Australian Open",
      home_team: "Sinner",
      away_team: "Zverev",
      start_time: futureISO(52),
      end_time: futureISO(55),
    },
    // MMA
    {
      provider: "mock",
      provider_event_id: "mock_jones_aspinall",
      sport: "mma",
      league: "UFC 312",
      home_team: "Jon Jones",
      away_team: "Tom Aspinall",
      start_time: futureISO(72),
      end_time: futureISO(72.5),
    },
    // American Football
    {
      provider: "mock",
      provider_event_id: "mock_chiefs_eagles",
      sport: "american_football",
      league: "NFL",
      home_team: "Kansas City Chiefs",
      away_team: "Philadelphia Eagles",
      start_time: futureISO(60),
      end_time: futureISO(63.5),
    },
  ];
}

function mockSearch(q: string, sport?: string): MockMatch[] {
  let matches = buildMockMatches();
  if (sport && sport !== "all") {
    matches = matches.filter((m) => m.sport === sport);
  }
  if (!q) return matches;
  const lq = q.toLowerCase();
  return matches.filter((m) => {
    const haystack = `${m.home_team} ${m.away_team} ${m.league} ${m.sport}`.toLowerCase();
    return haystack.includes(lq);
  });
}

// ---------------------------------------------------------------------------
// Shared search logic
// ---------------------------------------------------------------------------

async function handleSearch(q: string, sport: string, start_time?: string) {
  // Min length 3 server-side
  if (q.length < 3) {
    return NextResponse.json({ matches: [] });
  }

  // No key => mock
  if (!isOddsFeedAvailable()) {
    return NextResponse.json({ matches: mockSearch(q, sport) });
  }

  // Check cache
  const cacheKey = `sport:${sport}:q:${q.toLowerCase()}:st:${start_time || ""}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json({ matches: cached });
  }

  try {
    const matches = await searchMatches({ sport, q, start_time });
    setCache(cacheKey, matches);
    return NextResponse.json({ matches });
  } catch (e: any) {
    console.error("sports/search provider error, falling back to mock:", e?.message);
    return NextResponse.json({ matches: mockSearch(q, sport) });
  }
}

// ---------------------------------------------------------------------------
// Route handlers — GET (legacy) and POST
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const sport = (searchParams.get("sport") || "soccer").trim();
  return handleSearch(q, sport);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const q = String(body.q || "").trim();
    const sport = String(body.sport || "soccer").trim();
    const start_time = body.start_time ? String(body.start_time) : undefined;
    return handleSearch(q, sport, start_time);
  } catch {
    return NextResponse.json({ matches: [] });
  }
}
