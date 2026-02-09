// src/lib/sportsProviders/apiSportsProvider.ts
// Server-only: RapidAPI (API-Sports) integration for search + event fetch.

const DEBUG = process.env.SPORTS_DEBUG === "1";

function dbg(...args: unknown[]) {
  if (DEBUG) console.log("[api-sports]", ...args);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getKey(): string | null {
  return process.env.RAPIDAPI_KEY || null;
}

const DEFAULT_HOSTS: Record<string, string> = {
  soccer: "api-football-v1.p.rapidapi.com",
  basketball: "api-basketball.p.rapidapi.com",
  tennis: "api-tennis-v1.p.rapidapi.com",
  mma: "api-mma-v1.p.rapidapi.com",
  american_football: "api-american-football-v1.p.rapidapi.com",
};

function hostFor(sport: string): string {
  const envMap: Record<string, string | undefined> = {
    soccer: process.env.RAPIDAPI_HOST_FOOTBALL,
    basketball: process.env.RAPIDAPI_HOST_BASKETBALL,
    tennis: process.env.RAPIDAPI_HOST_TENNIS,
    mma: process.env.RAPIDAPI_HOST_MMA,
    american_football: process.env.RAPIDAPI_HOST_AMERICAN_FOOTBALL,
  };
  return envMap[sport] || DEFAULT_HOSTS[sport] || DEFAULT_HOSTS.soccer;
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
// Generic fetch helper
// ---------------------------------------------------------------------------

async function apiFetch(sport: string, path: string, params: Record<string, string>): Promise<any> {
  const key = getKey();
  if (!key) throw new Error("RAPIDAPI_KEY not set");

  const host = hostFor(sport);
  const url = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  dbg("fetch", url.toString());

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": host,
    },
    next: { revalidate: 0 } as any,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    dbg("error", res.status, text.slice(0, 200));
    throw new Error(`API-Sports ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Normalized types (returned to callers)
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

export type NormalizedEvent = {
  status: "scheduled" | "live" | "finished";
  score: Record<string, unknown>;
  league: string | null;
  home_team: string | null;
  away_team: string | null;
  start_time: string | null;
  end_time: string | null;
  last_update: string;
  raw: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Status normalizers (per sport API status codes → our 3 states)
// ---------------------------------------------------------------------------

function normalizeSoccerStatus(raw: string): "scheduled" | "live" | "finished" {
  const s = (raw || "").toUpperCase();
  if (["TBD", "NS"].includes(s)) return "scheduled";
  if (["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"].includes(s)) return "live";
  // FT, AET, PEN, WO, AWD, CANC, ABD, PST
  return "finished";
}

function normalizeBasketballStatus(raw: string): "scheduled" | "live" | "finished" {
  const s = (raw || "").toUpperCase();
  if (["NS"].includes(s)) return "scheduled";
  if (["Q1", "Q2", "Q3", "Q4", "OT", "BT", "HT"].includes(s)) return "live";
  return "finished";
}

function normalizeTennisStatus(raw: string): "scheduled" | "live" | "finished" {
  const s = (raw || "").toUpperCase();
  if (s.includes("NOT") || s === "NS") return "scheduled";
  if (s.includes("SET") || s.includes("LIVE") || s === "IP") return "live";
  return "finished";
}

function normalizeMmaStatus(raw: string): "scheduled" | "live" | "finished" {
  const s = (raw || "").toUpperCase();
  if (["NS", "TBD"].includes(s)) return "scheduled";
  if (["IN PROGRESS", "LIVE", "IP"].includes(s)) return "live";
  return "finished";
}

function normalizeAmFootballStatus(raw: string): "scheduled" | "live" | "finished" {
  const s = (raw || "").toUpperCase();
  if (["NS", "TBD"].includes(s)) return "scheduled";
  if (["Q1", "Q2", "Q3", "Q4", "OT", "HT"].includes(s)) return "live";
  return "finished";
}

function normalizeStatus(sport: string, raw: string): "scheduled" | "live" | "finished" {
  switch (sport) {
    case "soccer": return normalizeSoccerStatus(raw);
    case "basketball": return normalizeBasketballStatus(raw);
    case "tennis": return normalizeTennisStatus(raw);
    case "mma": return normalizeMmaStatus(raw);
    case "american_football": return normalizeAmFootballStatus(raw);
    default: return normalizeSoccerStatus(raw);
  }
}

// ---------------------------------------------------------------------------
// Score normalizers
// ---------------------------------------------------------------------------

function normalizeSoccerScore(fixture: any): Record<string, unknown> {
  const goals = fixture?.goals || {};
  return {
    home: goals.home ?? 0,
    away: goals.away ?? 0,
    minute: fixture?.fixture?.status?.elapsed ?? null,
    period: fixture?.fixture?.status?.short ?? null,
  };
}

function normalizeBasketballScore(game: any): Record<string, unknown> {
  const scores = game?.scores || {};
  return {
    home: scores.home?.total ?? 0,
    away: scores.away?.total ?? 0,
    quarter: game?.status?.short ?? null,
  };
}

function normalizeTennisScore(game: any): Record<string, unknown> {
  const sets = game?.scores?.sets || game?.sets || null;
  return {
    sets: sets ?? null,
    winner: game?.winner?.name ?? null,
  };
}

function normalizeMmaScore(fight: any): Record<string, unknown> {
  return {
    round: fight?.round ?? null,
    method: fight?.method ?? null,
    winner: fight?.winner?.name ?? null,
  };
}

function normalizeAmFootballScore(game: any): Record<string, unknown> {
  const scores = game?.scores || {};
  return {
    home: scores.home?.total ?? 0,
    away: scores.away?.total ?? 0,
    quarter: game?.status?.short ?? null,
    clock: game?.status?.timer ?? null,
  };
}

function normalizeScore(sport: string, raw: any): Record<string, unknown> {
  switch (sport) {
    case "soccer": return normalizeSoccerScore(raw);
    case "basketball": return normalizeBasketballScore(raw);
    case "tennis": return normalizeTennisScore(raw);
    case "mma": return normalizeMmaScore(raw);
    case "american_football": return normalizeAmFootballScore(raw);
    default: return {};
  }
}

// ---------------------------------------------------------------------------
// SEARCH: per-sport implementations
// ---------------------------------------------------------------------------

function dateRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86400_000);
  const to = new Date(now.getTime() + 30 * 86400_000);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { from: fmt(from), to: fmt(to) };
}

// --- Soccer ---

async function searchSoccer(q: string): Promise<NormalizedMatch[]> {
  // Step 1: search teams
  const teamsRes = await apiFetch("soccer", "/v3/teams", { search: q });
  const teams = teamsRes?.response || [];
  if (!teams.length) return [];

  // Take first matched team
  const teamId = teams[0]?.team?.id;
  if (!teamId) return [];

  // Step 2: fetch fixtures for team in window
  const { from, to } = dateRange();
  const fixRes = await apiFetch("soccer", "/v3/fixtures", {
    team: String(teamId),
    from,
    to,
  });

  const fixtures = fixRes?.response || [];
  return fixtures.map((f: any) => {
    const startIso = f?.fixture?.date || new Date().toISOString();
    const rawStatus = f?.fixture?.status?.short || "NS";
    return {
      provider: "api-sports",
      provider_event_id: `soccer_${f?.fixture?.id}`,
      sport: "soccer",
      league: f?.league?.name || "",
      home_team: f?.teams?.home?.name || "Home",
      away_team: f?.teams?.away?.name || "Away",
      start_time: startIso,
      end_time: estimatedEndTime(startIso, "soccer"),
      status: normalizeStatus("soccer", rawStatus),
      label: `${f?.teams?.home?.name} vs ${f?.teams?.away?.name}`,
      raw: { fixture_id: f?.fixture?.id, league_id: f?.league?.id, api_status: rawStatus },
    } as NormalizedMatch;
  }).slice(0, 20);
}

// --- Basketball ---

async function searchBasketball(q: string): Promise<NormalizedMatch[]> {
  const teamsRes = await apiFetch("basketball", "/teams", { search: q });
  const teams = teamsRes?.response || [];
  if (!teams.length) return [];

  const teamId = teams[0]?.id;
  if (!teamId) return [];

  const { from, to } = dateRange();
  const gamesRes = await apiFetch("basketball", "/games", {
    team: String(teamId),
    date: from,
  });

  // The basketball API may not support date range, so we just take what we get
  const games = gamesRes?.response || [];
  return games.map((g: any) => {
    const startIso = g?.date || new Date().toISOString();
    const rawStatus = g?.status?.short || "NS";
    return {
      provider: "api-sports",
      provider_event_id: `basketball_${g?.id}`,
      sport: "basketball",
      league: g?.league?.name || "",
      home_team: g?.teams?.home?.name || "Home",
      away_team: g?.teams?.away?.name || "Away",
      start_time: startIso,
      end_time: estimatedEndTime(startIso, "basketball"),
      status: normalizeStatus("basketball", rawStatus),
      label: `${g?.teams?.home?.name} vs ${g?.teams?.away?.name}`,
      raw: { game_id: g?.id, league_id: g?.league?.id, api_status: rawStatus },
    } as NormalizedMatch;
  }).slice(0, 20);
}

// --- Tennis ---

async function searchTennis(q: string): Promise<NormalizedMatch[]> {
  // Tennis API may not have team search — use "games by date" and filter
  const today = new Date().toISOString().split("T")[0];
  const gamesRes = await apiFetch("tennis", "/games", { date: today });
  const games = gamesRes?.response || [];

  const lq = q.toLowerCase();
  const filtered = games.filter((g: any) => {
    const haystack = `${g?.players?.home?.name || ""} ${g?.players?.away?.name || ""} ${g?.league?.name || ""}`.toLowerCase();
    return haystack.includes(lq);
  });

  return filtered.map((g: any) => {
    const startIso = g?.date || new Date().toISOString();
    const rawStatus = g?.status?.short || "NS";
    return {
      provider: "api-sports",
      provider_event_id: `tennis_${g?.id}`,
      sport: "tennis",
      league: g?.league?.name || "",
      home_team: g?.players?.home?.name || "Player A",
      away_team: g?.players?.away?.name || "Player B",
      start_time: startIso,
      end_time: estimatedEndTime(startIso, "tennis"),
      status: normalizeStatus("tennis", rawStatus),
      label: `${g?.players?.home?.name} vs ${g?.players?.away?.name}`,
      raw: { game_id: g?.id, api_status: rawStatus },
    } as NormalizedMatch;
  }).slice(0, 20);
}

// --- MMA ---

async function searchMma(q: string): Promise<NormalizedMatch[]> {
  // Use fights by date, filter by fighter name
  const today = new Date().toISOString().split("T")[0];
  let fights: any[] = [];

  try {
    const res = await apiFetch("mma", "/fights", { date: today });
    fights = res?.response || [];
  } catch {
    // Fallback: try upcoming
    try {
      const res = await apiFetch("mma", "/fights", { status: "NS" });
      fights = res?.response || [];
    } catch { /* noop */ }
  }

  const lq = q.toLowerCase();
  const filtered = fights.filter((f: any) => {
    const haystack = `${f?.fighters?.home?.name || ""} ${f?.fighters?.away?.name || ""} ${f?.league?.name || ""}`.toLowerCase();
    return haystack.includes(lq);
  });

  return filtered.map((f: any) => {
    const startIso = f?.date || new Date().toISOString();
    const rawStatus = f?.status?.short || "NS";
    return {
      provider: "api-sports",
      provider_event_id: `mma_${f?.id}`,
      sport: "mma",
      league: f?.league?.name || "",
      home_team: f?.fighters?.home?.name || "Fighter A",
      away_team: f?.fighters?.away?.name || "Fighter B",
      start_time: startIso,
      end_time: estimatedEndTime(startIso, "mma"),
      status: normalizeStatus("mma", rawStatus),
      label: `${f?.fighters?.home?.name} vs ${f?.fighters?.away?.name}`,
      raw: { fight_id: f?.id, api_status: rawStatus },
    } as NormalizedMatch;
  }).slice(0, 20);
}

// --- American Football ---

async function searchAmFootball(q: string): Promise<NormalizedMatch[]> {
  const teamsRes = await apiFetch("american_football", "/teams", { search: q });
  const teams = teamsRes?.response || [];
  if (!teams.length) return [];

  const teamId = teams[0]?.id;
  if (!teamId) return [];

  const today = new Date().toISOString().split("T")[0];
  const gamesRes = await apiFetch("american_football", "/games", {
    team: String(teamId),
    date: today,
  });

  const games = gamesRes?.response || [];
  return games.map((g: any) => {
    const startIso = g?.game?.date?.date || g?.date || new Date().toISOString();
    const rawStatus = g?.game?.status?.short || g?.status?.short || "NS";
    return {
      provider: "api-sports",
      provider_event_id: `american_football_${g?.game?.id || g?.id}`,
      sport: "american_football",
      league: g?.league?.name || "",
      home_team: g?.teams?.home?.name || "Home",
      away_team: g?.teams?.away?.name || "Away",
      start_time: startIso,
      end_time: estimatedEndTime(startIso, "american_football"),
      status: normalizeStatus("american_football", rawStatus),
      label: `${g?.teams?.home?.name} vs ${g?.teams?.away?.name}`,
      raw: { game_id: g?.game?.id || g?.id, api_status: rawStatus },
    } as NormalizedMatch;
  }).slice(0, 20);
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

  switch (sport) {
    case "soccer": return searchSoccer(q);
    case "basketball": return searchBasketball(q);
    case "tennis": return searchTennis(q);
    case "mma": return searchMma(q);
    case "american_football": return searchAmFootball(q);
    default: return searchSoccer(q);
  }
}

// ---------------------------------------------------------------------------
// Public API: fetchEvent
// ---------------------------------------------------------------------------

export async function fetchEvent(
  providerEventId: string,
  sport: string,
): Promise<NormalizedEvent | null> {
  // Parse out the numeric ID
  // provider_event_id format: "soccer_123456"
  const parts = providerEventId.split("_");
  const numericId = parts[parts.length - 1];
  if (!numericId) return null;

  try {
    switch (sport) {
      case "soccer": return await fetchSoccerEvent(numericId);
      case "basketball": return await fetchBasketballEvent(numericId);
      case "tennis": return await fetchTennisEvent(numericId);
      case "mma": return await fetchMmaEvent(numericId);
      case "american_football": return await fetchAmFootballEvent(numericId);
      default: return null;
    }
  } catch (e: any) {
    dbg("fetchEvent error:", e?.message);
    return null;
  }
}

// --- per-sport fetchEvent implementations ---

async function fetchSoccerEvent(fixtureId: string): Promise<NormalizedEvent | null> {
  const res = await apiFetch("soccer", "/v3/fixtures", { id: fixtureId });
  const f = res?.response?.[0];
  if (!f) return null;

  const startIso = f?.fixture?.date || null;
  const rawStatus = f?.fixture?.status?.short || "NS";

  return {
    status: normalizeStatus("soccer", rawStatus),
    score: normalizeSoccerScore(f),
    league: f?.league?.name || null,
    home_team: f?.teams?.home?.name || null,
    away_team: f?.teams?.away?.name || null,
    start_time: startIso,
    end_time: startIso ? estimatedEndTime(startIso, "soccer") : null,
    last_update: new Date().toISOString(),
    raw: { fixture_id: fixtureId, api_status: rawStatus, estimated_end: true, full: f },
  };
}

async function fetchBasketballEvent(gameId: string): Promise<NormalizedEvent | null> {
  const res = await apiFetch("basketball", "/games", { id: gameId });
  const g = res?.response?.[0];
  if (!g) return null;

  const startIso = g?.date || null;
  const rawStatus = g?.status?.short || "NS";

  return {
    status: normalizeStatus("basketball", rawStatus),
    score: normalizeBasketballScore(g),
    league: g?.league?.name || null,
    home_team: g?.teams?.home?.name || null,
    away_team: g?.teams?.away?.name || null,
    start_time: startIso,
    end_time: startIso ? estimatedEndTime(startIso, "basketball") : null,
    last_update: new Date().toISOString(),
    raw: { game_id: gameId, api_status: rawStatus, estimated_end: true, full: g },
  };
}

async function fetchTennisEvent(gameId: string): Promise<NormalizedEvent | null> {
  const res = await apiFetch("tennis", "/games", { id: gameId });
  const g = res?.response?.[0];
  if (!g) return null;

  const startIso = g?.date || null;
  const rawStatus = g?.status?.short || "NS";

  return {
    status: normalizeStatus("tennis", rawStatus),
    score: normalizeTennisScore(g),
    league: g?.league?.name || null,
    home_team: g?.players?.home?.name || null,
    away_team: g?.players?.away?.name || null,
    start_time: startIso,
    end_time: startIso ? estimatedEndTime(startIso, "tennis") : null,
    last_update: new Date().toISOString(),
    raw: { game_id: gameId, api_status: rawStatus, estimated_end: true, full: g },
  };
}

async function fetchMmaEvent(fightId: string): Promise<NormalizedEvent | null> {
  const res = await apiFetch("mma", "/fights", { id: fightId });
  const f = res?.response?.[0];
  if (!f) return null;

  const startIso = f?.date || null;
  const rawStatus = f?.status?.short || "NS";

  return {
    status: normalizeStatus("mma", rawStatus),
    score: normalizeMmaScore(f),
    league: f?.league?.name || null,
    home_team: f?.fighters?.home?.name || null,
    away_team: f?.fighters?.away?.name || null,
    start_time: startIso,
    end_time: startIso ? estimatedEndTime(startIso, "mma") : null,
    last_update: new Date().toISOString(),
    raw: { fight_id: fightId, api_status: rawStatus, estimated_end: true, full: f },
  };
}

async function fetchAmFootballEvent(gameId: string): Promise<NormalizedEvent | null> {
  const res = await apiFetch("american_football", "/games", { id: gameId });
  const g = res?.response?.[0];
  if (!g) return null;

  const startIso = g?.game?.date?.date || g?.date || null;
  const rawStatus = g?.game?.status?.short || g?.status?.short || "NS";

  return {
    status: normalizeStatus("american_football", rawStatus),
    score: normalizeAmFootballScore(g),
    league: g?.league?.name || null,
    home_team: g?.teams?.home?.name || null,
    away_team: g?.teams?.away?.name || null,
    start_time: startIso,
    end_time: startIso ? estimatedEndTime(startIso, "american_football") : null,
    last_update: new Date().toISOString(),
    raw: { game_id: gameId, api_status: rawStatus, estimated_end: true, full: g },
  };
}

// ---------------------------------------------------------------------------
// Check if provider is available
// ---------------------------------------------------------------------------

export function isAvailable(): boolean {
  return !!getKey();
}
