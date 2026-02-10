// src/lib/sportsProviders/oddsFeedProvider.ts
// Server-only: Odds Feed (RapidAPI) provider for match search.
// Host: odds-feed.p.rapidapi.com (by Tipsters — same team as SportScore)
//
// Strategy: button-click-only search (no keystroke spam).
// The user fills in sport + teams manually, then clicks "Link to provider"
// → ONE API call to find a matching event → store provider_event_id if found.
//
// Endpoints used:
//   GET /v1/events/list?sport_id={id}&day={YYYY-MM-DD}&page=1

const DEBUG = process.env.SPORTS_DEBUG === "1";

function dbg(...args: unknown[]) {
  if (DEBUG) console.log("[odds-feed]", ...args);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HOST = "odds-feed.p.rapidapi.com";

function getKey(): string | null {
  return process.env.RAPIDAPI_KEY || null;
}

export function isAvailable(): boolean {
  return !!getKey();
}

// Default match durations in ms (for estimated end_time)
const DURATION_MS: Record<string, number> = {
  soccer: 2 * 3600_000 + 15 * 60_000,           // 2h15m
  basketball: 2 * 3600_000 + 30 * 60_000,        // 2h30m
  tennis: 3 * 3600_000,                           // 3h
  mma: 2 * 3600_000,                              // 2h
  american_football: 3 * 3600_000 + 30 * 60_000,  // 3h30m
};

function estimatedEndTime(startIso: string, sport: string): string {
  const ms = DURATION_MS[sport] || DURATION_MS.soccer;
  return new Date(new Date(startIso).getTime() + ms).toISOString();
}

// ---------------------------------------------------------------------------
// Normalized types (must match existing UI expectations — DO NOT CHANGE)
// ---------------------------------------------------------------------------

export type NormalizedMatch = {
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

// ---------------------------------------------------------------------------
// Sport ID mapping: our internal names → Odds Feed sport IDs
// These IDs match the Tipsters / SportScore convention.
// ---------------------------------------------------------------------------

const SPORT_ID: Record<string, number> = {
  soccer: 1,
  tennis: 2,
  basketball: 3,
  mma: 4,
  american_football: 12,
};

// Reverse: sport ID → our internal name
const ID_TO_SPORT: Record<number, string> = {};
for (const [k, v] of Object.entries(SPORT_ID)) {
  ID_TO_SPORT[v] = k;
}

// ---------------------------------------------------------------------------
// Internal cache (60s TTL to avoid rate limits — 500 req/month budget)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
const searchCache = new Map<string, { ts: number; data: NormalizedMatch[] }>();

function getCached(key: string): NormalizedMatch[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: NormalizedMatch[]) {
  searchCache.set(key, { ts: Date.now(), data });
  // Prune stale entries
  if (searchCache.size > 100) {
    const now = Date.now();
    Array.from(searchCache.entries()).forEach(([k, v]) => {
      if (now - v.ts > CACHE_TTL_MS) searchCache.delete(k);
    });
  }
}

// ---------------------------------------------------------------------------
// Generic fetch helper
// ---------------------------------------------------------------------------

async function apiFetch(path: string): Promise<any> {
  const key = getKey();
  if (!key) throw new Error("RAPIDAPI_KEY not set");

  const url = `https://${HOST}${path}`;
  dbg("fetch", url);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": HOST,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    dbg("error", res.status, text.slice(0, 300));
    throw new Error(`OddsFeed ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

function normalizeStatus(event: any): "scheduled" | "live" | "finished" {
  const statusType = String(event?.status?.type || "").toLowerCase();
  if (statusType === "inprogress" || statusType === "live") return "live";
  if (statusType === "finished" || statusType === "ended") return "finished";
  if (statusType === "notstarted" || statusType === "scheduled") return "scheduled";

  // Fallback: check numeric code
  const code = Number(event?.status?.code);
  if (!isNaN(code)) {
    if (code === 0) return "scheduled";
    if (code === 100 || code >= 60) return "finished";
    if (code > 0 && code < 60) return "live";
  }

  return "scheduled";
}

// ---------------------------------------------------------------------------
// Event → NormalizedMatch converter
// Handles both nested { homeTeam: { name } } and flat { homeTeamName } shapes.
// ---------------------------------------------------------------------------

function eventToMatch(event: any, sport: string): NormalizedMatch | null {
  if (!event) return null;

  const homeTeam =
    event?.homeTeam?.name ||
    event?.homeTeam?.shortName ||
    event?.homeTeamName ||
    "";
  const awayTeam =
    event?.awayTeam?.name ||
    event?.awayTeam?.shortName ||
    event?.awayTeamName ||
    "";
  if (!homeTeam && !awayTeam) return null;

  const eventId =
    event?.id || event?.customId || `${Date.now()}_${Math.random()}`;
  const league =
    event?.tournament?.name ||
    event?.league?.name ||
    event?.leagueName ||
    event?.season?.name ||
    "";
  const startTs = event?.startTimestamp || event?.start_timestamp;
  const startIso = startTs
    ? new Date(startTs * 1000).toISOString()
    : event?.startTime || event?.start_time || new Date().toISOString();

  return {
    provider: "odds-feed",
    provider_event_id: `oddsfeed_${sport}_${eventId}`,
    sport,
    league,
    home_team: homeTeam,
    away_team: awayTeam,
    start_time: startIso,
    end_time: estimatedEndTime(startIso, sport),
    status: normalizeStatus(event),
    label: `${homeTeam} vs ${awayTeam}`,
    raw: {
      oddsfeed_event_id: eventId,
      tournament_id:
        event?.tournament?.uniqueTournament?.id ??
        event?.tournament?.id ??
        event?.tournamentId,
      status_code: event?.status?.code,
      status_type: event?.status?.type,
    },
  };
}

// ---------------------------------------------------------------------------
// Date helper
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Fetch events for a sport on a given date, filter by query substring
// ---------------------------------------------------------------------------

async function fetchEventsForDate(
  sportId: number,
  dateStr: string,
  sport: string,
  lq: string,
): Promise<NormalizedMatch[]> {
  const data = await apiFetch(
    `/v1/events/list?sport_id=${sportId}&day=${dateStr}&page=1`,
  );

  // Response may be { data: [...] } or { events: [...] } or just [...]
  const events: any[] =
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.events) ? data.events :
    Array.isArray(data) ? data :
    [];

  dbg(`events ${sport}/${dateStr}: ${events.length} events, query="${lq}"`);

  const results: NormalizedMatch[] = [];
  for (const evt of events) {
    const homeName = (
      evt?.homeTeam?.name || evt?.homeTeamName || ""
    ).toLowerCase();
    const awayName = (
      evt?.awayTeam?.name || evt?.awayTeamName || ""
    ).toLowerCase();
    const leagueName = (
      evt?.tournament?.name || evt?.league?.name || evt?.leagueName || ""
    ).toLowerCase();

    if (
      homeName.includes(lq) ||
      awayName.includes(lq) ||
      leagueName.includes(lq)
    ) {
      const match = eventToMatch(evt, sport);
      if (match) results.push(match);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API: searchMatches
// Never throws — catches everything and returns [].
// ---------------------------------------------------------------------------

export async function searchMatches(params: {
  sport: string;
  q: string;
  start_time?: string; // optional ISO date to focus the search window
}): Promise<NormalizedMatch[]> {
  const { sport, q, start_time } = params;
  const trimmed = q.trim();
  if (trimmed.length < 3) return [];

  const sportId = SPORT_ID[sport];
  if (!sportId) {
    dbg("unknown sport:", sport);
    return [];
  }

  // Check internal cache
  const cacheKey = `${sport}:${trimmed.toLowerCase()}:${start_time || ""}`;
  const cached = getCached(cacheKey);
  if (cached) {
    dbg("cache hit:", cacheKey);
    return cached;
  }

  const lq = trimmed.toLowerCase();
  const results: NormalizedMatch[] = [];

  try {
    // Determine date window: if start_time provided, center around that day;
    // otherwise use today + next 2 days.
    const baseDate = start_time ? new Date(start_time) : new Date();

    // Fetch base day, then ±1 day if needed (max 3 API calls)
    for (
      let offset = 0;
      offset <= 2 && results.length < 25;
      offset++
    ) {
      const d = new Date(baseDate.getTime() + offset * 86400_000);
      const dateStr = formatDate(d);

      try {
        const dayResults = await fetchEventsForDate(sportId, dateStr, sport, lq);
        for (const m of dayResults) {
          results.push(m);
          if (results.length >= 25) break;
        }
      } catch (e: any) {
        dbg(`events ${sport}/${dateStr} failed:`, e?.message);
        // Don't throw — just skip this date
      }

      // If we got results on the first day, no need to fetch more days
      if (results.length > 0 && offset === 0) break;
    }
  } catch (e: any) {
    dbg("searchMatches top-level error:", e?.message);
  }

  setCache(cacheKey, results);
  return results;
}
