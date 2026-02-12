// src/lib/sportsProviders/fixturesProvider.ts
// Server-only: Fixture list provider adapter.
//
// Selects the backend provider based on FIXTURES_PROVIDER env var:
//   "thesportsdb"  — live data from TheSportsDB (multi-sport)
//   "api_football"  — live data from API-Football (soccer only, v3.football.api-sports.io)
//   "mock"          — built-in mock fixtures (default when no keys)
//
// Exports:
//   isAvailable(): boolean
//   listUpcomingMatches({ sport, days?, base_date? }): Promise<NormalizedMatch[]>
//
// Never throws — catches everything and returns [].
// end_time = estimated match end − 2 minutes (T-2 auto-end rule).

// Re-export the NormalizedMatch type from oddsFeedProvider
export type { NormalizedMatch } from "./oddsFeedProvider";
import type { NormalizedMatch } from "./oddsFeedProvider";
import { listUpcomingMatchesTheSportsDB } from "./theSportsDbProvider";

const DEBUG = process.env.SPORTS_DEBUG === "1";

function dbg(...args: unknown[]) {
  if (DEBUG) console.log("[fixtures]", ...args);
}

// ---------------------------------------------------------------------------
// T-2 auto-end rule: trading ends 2 minutes before match end
// ---------------------------------------------------------------------------

const T2_MS = 2 * 60_000; // 2 minutes

