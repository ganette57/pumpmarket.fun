import { NextResponse } from "next/server";
import {
  isAvailable as isOddsFeedAvailable,
  searchMatches,
} from "@/lib/sportsProviders/oddsFeedProvider";

// ---------------------------------------------------------------------------
// In-memory TTL cache (10 min — matches provider's 15 min internal cache)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 10 * 60_000; // 10 minutes
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
  // Prune old entries
  if (cache.size > 100) {
    const now = Date.now();
    Array.from(cache.entries()).forEach(([k, v]) => {
      if (now - v.ts > CACHE_TTL_MS) cache.delete(k);
    });
  }
}

// ---------------------------------------------------------------------------
// Mock fallback (used when RAPIDAPI_KEY is not set)
// Generates fixtures spread across the next 7 days for realistic volume.
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
  status: string;
  label: string;
  raw: Record<string, unknown>;
};

function futureISO(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
}

function buildMockMatches(): MockMatch[] {
  return [
    // Soccer — spread across 7 days
    {
      provider: "mock", provider_event_id: "mock_psg_om", sport: "soccer",
      league: "Ligue 1", home_team: "PSG", away_team: "Marseille",
      start_time: futureISO(6), end_time: futureISO(8.25),
      status: "scheduled", label: "PSG vs Marseille", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_rma_barca", sport: "soccer",
      league: "La Liga", home_team: "Real Madrid", away_team: "Barcelona",
      start_time: futureISO(30), end_time: futureISO(32.25),
      status: "scheduled", label: "Real Madrid vs Barcelona", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_liv_mancity", sport: "soccer",
      league: "Premier League", home_team: "Liverpool", away_team: "Manchester City",
      start_time: futureISO(54), end_time: futureISO(56.25),
      status: "scheduled", label: "Liverpool vs Manchester City", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_bayern_dortmund", sport: "soccer",
      league: "Bundesliga", home_team: "Bayern Munich", away_team: "Borussia Dortmund",
      start_time: futureISO(78), end_time: futureISO(80.25),
      status: "scheduled", label: "Bayern Munich vs Borussia Dortmund", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_inter_juve", sport: "soccer",
      league: "Serie A", home_team: "Inter Milan", away_team: "Juventus",
      start_time: futureISO(102), end_time: futureISO(104.25),
      status: "scheduled", label: "Inter Milan vs Juventus", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_arsenal_chelsea", sport: "soccer",
      league: "Premier League", home_team: "Arsenal", away_team: "Chelsea",
      start_time: futureISO(126), end_time: futureISO(128.25),
      status: "scheduled", label: "Arsenal vs Chelsea", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_napoli_atalanta", sport: "soccer",
      league: "Serie A", home_team: "Napoli", away_team: "Atalanta",
      start_time: futureISO(150), end_time: futureISO(152.25),
      status: "scheduled", label: "Napoli vs Atalanta", raw: {},
    },
    // Basketball
    {
      provider: "mock", provider_event_id: "mock_lakers_celtics", sport: "basketball",
      league: "NBA", home_team: "LA Lakers", away_team: "Boston Celtics",
      start_time: futureISO(10), end_time: futureISO(12.5),
      status: "scheduled", label: "LA Lakers vs Boston Celtics", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_warriors_bucks", sport: "basketball",
      league: "NBA", home_team: "Golden State Warriors", away_team: "Milwaukee Bucks",
      start_time: futureISO(34), end_time: futureISO(36.5),
      status: "scheduled", label: "Golden State Warriors vs Milwaukee Bucks", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_nuggets_sixers", sport: "basketball",
      league: "NBA", home_team: "Denver Nuggets", away_team: "Philadelphia 76ers",
      start_time: futureISO(58), end_time: futureISO(60.5),
      status: "scheduled", label: "Denver Nuggets vs Philadelphia 76ers", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_heat_suns", sport: "basketball",
      league: "NBA", home_team: "Miami Heat", away_team: "Phoenix Suns",
      start_time: futureISO(82), end_time: futureISO(84.5),
      status: "scheduled", label: "Miami Heat vs Phoenix Suns", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_mavs_knicks", sport: "basketball",
      league: "NBA", home_team: "Dallas Mavericks", away_team: "New York Knicks",
      start_time: futureISO(106), end_time: futureISO(108.5),
      status: "scheduled", label: "Dallas Mavericks vs New York Knicks", raw: {},
    },
    // Tennis
    {
      provider: "mock", provider_event_id: "mock_alcaraz_djokovic", sport: "tennis",
      league: "Roland Garros", home_team: "Alcaraz", away_team: "Djokovic",
      start_time: futureISO(20), end_time: futureISO(23),
      status: "scheduled", label: "Alcaraz vs Djokovic", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_sinner_zverev", sport: "tennis",
      league: "Australian Open", home_team: "Sinner", away_team: "Zverev",
      start_time: futureISO(44), end_time: futureISO(47),
      status: "scheduled", label: "Sinner vs Zverev", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_medvedev_rublev", sport: "tennis",
      league: "US Open", home_team: "Medvedev", away_team: "Rublev",
      start_time: futureISO(92), end_time: futureISO(95),
      status: "scheduled", label: "Medvedev vs Rublev", raw: {},
    },
    // MMA
    {
      provider: "mock", provider_event_id: "mock_jones_aspinall", sport: "mma",
      league: "UFC 312", home_team: "Jon Jones", away_team: "Tom Aspinall",
      start_time: futureISO(72), end_time: futureISO(74),
      status: "scheduled", label: "Jon Jones vs Tom Aspinall", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_adesanya_pereira", sport: "mma",
      league: "UFC 313", home_team: "Adesanya", away_team: "Alex Pereira",
      start_time: futureISO(144), end_time: futureISO(146),
      status: "scheduled", label: "Adesanya vs Alex Pereira", raw: {},
    },
    // American Football
    {
      provider: "mock", provider_event_id: "mock_chiefs_eagles", sport: "american_football",
      league: "NFL", home_team: "Kansas City Chiefs", away_team: "Philadelphia Eagles",
      start_time: futureISO(48), end_time: futureISO(51.5),
      status: "scheduled", label: "Kansas City Chiefs vs Philadelphia Eagles", raw: {},
    },
    {
      provider: "mock", provider_event_id: "mock_bills_ravens", sport: "american_football",
      league: "NFL", home_team: "Buffalo Bills", away_team: "Baltimore Ravens",
      start_time: futureISO(120), end_time: futureISO(123.5),
      status: "scheduled", label: "Buffalo Bills vs Baltimore Ravens", raw: {},
    },
  ];
}

