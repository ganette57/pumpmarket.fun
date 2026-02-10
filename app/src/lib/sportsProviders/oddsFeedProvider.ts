// src/lib/sportsProviders/oddsFeedProvider.ts
// Server-only: Odds Feed (RapidAPI) provider.
// Host: odds-feed.p.rapidapi.com
//
// Strategy: "fixture list" — fetch upcoming events for a sport over N days,
// cache aggressively (15 min TTL), let UI filter client-side.
//
// Correct endpoint: GET /api/v1/events/list?sport_id={id}&day={YYYY-MM-DD}&page=1
// Response shape:
//   { data: [{ id, sport: { id, name, slug }, tournament, category,
//              team_home: { name }, team_away: { name },
//              status, start_at, ... }] }

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
// NormalizedMatch (DO NOT CHANGE — used by UI)
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
// Sport ID mapping
// ---------------------------------------------------------------------------

const SPORT_ID: Record<string, number> = {
  soccer: 1,
  tennis: 2,
  basketball: 3,
  mma: 4,
  american_football: 12,
};

// ---------------------------------------------------------------------------
// Internal cache — 15 min TTL (aggressive to stay under 500 req/month)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 15 * 60_000; // 15 minutes
const eventCache = new Map<string, { ts: number; data: NormalizedMatch[] }>();