function applyT2(endIso: string): string {
  const d = new Date(endIso);
  if (isNaN(d.getTime())) return endIso;
  return new Date(d.getTime() - T2_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Internal cache — 15 min TTL
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 15 * 60_000;
const fixtureCache = new Map<string, { ts: number; data: NormalizedMatch[] }>();

function getCached(key: string): NormalizedMatch[] | null {
  const entry = fixtureCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    fixtureCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: NormalizedMatch[]) {
  fixtureCache.set(key, { ts: Date.now(), data });
  if (fixtureCache.size > 50) {
    const now = Date.now();
    Array.from(fixtureCache.entries()).forEach(([k, v]) => {
      if (now - v.ts > CACHE_TTL_MS) fixtureCache.delete(k);
    });
  }
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

type ProviderName = "mock" | "api_football" | "thesportsdb";

function getApiSportsKey(): string | null {
  return process.env.APISPORTS_KEY || null;
}

function getTheSportsDbKey(): string | null {
  return process.env.THESPORTSDB_KEY || null;
}

function getProviderName(): ProviderName {
  const env = (process.env.FIXTURES_PROVIDER || "").trim().toLowerCase();
  if (env === "thesportsdb" || env === "the-sports-db" || env === "thesportsdb") return "thesportsdb";
  if (env === "api_football" || env === "api-football") return "api_football";
  if (env === "mock") return "mock";
  // Auto-detect: prefer thesportsdb if its key exists, then api_football
  if (getTheSportsDbKey()) return "thesportsdb";
  if (getApiSportsKey()) return "api_football";
  return "mock";
}

export function isAvailable(): boolean {
  const p = getProviderName();
  if (p === "thesportsdb") return true; // works with free key "3" too
  if (p === "api_football") return !!getApiSportsKey();
  return false;
}

// ---------------------------------------------------------------------------
// Default match durations (for estimated end_time)
// ---------------------------------------------------------------------------

const DURATION_MS: Record<string, number> = {
  soccer: 110 * 60_000,                          // 1h50m
  basketball: 2 * 3600_000 + 30 * 60_000,        // 2h30m
  baseball: 3 * 3600_000,                        // 3h
  tennis: 3 * 3600_000,                           // 3h
  mma: 2 * 3600_000,                              // 2h
  american_football: 3 * 3600_000 + 30 * 60_000,  // 3h30m
};

function estimatedEndTime(startIso: string, sport: string): string {
  const ms = DURATION_MS[sport] || DURATION_MS.soccer;
  return new Date(new Date(startIso).getTime() + ms).toISOString();
}

// ---------------------------------------------------------------------------
// API-Football provider (FREE plan compatible)
// Base: https://v3.football.api-sports.io
// Auth: x-apisports-key header
//
// Free plan limitation: `from/to` and `next` parameters are PAID-only.
// We use: GET /fixtures?date=YYYY-MM-DD&league=ID&season=YEAR&timezone=TZ
// One call per day per league. Days clamped to 3 max, 3 leagues = 9 calls max
// per cache miss. With 15min cache that's well under the 100/day free quota.
// ---------------------------------------------------------------------------

const API_FOOTBALL_HOST = "v3.football.api-sports.io";

// Top leagues to fetch. We keep this small to stay within free-plan quota.
// Expand as needed: Serie A = 135, Bundesliga = 78, Champions League = 2, etc.
const API_FOOTBALL_LEAGUES = [
  { id: 61,  name: "Ligue 1" },
  { id: 39,  name: "Premier League" },
  { id: 140, name: "La Liga" },
];

// Max days to fetch per request to stay within free-plan quota
const API_FOOTBALL_MAX_DAYS = 3;

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeApiFootballStatus(short: string): "scheduled" | "live" | "finished" {
  const s = (short || "").toUpperCase();
  // Finished statuses
  if (s === "FT" || s === "AET" || s === "PEN") return "finished";
  // Live statuses
  if (s === "1H" || s === "HT" || s === "2H" || s === "ET" || s === "BT" || s === "P") return "live";
  // Default: scheduled (NS, TBD, PST, CANC, etc.)
  return "scheduled";
}

/** Fetch fixtures for ONE date + ONE league, trying season=currentYear then currentYear-1 */
async function apiFootballFetchDateLeague(
  date: string,
  leagueId: number,
  tz: string,
  key: string,
): Promise<any[]> {
  const currentYear = new Date().getFullYear();
  // Some leagues (e.g. Premier League) use prior year as season (2025-2026 season = 2025).
  // Try current year first; if 0 results, retry with year-1.
  for (const season of [currentYear, currentYear - 1]) {
    const url =
      `https://${API_FOOTBALL_HOST}/fixtures` +
      `?date=${date}&league=${leagueId}&season=${season}` +
      `&timezone=${encodeURIComponent(tz)}`;
    dbg("api-football fetch", url);

    const res = await fetch(url, {
      method: "GET",
      headers: { "x-apisports-key": key },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      dbg("api-football error", res.status, text.slice(0, 300));
      // Don't retry season on HTTP error — bail
      return [];
    }

    const json = await res.json();
    const fixtures: any[] = Array.isArray(json?.response) ? json.response : [];
    dbg(`  league=${leagueId} season=${season} date=${date} → ${fixtures.length} fixtures`);

    if (fixtures.length > 0) return fixtures;
    // 0 results — try previous season
  }
  return [];
}

function apiFootballToMatch(f: any): NormalizedMatch | null {
  if (!f) return null;

  const fixture = f.fixture;
  const teams = f.teams;
  const league = f.league;

  const homeTeam = teams?.home?.name || "";
  const awayTeam = teams?.away?.name || "";
  if (!homeTeam && !awayTeam) return null;

  const fixtureId = fixture?.id;
  if (!fixtureId) return null;

  const startIso = fixture?.date
    ? new Date(fixture.date).toISOString()
    : new Date().toISOString();

  const leagueName = league?.name || "";
  const statusShort = fixture?.status?.short || "";

  return {
    provider: "api-football",
    provider_event_id: String(fixtureId),
    sport: "soccer",
    league: leagueName,
    home_team: homeTeam,
    away_team: awayTeam,
    start_time: startIso,
    end_time: estimatedEndTime(startIso, "soccer"),
    status: normalizeApiFootballStatus(statusShort),
    label: `${homeTeam} vs ${awayTeam}`,
    raw: {
      api_football_id: fixtureId,
      status_short: statusShort,
      status_long: fixture?.status?.long,
      league_id: league?.id,
      season: league?.season,
      country: league?.country,
      round: league?.round,
      venue: fixture?.venue?.name,
      timezone: process.env.APISPORTS_TZ || "Europe/Paris",
    },
  };
}

async function apiFootballListUpcoming(params: {
  sport: string;
  days: number;
  base_date?: string;
}): Promise<NormalizedMatch[]> {
  const { days, base_date } = params;
  // API-Football only supports soccer — return empty for other sports
  if (params.sport !== "soccer") {
    dbg("api-football only supports soccer, returning []");
    return [];
  }

  const key = getApiSportsKey();
  if (!key) {
    dbg("APISPORTS_KEY not set");
    return [];
  }

  const tz = process.env.APISPORTS_TZ || "Europe/Paris";
  const baseDate = base_date ? new Date(base_date) : new Date();
  const clampedDays = Math.min(days, API_FOOTBALL_MAX_DAYS);

  const all: NormalizedMatch[] = [];
  // Fetch each day × each league in parallel (max 9 concurrent requests)
  const fetches: Promise<void>[] = [];

  for (let d = 0; d < clampedDays; d++) {
    const dateStr = formatDate(new Date(baseDate.getTime() + d * 86400_000));
    for (const league of API_FOOTBALL_LEAGUES) {
      fetches.push(
        apiFootballFetchDateLeague(dateStr, league.id, tz, key)
          .then((fixtures) => {
            for (const f of fixtures) {
              const m = apiFootballToMatch(f);
              if (m) all.push(m);
            }
          })
          .catch((e: any) => {
            dbg(`api-football error league=${league.id} date=${dateStr}:`, e?.message);
          }),
      );
    }
  }

  await Promise.all(fetches);
  dbg(`api-football total: ${all.length} fixtures across ${clampedDays} days × ${API_FOOTBALL_LEAGUES.length} leagues`);
  return all;
}

// ---------------------------------------------------------------------------
// Mock fixtures (spread across 7 days, all sports)
// ---------------------------------------------------------------------------

function futureISO(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
}

function futureEndISO(hoursFromNow: number, sport: string): string {
  const durationMs = DURATION_MS[sport] || DURATION_MS.soccer;
  const startMs = Date.now() + hoursFromNow * 3600_000;
  // T-2: end_time = start + duration - 2 min
  return new Date(startMs + durationMs - T2_MS).toISOString();
}

function buildMockMatches(): NormalizedMatch[] {
  return [
    // Soccer — spread across 7 days
    {
      provider: "mock-fixtures", provider_event_id: "mock_psg_om", sport: "soccer",
      league: "Ligue 1", home_team: "PSG", away_team: "Marseille",
      start_time: futureISO(6), end_time: futureEndISO(6, "soccer"),
      status: "scheduled", label: "PSG vs Marseille", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_rma_barca", sport: "soccer",
      league: "La Liga", home_team: "Real Madrid", away_team: "Barcelona",
      start_time: futureISO(30), end_time: futureEndISO(30, "soccer"),
      status: "scheduled", label: "Real Madrid vs Barcelona", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_liv_mancity", sport: "soccer",
      league: "Premier League", home_team: "Liverpool", away_team: "Manchester City",
      start_time: futureISO(54), end_time: futureEndISO(54, "soccer"),
      status: "scheduled", label: "Liverpool vs Manchester City", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_bayern_dortmund", sport: "soccer",
      league: "Bundesliga", home_team: "Bayern Munich", away_team: "Borussia Dortmund",
      start_time: futureISO(78), end_time: futureEndISO(78, "soccer"),
      status: "scheduled", label: "Bayern Munich vs Borussia Dortmund", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_inter_juve", sport: "soccer",
      league: "Serie A", home_team: "Inter Milan", away_team: "Juventus",
      start_time: futureISO(102), end_time: futureEndISO(102, "soccer"),
      status: "scheduled", label: "Inter Milan vs Juventus", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_arsenal_chelsea", sport: "soccer",
      league: "Premier League", home_team: "Arsenal", away_team: "Chelsea",
      start_time: futureISO(126), end_time: futureEndISO(126, "soccer"),
      status: "scheduled", label: "Arsenal vs Chelsea", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_napoli_atalanta", sport: "soccer",
      league: "Serie A", home_team: "Napoli", away_team: "Atalanta",
      start_time: futureISO(150), end_time: futureEndISO(150, "soccer"),
      status: "scheduled", label: "Napoli vs Atalanta", raw: {},
    },
    // Basketball
    {
      provider: "mock-fixtures", provider_event_id: "mock_lakers_celtics", sport: "basketball",
      league: "NBA", home_team: "LA Lakers", away_team: "Boston Celtics",
      start_time: futureISO(10), end_time: futureEndISO(10, "basketball"),
      status: "scheduled", label: "LA Lakers vs Boston Celtics", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_warriors_bucks", sport: "basketball",
      league: "NBA", home_team: "Golden State Warriors", away_team: "Milwaukee Bucks",
      start_time: futureISO(34), end_time: futureEndISO(34, "basketball"),
      status: "scheduled", label: "Golden State Warriors vs Milwaukee Bucks", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_nuggets_sixers", sport: "basketball",
      league: "NBA", home_team: "Denver Nuggets", away_team: "Philadelphia 76ers",
      start_time: futureISO(58), end_time: futureEndISO(58, "basketball"),
      status: "scheduled", label: "Denver Nuggets vs Philadelphia 76ers", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_heat_suns", sport: "basketball",
      league: "NBA", home_team: "Miami Heat", away_team: "Phoenix Suns",
      start_time: futureISO(82), end_time: futureEndISO(82, "basketball"),
      status: "scheduled", label: "Miami Heat vs Phoenix Suns", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_mavs_knicks", sport: "basketball",
      league: "NBA", home_team: "Dallas Mavericks", away_team: "New York Knicks",
      start_time: futureISO(106), end_time: futureEndISO(106, "basketball"),
      status: "scheduled", label: "Dallas Mavericks vs New York Knicks", raw: {},
    },
    // Baseball
    {
      provider: "mock-fixtures", provider_event_id: "mock_yankees_redsox", sport: "baseball",
      league: "MLB", home_team: "Yankees", away_team: "Red Sox",
      start_time: futureISO(26), end_time: futureEndISO(26, "baseball"),
      status: "scheduled", label: "Yankees vs Red Sox", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_dodgers_giants", sport: "baseball",
      league: "MLB", home_team: "Dodgers", away_team: "Giants",
      start_time: futureISO(98), end_time: futureEndISO(98, "baseball"),
      status: "scheduled", label: "Dodgers vs Giants", raw: {},
    },
    // Tennis
    {
      provider: "mock-fixtures", provider_event_id: "mock_alcaraz_djokovic", sport: "tennis",
      league: "Roland Garros", home_team: "Alcaraz", away_team: "Djokovic",
      start_time: futureISO(20), end_time: futureEndISO(20, "tennis"),
      status: "scheduled", label: "Alcaraz vs Djokovic", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_sinner_zverev", sport: "tennis",
      league: "Australian Open", home_team: "Sinner", away_team: "Zverev",
      start_time: futureISO(44), end_time: futureEndISO(44, "tennis"),
      status: "scheduled", label: "Sinner vs Zverev", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_medvedev_rublev", sport: "tennis",
      league: "US Open", home_team: "Medvedev", away_team: "Rublev",
      start_time: futureISO(92), end_time: futureEndISO(92, "tennis"),
      status: "scheduled", label: "Medvedev vs Rublev", raw: {},
    },
    // MMA
    {
      provider: "mock-fixtures", provider_event_id: "mock_jones_aspinall", sport: "mma",
      league: "UFC 312", home_team: "Jon Jones", away_team: "Tom Aspinall",
      start_time: futureISO(72), end_time: futureEndISO(72, "mma"),
      status: "scheduled", label: "Jon Jones vs Tom Aspinall", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_adesanya_pereira", sport: "mma",
      league: "UFC 313", home_team: "Adesanya", away_team: "Alex Pereira",
      start_time: futureISO(144), end_time: futureEndISO(144, "mma"),
      status: "scheduled", label: "Adesanya vs Alex Pereira", raw: {},
    },
    // American Football
    {
      provider: "mock-fixtures", provider_event_id: "mock_chiefs_eagles", sport: "american_football",
      league: "NFL", home_team: "Kansas City Chiefs", away_team: "Philadelphia Eagles",
      start_time: futureISO(48), end_time: futureEndISO(48, "american_football"),
      status: "scheduled", label: "Kansas City Chiefs vs Philadelphia Eagles", raw: {},
    },
    {
      provider: "mock-fixtures", provider_event_id: "mock_bills_ravens", sport: "american_football",
      league: "NFL", home_team: "Buffalo Bills", away_team: "Baltimore Ravens",
      start_time: futureISO(120), end_time: futureEndISO(120, "american_football"),
      status: "scheduled", label: "Buffalo Bills vs Baltimore Ravens", raw: {},
    },
  ];
}

function mockMatchList(sport?: string): NormalizedMatch[] {
  let matches = buildMockMatches();
  if (sport && sport !== "all") {
    matches = matches.filter((m) => m.sport === sport);
  }
  // Sort by start_time ascending
  matches.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  return matches.slice(0, 400);
}

// ---------------------------------------------------------------------------
// listUpcomingMatches — the ONLY public function for fetching fixtures.
// Returns NormalizedMatch[] sorted by start_time, with T-2 applied to end_time.
// Hard cap: 400 matches. Never throws.
// ---------------------------------------------------------------------------

export async function listUpcomingMatches(params: {
  sport: string;
  days?: number;       // default 7
  base_date?: string;  // ISO or YYYY-MM-DD; default today
}): Promise<NormalizedMatch[]> {
  const { sport, days = 7, base_date } = params;
  const provider = getProviderName();

  const cacheKey = `fixtures:${provider}:${sport}:${base_date || "today"}:${days}`;
  const cached = getCached(cacheKey);
  if (cached) {
    dbg("cache hit:", cacheKey, `(${cached.length} matches)`);
    return cached;
  }

  dbg("listUpcomingMatches", { provider, sport, days, base_date });

  let result: NormalizedMatch[];

  if (provider === "mock") {
    result = mockMatchList(sport);
  } else if (provider === "thesportsdb") {
    try {
      const raw = await listUpcomingMatchesTheSportsDB({ sport, days, base_date });
      // Apply T-2 rule to end_time only
      result = raw.map((m) => ({
        ...m,
        end_time: applyT2(m.end_time),
      }));
    } catch (e: any) {
      dbg("thesportsdb failed:", e?.message);
      result = [];
    }
  } else {
    // api_football provider
    try {
      const raw = await apiFootballListUpcoming({ sport, days, base_date });
      // Apply T-2 rule to end_time only
      result = raw.map((m) => ({
        ...m,
        end_time: applyT2(m.end_time),
      }));
    } catch (e: any) {
      dbg("api_football failed:", e?.message);
      result = [];
    }
  }

  // Sanity guards after T-2 application
  const nowIso = Date.now();
  result = result.map((m) => {
    const startMs = new Date(m.start_time).getTime();
    let endMs = new Date(m.end_time).getTime();

    // Guard: end_time must never be before start_time
    // (can happen if duration is tiny or T-2 overshot)
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
      const sportDur = DURATION_MS[m.sport] || DURATION_MS.soccer;
      endMs = startMs + sportDur - T2_MS;
      dbg("guard: end_time <= start_time, recalculated", m.provider_event_id);
    }

    // Guard: if now < start_time, status cannot be "finished" or "live"
    let status = m.status;
    if (Number.isFinite(startMs) && nowIso < startMs) {
      if (status === "finished" || status === "live") {
        dbg("guard: status was", status, "but now < start_time, forcing scheduled", m.provider_event_id);
        status = "scheduled";
      }
    }

    return {
      ...m,
      end_time: Number.isFinite(endMs) ? new Date(endMs).toISOString() : m.end_time,
      status,
    };
  });

  // Sort + hard cap
  result.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  result = result.slice(0, 400);

  setCache(cacheKey, result);
  dbg(`result: ${result.length} matches`);
  return result;
}