function mockMatchList(sport?: string, q?: string): MockMatch[] {
  let matches = buildMockMatches();
  if (sport && sport !== "all") {
    matches = matches.filter((m) => m.sport === sport);
  }
  if (q && q.trim().length >= 3) {
    const lq = q.toLowerCase();
    matches = matches.filter((m) => {
      const haystack = `${m.home_team} ${m.away_team} ${m.league} ${m.sport}`.toLowerCase();
      return haystack.includes(lq);
    });
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Shared handler: returns fixture list for a sport (next 7 days).
// q is optional — used for local filtering if present.
// ---------------------------------------------------------------------------

async function handleList(sport: string, base_date?: string, q?: string) {
  // No key => mock
  if (!isOddsFeedAvailable()) {
    return NextResponse.json({ matches: mockMatchList(sport, q) });
  }

  // Check route-level cache
  const cacheKey = `list:${sport}:${base_date || "today"}:q:${(q || "").toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json({ matches: cached });
  }

  try {
    const matches = await searchMatches({
      sport,
      q: q || undefined,
      start_time: base_date || undefined,
      days: 7,
    });
    setCache(cacheKey, matches);
    return NextResponse.json({ matches });
  } catch (e: any) {
    console.error("sports/search provider error, falling back to mock:", e?.message);
    return NextResponse.json({ matches: mockMatchList(sport, q) });
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") || "soccer").trim();
  const base_date = searchParams.get("base_date") || undefined;
  const q = searchParams.get("q") || undefined;
  return handleList(sport, base_date, q);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sport = String(body.sport || "soccer").trim();
    const base_date = body.base_date ? String(body.base_date) : undefined;
    const q = body.q ? String(body.q) : undefined;
    return handleList(sport, base_date, q);
  } catch {
    return NextResponse.json({ matches: [] });
  }
}