function getCached(key: string): NormalizedMatch[] | null {
  const entry = eventCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    eventCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: NormalizedMatch[]) {
  eventCache.set(key, { ts: Date.now(), data });
  // Prune stale entries
  if (eventCache.size > 50) {
    const now = Date.now();
    Array.from(eventCache.entries()).forEach(([k, v]) => {
      if (now - v.ts > CACHE_TTL_MS) eventCache.delete(k);
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
// Date helper
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Parse "YYYY-MM-DD HH:mm:ss" (or ISO) → ISO string
// ---------------------------------------------------------------------------

function parseStartAt(raw: string | number | undefined): string {
  if (!raw) return new Date().toISOString();
  if (typeof raw === "number") {
    // Unix timestamp (seconds)
    return new Date(raw * 1000).toISOString();
  }
  // "YYYY-MM-DD HH:mm:ss" → replace space with T, append Z
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    return new Date(s.replace(" ", "T") + "Z").toISOString();
  }
  // Already ISO or other parsable format
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

function normalizeStatus(event: any): "scheduled" | "live" | "finished" {
  const raw = String(event?.status || "").toUpperCase();
  if (raw === "FINISHED" || raw === "ENDED") return "finished";
  if (raw === "LIVE" || raw === "INPLAY" || raw === "IN_PLAY") return "live";
  if (raw === "NOTSTARTED" || raw === "SCHEDULED" || raw === "NOT_STARTED") return "scheduled";

  // Fallback: check nested status object (some providers)
  const statusType = String(event?.status?.type || "").toUpperCase();
  if (statusType === "FINISHED" || statusType === "ENDED") return "finished";
  if (statusType === "INPROGRESS" || statusType === "LIVE") return "live";

  return "scheduled";
}

// ---------------------------------------------------------------------------
// Event → NormalizedMatch converter
// Handles Odds Feed shape: team_home/team_away, tournament, start_at
// Also handles fallback shapes: homeTeam/awayTeam, startTimestamp
// ---------------------------------------------------------------------------

function eventToMatch(event: any, sport: string): NormalizedMatch | null {
  if (!event) return null;

  // Primary: Odds Feed uses team_home / team_away objects
  const homeTeam =
    event?.team_home?.name ||
    event?.homeTeam?.name ||
    event?.homeTeam?.shortName ||
    event?.home_team ||
    "";
  const awayTeam =
    event?.team_away?.name ||
    event?.awayTeam?.name ||
    event?.awayTeam?.shortName ||
    event?.away_team ||
    "";
  if (!homeTeam && !awayTeam) return null;

  const eventId = event?.id || event?.customId || `${Date.now()}_${Math.random()}`;

  // League: tournament.name > category.name > league.name
  const league =
    event?.tournament?.name ||
    event?.category?.name ||
    event?.league?.name ||
    "";

  const startIso = parseStartAt(
    event?.start_at || event?.startTimestamp || event?.start_timestamp || event?.startTime
  );

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
      tournament_id: event?.tournament?.id,
      category_id: event?.category?.id,
      sport_slug: event?.sport?.slug,
    },
  };
}

// ---------------------------------------------------------------------------
// Fetch events for a single date
// ---------------------------------------------------------------------------

async function fetchEventsForDate(
  sportId: number,
  dateStr: string,
  sport: string,
): Promise<NormalizedMatch[]> {
  const data = await apiFetch(
    `/api/v1/events/list?sport_id=${sportId}&day=${dateStr}&page=1`,
  );

  // Response: { data: [...] } or { events: [...] } or [...]
  const events: any[] =
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.events) ? data.events :
    Array.isArray(data) ? data :
    [];

  dbg(`events ${sport}/${dateStr}: ${events.length} raw events`);

  const results: NormalizedMatch[] = [];
  for (const evt of events) {
    const match = eventToMatch(evt, sport);
    if (match) results.push(match);
  }
  return results;
}

// ---------------------------------------------------------------------------
// listUpcomingMatches: fetch N days of fixtures, return sorted list.
// This is the PRIMARY function used by the search route.
// Never throws — catches everything and returns [].
// ---------------------------------------------------------------------------

export async function listUpcomingMatches(params: {
  sport: string;
  days?: number;       // default 7
  base_date?: string;  // ISO or YYYY-MM-DD; default today
}): Promise<NormalizedMatch[]> {
  const { sport, days = 7, base_date } = params;
  const sportId = SPORT_ID[sport];
  if (!sportId) {
    dbg("unknown sport:", sport);
    return [];
  }

  const baseDate = base_date ? new Date(base_date) : new Date();
  const baseDateStr = formatDate(baseDate);
  const cacheKey = `list:${sport}:${baseDateStr}:${days}`;

  const cached = getCached(cacheKey);
  if (cached) {
    dbg("cache hit:", cacheKey, `(${cached.length} matches)`);
    return cached;
  }

  const all: NormalizedMatch[] = [];

  try {
    for (let offset = 0; offset < days; offset++) {
      const d = new Date(baseDate.getTime() + offset * 86400_000);
      const dateStr = formatDate(d);

      try {
        const dayResults = await fetchEventsForDate(sportId, dateStr, sport);
        for (const m of dayResults) all.push(m);
      } catch (e: any) {
        dbg(`events ${sport}/${dateStr} failed:`, e?.message);
        // Skip this date, continue
      }
    }
  } catch (e: any) {
    dbg("listUpcomingMatches top-level error:", e?.message);
  }

  // Sort by start_time ascending
  all.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  // Hard limit 400
  const result = all.slice(0, 400);
  setCache(cacheKey, result);
  dbg(`listUpcomingMatches ${sport}: ${result.length} matches (${days} days from ${baseDateStr})`);
  return result;
}

// ---------------------------------------------------------------------------
// searchMatches: backward-compatible wrapper.
// If q is provided and >= 3 chars, filter results locally.
// If q is empty/short, return full list.
// Never throws.
// ---------------------------------------------------------------------------

export async function searchMatches(params: {
  sport: string;
  q?: string;
  start_time?: string;
  days?: number;
}): Promise<NormalizedMatch[]> {
  const { sport, q, start_time, days = 7 } = params;

  const matches = await listUpcomingMatches({
    sport,
    days,
    base_date: start_time,
  });

  const trimmed = (q || "").trim().toLowerCase();
  if (trimmed.length < 3) return matches;

  // Filter locally by substring
  return matches.filter((m) => {
    const haystack = `${m.home_team} ${m.away_team} ${m.league}`.toLowerCase();
    return haystack.includes(trimmed);
  });
}
