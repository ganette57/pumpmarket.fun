// src/lib/sportsProviders/sportapi7Provider.ts
// Server-only: SportAPI7 (RapidAPI) provider for match search.
// SportAPI7 mirrors SofaScore's API structure.
//
// Real endpoints (verified from SofaScore SDK):
//   /api/v1/search/all?q={query}&page=0       — search everything (events, teams, tournaments)
//   /api/v1/search/teams?q={query}&page=0     — search teams only
//   /api/v1/team/{teamId}/events/next/{page}  — upcoming events for a team
//   /api/v1/sport/{slug}/scheduled-events/{YYYY-MM-DD} — events for a sport on a date
//   /api/v1/sport/{slug}/events/live           — live events for a sport

const DEBUG = process.env.SPORTS_DEBUG === "1";

function dbg(...args: unknown[]) {
  if (DEBUG) console.log("[sportapi7]", ...args);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HOST = "sportapi7.p.rapidapi.com";

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
// Sport slug mapping: our internal names → SportAPI7 (SofaScore) slugs
// ---------------------------------------------------------------------------

const SPORT_SLUG: Record<string, string> = {
  soccer: "football",
  basketball: "basketball",
  tennis: "tennis",
  mma: "mma",
  american_football: "american-football",
};

// Reverse: SportAPI7 slug → our internal name
const SLUG_TO_SPORT: Record<string, string> = {
  football: "soccer",
  basketball: "basketball",
  tennis: "tennis",
  mma: "mma",
  "american-football": "american_football",
};

// ---------------------------------------------------------------------------
// Internal cache (30s TTL to avoid rate limits)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;
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
    throw new Error(`SportAPI7 ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

function normalizeStatus(event: any): "scheduled" | "live" | "finished" {
  // SofaScore status structure: { code: number, type: string, description: string }
  const statusType = (event?.status?.type || "").toLowerCase();
  if (statusType === "inprogress") return "live";
  if (statusType === "finished") return "finished";
  if (statusType === "notstarted") return "scheduled";

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
// ---------------------------------------------------------------------------

function eventToMatch(event: any, sport: string): NormalizedMatch | null {
  if (!event) return null;

  const homeTeam = event?.homeTeam?.name || event?.homeTeam?.shortName || "";
  const awayTeam = event?.awayTeam?.name || event?.awayTeam?.shortName || "";
  if (!homeTeam && !awayTeam) return null;

  const eventId = event?.id || event?.customId || `${Date.now()}_${Math.random()}`;
  const league = event?.tournament?.name || event?.season?.name || "";
  const startTs = event?.startTimestamp;
  const startIso = startTs
    ? new Date(startTs * 1000).toISOString()
    : new Date().toISOString();

  return {
    provider: "sportapi7",
    provider_event_id: `sportapi7_${sport}_${eventId}`,
    sport,
    league,
    home_team: homeTeam,
    away_team: awayTeam,
    start_time: startIso,
    end_time: estimatedEndTime(startIso, sport),
    status: normalizeStatus(event),
    label: `${homeTeam} vs ${awayTeam}`,
    raw: {
      sportapi7_event_id: eventId,
      tournament_id: event?.tournament?.uniqueTournament?.id ?? event?.tournament?.id,
      status_code: event?.status?.code,
      status_type: event?.status?.type,
    },
  };
}

// ---------------------------------------------------------------------------
// Strategy 1: Global search via /api/v1/search/all
// Returns events + teams. We extract events matching our sport, then
// for matched teams we fetch their next events.
// ---------------------------------------------------------------------------

async function searchViaGlobal(q: string, sport: string): Promise<NormalizedMatch[]> {
  const encoded = encodeURIComponent(q);
  const data = await apiFetch(`/api/v1/search/all?q=${encoded}&page=0`);

  dbg("search/all keys:", data ? Object.keys(data) : "null");

  const results: NormalizedMatch[] = [];
  const targetSlug = SPORT_SLUG[sport] || "football";

  // Extract direct event results
  const events: any[] = Array.isArray(data?.events) ? data.events : [];
  for (const item of events) {
    const sportSlug = item?.tournament?.category?.sport?.slug || "";
    if (sportSlug && sportSlug !== targetSlug) continue;
    const match = eventToMatch(item, sport);
    if (match) results.push(match);
  }

  // If we got events, return them
  if (results.length > 0) return results.slice(0, 25);

  // Otherwise, try to find teams and fetch their next events
  const teams: any[] = Array.isArray(data?.teams) ? data.teams : [];
  for (const team of teams) {
    const teamSportSlug = team?.sport?.slug || "";
    if (teamSportSlug && teamSportSlug !== targetSlug) continue;
    const teamId = team?.id;
    if (!teamId) continue;

    try {
      const teamEvents = await apiFetch(`/api/v1/team/${teamId}/events/next/0`);
      const nextEvents: any[] = Array.isArray(teamEvents?.events) ? teamEvents.events : [];
      for (const evt of nextEvents) {
        const match = eventToMatch(evt, sport);
        if (match) results.push(match);
      }
      if (results.length > 0) break; // Got results from first matching team
    } catch (e: any) {
      dbg("team events fetch failed for team", teamId, ":", e?.message);
    }
  }

  return results.slice(0, 25);
}

// ---------------------------------------------------------------------------
// Strategy 2: Team search via /api/v1/search/teams, then fetch team events
// ---------------------------------------------------------------------------

async function searchViaTeams(q: string, sport: string): Promise<NormalizedMatch[]> {
  const encoded = encodeURIComponent(q);
  const targetSlug = SPORT_SLUG[sport] || "football";

  const data = await apiFetch(`/api/v1/search/teams?q=${encoded}&page=0`);
  dbg("search/teams keys:", data ? Object.keys(data) : "null");

  const teams: any[] = Array.isArray(data?.teams) ? data.teams : [];
  if (!teams.length) return [];

  // Find first team matching our sport
  let teamId: number | null = null;
  for (const team of teams) {
    const teamSportSlug = team?.sport?.slug || "";
    if (!teamSportSlug || teamSportSlug === targetSlug) {
      teamId = team?.id;
      break;
    }
  }

  if (!teamId) return [];

  // Fetch upcoming events for team
  const eventsData = await apiFetch(`/api/v1/team/${teamId}/events/next/0`);
  const events: any[] = Array.isArray(eventsData?.events) ? eventsData.events : [];

  const results: NormalizedMatch[] = [];
  for (const evt of events) {
    const match = eventToMatch(evt, sport);
    if (match) results.push(match);
  }
  return results.slice(0, 25);
}

// ---------------------------------------------------------------------------
// Strategy 3: Scheduled events for today + tomorrow, filter by q substring
// This is the most reliable fallback — no search endpoint needed.
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function searchViaSchedule(q: string, sport: string): Promise<NormalizedMatch[]> {
  const slug = SPORT_SLUG[sport];
  if (!slug) return [];

  const lq = q.toLowerCase();
  const results: NormalizedMatch[] = [];
  const today = new Date();

  // Fetch today + next 2 days
  for (let offset = 0; offset <= 2 && results.length < 25; offset++) {
    const d = new Date(today.getTime() + offset * 86400_000);
    const dateStr = formatDate(d);

    try {
      const data = await apiFetch(`/api/v1/sport/${slug}/scheduled-events/${dateStr}`);
      const events: any[] = Array.isArray(data?.events) ? data.events : [];
      dbg(`scheduled-events ${slug}/${dateStr}: ${events.length} events`);

      for (const evt of events) {
        const homeName = (evt?.homeTeam?.name || "").toLowerCase();
        const awayName = (evt?.awayTeam?.name || "").toLowerCase();
        const leagueName = (evt?.tournament?.name || "").toLowerCase();

        if (homeName.includes(lq) || awayName.includes(lq) || leagueName.includes(lq)) {
          const match = eventToMatch(evt, sport);
          if (match) results.push(match);
        }
      }
    } catch (e: any) {
      dbg(`scheduled-events ${slug}/${dateStr} failed:`, e?.message);
      // Don't throw — just skip this date
    }
  }

  return results.slice(0, 25);
}

// ---------------------------------------------------------------------------
// Public API: searchMatches
// ---------------------------------------------------------------------------

export async function searchMatches(params: {
  sport: string;
  q: string;
}): Promise<NormalizedMatch[]> {
  const { sport, q } = params;
  const trimmed = q.trim();
  if (trimmed.length < 3) return [];

  // Check internal cache
  const cacheKey = `${sport}:${trimmed.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    dbg("cache hit:", cacheKey);
    return cached;
  }

  // Strategy 1: Global search (search/all)
  try {
    const results = await searchViaGlobal(trimmed, sport);
    if (results.length > 0) {
      setCache(cacheKey, results);
      return results;
    }
  } catch (e: any) {
    dbg("search/all failed:", e?.message);
  }

  // Strategy 2: Team search + next events
  try {
    const results = await searchViaTeams(trimmed, sport);
    if (results.length > 0) {
      setCache(cacheKey, results);
      return results;
    }
  } catch (e: any) {
    dbg("search/teams failed:", e?.message);
  }

  // Strategy 3: Scheduled events with substring filter (most reliable)
  try {
    const results = await searchViaSchedule(trimmed, sport);
    setCache(cacheKey, results);
    return results;
  } catch (e: any) {
    dbg("scheduled-events fallback failed:", e?.message);
  }

  // Everything failed — return empty (don't throw)
  setCache(cacheKey, []);
  return [];
}

// ---------------------------------------------------------------------------
// fetchEvent stub — not implemented yet (live score refresh uses legacy provider)
// ---------------------------------------------------------------------------

export async function fetchEvent(
  _providerEventId: string,
  _sport: string,
): Promise<null> {
  return null;
}
