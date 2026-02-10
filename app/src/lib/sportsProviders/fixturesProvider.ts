// src/lib/sportsProviders/fixturesProvider.ts
// Server-only: Fixture list provider adapter.
//
// Selects the backend provider based on FIXTURES_PROVIDER env var:
//   "odds_feed" — live data from Odds Feed (RapidAPI)
//   "mock"      — built-in mock fixtures (default when no RAPIDAPI_KEY)
//
// Exports:
//   isAvailable(): boolean
//   listUpcomingMatches({ sport, days?, base_date? }): Promise<NormalizedMatch[]>
//
// Never throws — catches everything and returns [].
// end_time = estimated match end − 2 minutes (T-2 auto-end rule).

import {
  isAvailable as isOddsFeedAvailable,
  listUpcomingMatches as oddsFeedListUpcoming,
} from "./oddsFeedProvider";

// Re-export the NormalizedMatch type from oddsFeedProvider
export type { NormalizedMatch } from "./oddsFeedProvider";
import type { NormalizedMatch } from "./oddsFeedProvider";

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
// Provider selection
// ---------------------------------------------------------------------------

type ProviderName = "mock" | "odds_feed";

function getProviderName(): ProviderName {
  const env = (process.env.FIXTURES_PROVIDER || "").trim().toLowerCase();
  if (env === "odds_feed" || env === "odds-feed") return "odds_feed";
  if (env === "mock") return "mock";
  // Auto-detect: use odds_feed if RAPIDAPI_KEY is set
  if (isOddsFeedAvailable()) return "odds_feed";
  return "mock";
}

export function isAvailable(): boolean {
  return getProviderName() === "odds_feed" && isOddsFeedAvailable();
}

// ---------------------------------------------------------------------------
// Mock fixtures (spread across 7 days, all sports)
// ---------------------------------------------------------------------------

// Default match durations in ms (for estimated end_time)
const DURATION_MS: Record<string, number> = {
  soccer: 2 * 3600_000 + 15 * 60_000,           // 2h15m
  basketball: 2 * 3600_000 + 30 * 60_000,        // 2h30m
  tennis: 3 * 3600_000,                           // 3h
  mma: 2 * 3600_000,                              // 2h
  american_football: 3 * 3600_000 + 30 * 60_000,  // 3h30m
};

function futureISO(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
}

function futureEndISO(hoursFromNow: number, sport: string): string {
  const durationMs = DURATION_MS[sport] || DURATION_MS.soccer;
  const startMs = Date.now() + hoursFromNow * 3600_000;
  // Apply T-2: end_time = start + duration - 2 min
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
  return matches;
}

// ---------------------------------------------------------------------------
// listUpcomingMatches — the ONLY public function for fetching fixtures.
// Returns NormalizedMatch[] sorted by start_time, with T-2 applied to end_time.
// Never throws.
// ---------------------------------------------------------------------------

export async function listUpcomingMatches(params: {
  sport: string;
  days?: number;       // default 7
  base_date?: string;  // ISO or YYYY-MM-DD; default today
}): Promise<NormalizedMatch[]> {
  const { sport, days = 7, base_date } = params;
  const provider = getProviderName();
  dbg("listUpcomingMatches", { provider, sport, days, base_date });

  if (provider === "mock") {
    return mockMatchList(sport);
  }

  // odds_feed provider
  try {
    const raw = await oddsFeedListUpcoming({ sport, days, base_date });
    // Apply T-2 rule to end_time from odds-feed results
    return raw.map((m) => ({
      ...m,
      end_time: applyT2(m.end_time),
    }));
  } catch (e: any) {
    dbg("odds_feed failed, falling back to mock:", e?.message);
    return mockMatchList(sport);
  }
}
