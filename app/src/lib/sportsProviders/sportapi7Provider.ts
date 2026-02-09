// src/lib/sportsProviders/sportapi7Provider.ts
// Server-only: SportAPI7 (RapidAPI) provider for match search.
// Kept deliberately simple — search only (no live score refresh yet).

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
// Normalized types (must match existing UI expectations)
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
// Sport ID mapping — SportAPI7 uses numeric category IDs
// ---------------------------------------------------------------------------

// SportAPI7 category IDs (from their docs / playground)
const SPORT_CATEGORY: Record<string, number> = {
  soccer: 1,
  basketball: 2,
  tennis: 5,
  mma: 7,          // combat sports / MMA
  american_football: 63,
};

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

function normalizeStatus(statusCode: number | string | undefined): "scheduled" | "live" | "finished" {
  // SportAPI7 status codes: 0=not started, 6/7=in progress, 100=ended, etc.
  // We're conservative: if unclear, default to "scheduled"
  const code = Number(statusCode);
  if (isNaN(code)) return "scheduled";

  // Common across SportAPI7 event status codes:
  // 0 = not started
  // 6, 7, 31, 32, 41, 42 = in progress / various periods
  // 100 = ended
  // 70 = cancelled, 60 = postponed
  if (code === 0) return "scheduled";
  if (code === 100 || code === 70 || code === 60 || code === 110 || code === 120) return "finished";
  if (code > 0 && code < 100) return "live";
  return "scheduled";
}

// ---------------------------------------------------------------------------
// Search: uses /api/v1/search/multi (multi-sport search)
// ---------------------------------------------------------------------------

async function searchMulti(q: string, sport: string): Promise<NormalizedMatch[]> {
  // SportAPI7 multi-search endpoint
  const encodedQ = encodeURIComponent(q);
  const data = await apiFetch(`/api/v1/search/multi?q=${encodedQ}`);

  dbg("searchMulti response type:", typeof data, "keys:", data ? Object.keys(data) : "null");

  // data.results or data.data may contain sections by type
  const results: NormalizedMatch[] = [];
  const targetCategoryId = SPORT_CATEGORY[sport];

  // SportAPI7 returns: { results: [ { type: "event", entity: {...} }, ... ] }
  // or it may return sections grouped by type
  const items: any[] = Array.isArray(data?.results) ? data.results : [];

  for (const item of items) {
    // Items can be events or teams; we want events
    if (item?.type !== "event") continue;
    const e = item?.entity;
    if (!e) continue;

    // Filter by sport category if we know the mapping
    const eventCategoryId = e?.tournament?.category?.sport?.id ?? e?.category?.sport?.id;
    if (targetCategoryId && eventCategoryId && eventCategoryId !== targetCategoryId) continue;

    const homeTeam = e?.homeTeam?.name || e?.homeTeam?.shortName || "Home";
    const awayTeam = e?.awayTeam?.name || e?.awayTeam?.shortName || "Away";
    const eventId = e?.id || e?.eventId || `${Date.now()}`;
    const league = e?.tournament?.name || e?.league?.name || "";
    const startTs = e?.startTimestamp;
    const startIso = startTs ? new Date(startTs * 1000).toISOString() : new Date().toISOString();
    const statusCode = e?.status?.code ?? e?.statusCode;

    results.push({
      provider: "sportapi7",
      provider_event_id: `sportapi7_${sport}_${eventId}`,
      sport,
      league,
      home_team: homeTeam,
      away_team: awayTeam,
      start_time: startIso,
      end_time: estimatedEndTime(startIso, sport),
      status: normalizeStatus(statusCode),
      label: `${homeTeam} vs ${awayTeam}`,
      raw: { sportapi7_event_id: eventId, category_id: eventCategoryId, status_code: statusCode },
    });
  }

  return results.slice(0, 25);
}

// ---------------------------------------------------------------------------
// Fallback: search by team name within a sport category
// ---------------------------------------------------------------------------

async function searchByTeam(q: string, sport: string): Promise<NormalizedMatch[]> {
  const categoryId = SPORT_CATEGORY[sport];
  if (!categoryId) return [];

  // Try team search
  const encodedQ = encodeURIComponent(q);
  let teamId: number | null = null;

  try {
    const teamsData = await apiFetch(`/api/v1/search/teams?q=${encodedQ}`);
    const teams: any[] = Array.isArray(teamsData?.results) ? teamsData.results : [];

    // Find first team matching our sport
    for (const t of teams) {
      const team = t?.entity || t;
      const teamSportId = team?.sport?.id ?? team?.tournament?.category?.sport?.id;
      if (teamSportId === categoryId || !teamSportId) {
        teamId = team?.id;
        break;
      }
    }
  } catch (e: any) {
    dbg("team search failed:", e?.message);
    return [];
  }

  if (!teamId) return [];

  // Fetch upcoming events for team
  try {
    const eventsData = await apiFetch(`/api/v1/team/${teamId}/events/next/0`);
    const events: any[] = Array.isArray(eventsData?.events) ? eventsData.events : [];

    return events.map((e: any) => {
      const homeTeam = e?.homeTeam?.name || "Home";
      const awayTeam = e?.awayTeam?.name || "Away";
      const eventId = e?.id || `${Date.now()}`;
      const league = e?.tournament?.name || "";
      const startTs = e?.startTimestamp;
      const startIso = startTs ? new Date(startTs * 1000).toISOString() : new Date().toISOString();
      const statusCode = e?.status?.code;

      return {
        provider: "sportapi7",
        provider_event_id: `sportapi7_${sport}_${eventId}`,
        sport,
        league,
        home_team: homeTeam,
        away_team: awayTeam,
        start_time: startIso,
        end_time: estimatedEndTime(startIso, sport),
        status: normalizeStatus(statusCode),
        label: `${homeTeam} vs ${awayTeam}`,
        raw: { sportapi7_event_id: eventId, team_id: teamId, status_code: statusCode },
      } as NormalizedMatch;
    }).slice(0, 25);
  } catch (e: any) {
    dbg("team events fetch failed:", e?.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API: searchMatches
// ---------------------------------------------------------------------------

export async function searchMatches(params: {
  sport: string;
  q: string;
}): Promise<NormalizedMatch[]> {
  const { sport, q } = params;
  if (!q.trim()) return [];

  // Try multi-search first
  try {
    const multiResults = await searchMulti(q, sport);
    if (multiResults.length > 0) return multiResults;
  } catch (e: any) {
    dbg("multi-search failed, trying team search:", e?.message);
  }

  // Fallback to team-based search
  try {
    return await searchByTeam(q, sport);
  } catch (e: any) {
    dbg("team search also failed:", e?.message);
    return [];
  }
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
