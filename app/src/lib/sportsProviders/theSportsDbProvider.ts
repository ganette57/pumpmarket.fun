// src/lib/sportsProviders/theSportsDbProvider.ts
// Server-only: TheSportsDB provider for fixture listing + live score lookup.
//
// Free tier (V1): key in URL path (default "3" = test key)
//   Base: https://www.thesportsdb.com/api/v1/json/{KEY}/
//   Rate limit: 30 req/min
//   Key endpoints:
//     eventsnextleague.php?id=LEAGUE_ID   → next 15 upcoming events
//     eventsday.php?d=YYYY-MM-DD&s=SPORT  → events on a day
//     lookupevent.php?id=EVENT_ID         → single event details (scores, status)
//
// Premium tier (V2): X-API-KEY header, livescore endpoint
//   Base: https://www.thesportsdb.com/api/v2/json/
//
// Never throws — returns [] or null on failure.

import type { NormalizedMatch } from "./oddsFeedProvider";

const DEBUG = process.env.SPORTS_DEBUG === "1";

function dbg(...args: unknown[]) {
  if (DEBUG) console.log("[thesportsdb]", ...args);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getKey(): string {
  return process.env.THESPORTSDB_KEY || "3";
}

function isPremium(): boolean {
  const k = getKey();
  return k !== "3" && k.length > 2;
}

function v1Url(endpoint: string): string {
  return `https://www.thesportsdb.com/api/v1/json/${getKey()}/${endpoint}`;
}

// ---------------------------------------------------------------------------
// Sport duration table (for estimated end_time)
// ---------------------------------------------------------------------------

const DURATION_MS: Record<string, number> = {
  soccer: 110 * 60_000,                           // 1h50m
  basketball: 2 * 3600_000 + 30 * 60_000,         // 2h30m
  tennis: 3 * 3600_000,                            // 3h
  american_football: 3 * 3600_000 + 30 * 60_000,   // 3h30m
  mma: 2 * 3600_000,                               // 2h
};

function estimatedEndTime(startIso: string, sport: string): string {
  const ms = DURATION_MS[sport] || DURATION_MS.soccer;
  return new Date(new Date(startIso).getTime() + ms).toISOString();
}

// ---------------------------------------------------------------------------
// Timezone-safe date parsing
//
// TheSportsDB returns dateEvent ("YYYY-MM-DD") + strTime ("HH:MM:SS") in
// the league's LOCAL timezone, NOT UTC. Parsing them naively as
// `new Date("2026-02-15T19:30:00")` is WRONG — JS interprets that
// inconsistently across environments (sometimes local, sometimes UTC).
//
// We use Intl.DateTimeFormat to compute the UTC offset for the event's
// timezone at the exact date in question, which handles DST correctly.
// ---------------------------------------------------------------------------

/**
 * Convert a local date+time in a specific IANA timezone to UTC epoch ms.
 * Example: zonedTimeToUtcMs("2026-02-15", "19:30:00", "Europe/London")
 *   → correct UTC ms whether London is in GMT or BST at that date.
 *
 * Approach:
 * 1. Parse components and create a UTC "guess" (pretend it's UTC).
 * 2. Format that guess in the target timezone to see what local time it maps to.
 * 3. The difference = timezone offset. Subtract it.
 */
function zonedTimeToUtcMs(dateYMD: string, timeHMS: string, tz: string): number {
  const [y, mo, d] = dateYMD.split("-").map(Number);
  const parts = (timeHMS || "00:00:00").split(":");
  const h = Number(parts[0]) || 0;
  const mi = Number(parts[1]) || 0;
  const s = Number(parts[2]) || 0;

  // Step 1: naive UTC guess — treat input components as UTC
  const guessMs = Date.UTC(y, mo - 1, d, h, mi, s);

  // Step 2: format guessMs in the target tz to see what local time it shows
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const fmtParts = fmt.formatToParts(new Date(guessMs));
  const g = (type: string) => {
    const val = fmtParts.find((p) => p.type === type)?.value || "0";
    return parseInt(val, 10);
  };

  let localH = g("hour");
  if (localH === 24) localH = 0; // midnight edge case in some locales
  const localAsUtcMs = Date.UTC(g("year"), g("month") - 1, g("day"), localH, g("minute"), g("second"));

  // Step 3: offset = how much the tz is ahead of UTC
  // localAsUtcMs - guessMs = offset
  // To convert local→UTC: subtract offset
  const offsetMs = localAsUtcMs - guessMs;
  return guessMs - offsetMs;
}

/**
 * Parse a timestamp string as UTC.
 * TheSportsDB strTimestamp often looks like "2026-02-12T00:00:00" with NO
 * timezone suffix. Per JS spec, `new Date("...T...")` without Z is parsed
 * as LOCAL time, which shifts the result by the server's UTC offset.
 * This helper forces UTC interpretation for bare ISO strings.
 */
function parseTsUtc(s: string): Date | null {
  const t = String(s || "").trim();
  if (!t) return null;
  // Already has timezone info — parse as-is
  if (/[zZ]$/.test(t) || /[+-]\d{2}:\d{2}$/.test(t)) return new Date(t);
  // Bare ISO without tz → force UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t)) return new Date(t + "Z");
  return new Date(t);
}

/**
 * Parse TheSportsDB event into a UTC ISO start_time string.
 *
 * Priority:
 * 1. strTimestamp — if present and parseable, it's already an ISO 8601
 *    timestamp (TheSportsDB documents it as UTC). Use directly.
 * 2. dateEvent + strTime — local time in the league's timezone.
 *    Requires timezone-aware conversion via zonedTimeToUtcMs().
 * 3. Fallback: current time (should never happen for real events).
 */
function parseTheSportsDbStart(event: any, leagueCfg?: LeagueConfig): string {
  // Priority 1: strTimestamp (ISO 8601, typically UTC from TheSportsDB)
  // IMPORTANT: use parseTsUtc — bare "YYYY-MM-DDTHH:mm:ss" must be treated
  // as UTC, not local time. Without this, times shift by server tz offset.
  if (event.strTimestamp) {
    const ts = parseTsUtc(event.strTimestamp);
    if (ts && !isNaN(ts.getTime())) {
      dbg(
        "  parseStart: using strTimestamp",
        event.idEvent,
        event.strTimestamp,
        "→",
        ts.toISOString(),
      );
      return ts.toISOString();
    }
  }

  // Priority 2: dateEvent + strTime with timezone from league config
  if (event.dateEvent) {
    const time = event.strTime || "00:00:00";
    const tz = leagueCfg?.tz || "UTC";
    const utcMs = zonedTimeToUtcMs(event.dateEvent, time, tz);

    if (Number.isFinite(utcMs)) {
      const iso = new Date(utcMs).toISOString();
      dbg(
        "  parseStart: dateEvent+strTime",
        event.idEvent,
        `${event.dateEvent} ${time} [${tz}]`,
        "→",
        iso,
      );
      return iso;
    }
  }

  // Fallback
  dbg("  parseStart: FALLBACK to now()", event.idEvent);
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// League mapping
//
// TheSportsDB league IDs for our target leagues.
// Each entry includes an IANA timezone for the league's local times.
// TheSportsDB dateEvent + strTime are in the league's LOCAL timezone,
// so we must convert them to UTC explicitly.
// ---------------------------------------------------------------------------

type LeagueConfig = {
  id: number;
  name: string;
  sport: string;
  keywords: string[];
  tz: string; // IANA timezone for strTime interpretation
};

const TARGET_LEAGUES: LeagueConfig[] = [
  // Soccer
  { id: 4334, name: "French Ligue 1",          sport: "soccer",            keywords: ["ligue 1", "french"],                   tz: "Europe/Paris" },
  { id: 4335, name: "Spanish La Liga",          sport: "soccer",            keywords: ["la liga", "spanish", "primera"],        tz: "Europe/Madrid" },
  { id: 4328, name: "English Premier League",   sport: "soccer",            keywords: ["premier league", "english premier"],    tz: "Europe/London" },
  { id: 4332, name: "Italian Serie A",          sport: "soccer",            keywords: ["serie a", "italian"],                  tz: "Europe/Rome" },
  { id: 4429, name: "FIFA World Cup",           sport: "soccer",            keywords: ["world cup", "fifa"],                   tz: "UTC" },
  // Basketball
  { id: 4387, name: "NBA",                      sport: "basketball",        keywords: ["nba", "national basketball"],           tz: "America/New_York" },
  // American Football
  { id: 4391, name: "NFL",                      sport: "american_football", keywords: ["nfl", "national football league"],      tz: "America/New_York" },
  // Tennis — tournament locations vary; UTC is a safe baseline
  { id: 4581, name: "ATP Tour",                 sport: "tennis",            keywords: ["atp"],                                 tz: "UTC" },
  { id: 4582, name: "WTA Tour",                 sport: "tennis",            keywords: ["wta"],                                 tz: "UTC" },
];

function leaguesForSport(sport: string): LeagueConfig[] {
  if (sport === "all") return TARGET_LEAGUES;
  return TARGET_LEAGUES.filter((l) => l.sport === sport);
}

// ---------------------------------------------------------------------------
// Internal cache — 15 min TTL
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { ts: number; data: any }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: any) {
  cache.set(key, { ts: Date.now(), data });
  // Evict stale entries if cache grows
  if (cache.size > 100) {
    const now = Date.now();
    Array.from(cache.entries()).forEach(([k, v]) => {
      if (now - v.ts > CACHE_TTL_MS) cache.delete(k);
    });
  }
}

// Short cache for live lookups (10s)
const LIVE_CACHE_TTL_MS = 10_000;
const liveCache = new Map<string, { ts: number; data: any }>();

function getLiveCached<T>(key: string): T | null {
  const entry = liveCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > LIVE_CACHE_TTL_MS) {
    liveCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setLiveCache(key: string, data: any) {
  liveCache.set(key, { ts: Date.now(), data });
  if (liveCache.size > 50) {
    const now = Date.now();
    Array.from(liveCache.entries()).forEach(([k, v]) => {
      if (now - v.ts > LIVE_CACHE_TTL_MS) liveCache.delete(k);
    });
  }
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    dbg("HTTP error", res.status, url.replace(/json\/[^/]+\//, "json/***/")); // hide key
    return null;
  }
  return res.json();
}

async function fetchV2Json(endpoint: string): Promise<any> {
  const url = `https://www.thesportsdb.com/api/v2/json/${endpoint}`;
  const res = await fetch(url, {
    headers: { "X-API-KEY": getKey() },
  });
  if (!res.ok) {
    dbg("V2 HTTP error", res.status, endpoint);
    return null;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Event normalization
// ---------------------------------------------------------------------------

/** Map TheSportsDB strSport to our internal sport name */
function mapSport(strSport: string | null): string {
  const s = (strSport || "").toLowerCase();
  if (s.includes("soccer") || s.includes("football") && !s.includes("american")) return "soccer";
  if (s.includes("basketball")) return "basketball";
  if (s.includes("tennis")) return "tennis";
  if (s.includes("american football") || s.includes("gridiron")) return "american_football";
  if (s.includes("ice hockey")) return "basketball"; // fallback
  return "soccer"; // default
}

/** Map TheSportsDB event status to our normalized status */
function mapStatus(event: any): "scheduled" | "live" | "finished" {
  const strStatus = (event.strStatus || "").toLowerCase();
  const intHomeScore = event.intHomeScore;
  const intAwayScore = event.intAwayScore;

  // Explicit status text
  if (strStatus.includes("finished") || strStatus.includes("ft") || strStatus === "match finished") {
    return "finished";
  }
  if (strStatus.includes("not started") || strStatus === "ns" || strStatus === "") {
    // Check if event is in the past with scores — might be finished
    if (intHomeScore != null && intAwayScore != null) {
      return "finished";
    }
    return "scheduled";
  }
  if (strStatus.includes("live") || strStatus.includes("progress") ||
      strStatus.includes("1st half") || strStatus.includes("2nd half") ||
      strStatus.includes("half time") || strStatus.includes("ht")) {
    return "live";
  }
  if (strStatus.includes("postponed") || strStatus.includes("cancelled") || strStatus.includes("suspended")) {
    return "scheduled";
  }

  // Fallback: if both scores present and event date is in the past, it's finished
  if (intHomeScore != null && intAwayScore != null) {
    const tsParsed = event.strTimestamp ? parseTsUtc(event.strTimestamp) : null;
    const eventTime = tsParsed ? tsParsed.getTime() : 0;
    if (eventTime > 0 && Date.now() - eventTime > 4 * 3600_000) {
      return "finished";
    }
    return "live"; // scores present but recent = probably live
  }

  return "scheduled";
}

/**
 * If provider says "scheduled" but we're inside the match time window,
 * override to "live". Prevents UI stuck on "Scheduled" after kickoff.
 * Grace: 5 min before start, 10 min after estimated end.
 */
function overrideLiveIfInWindow(
  status: "scheduled" | "live" | "finished",
  startIso: string,
  sport: string,
): "scheduled" | "live" | "finished" {
  if (status !== "scheduled") return status;
  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) return "scheduled";
  const dur = DURATION_MS[sport] || DURATION_MS.soccer;
  const endMs = startMs + dur;
  const now = Date.now();
  const GRACE_BEFORE = 5 * 60_000;
  const GRACE_AFTER = 10 * 60_000;
  if (now >= startMs - GRACE_BEFORE && now <= endMs + GRACE_AFTER) {
    dbg("  overrideLiveIfInWindow: scheduled → live", startIso);
    return "live";
  }
  return "scheduled";
}

function eventToMatch(event: any, leagueCfg?: LeagueConfig): NormalizedMatch | null {
  if (!event) return null;

  const homeTeam = event.strHomeTeam || "";
  const awayTeam = event.strAwayTeam || "";
  if (!homeTeam && !awayTeam) return null;

  const eventId = event.idEvent;
  if (!eventId) return null;

  // Timezone-safe start_time parsing (always returns UTC ISO)
  const startIso = parseTheSportsDbStart(event, leagueCfg);

  const sport = leagueCfg?.sport || mapSport(event.strSport);
  const league = event.strLeague || leagueCfg?.name || "";

  // end_time = start + sport duration (T-2 is applied later in fixturesProvider)
  const endIso = estimatedEndTime(startIso, sport);

  const rawStatus = mapStatus(event);
  const status = overrideLiveIfInWindow(rawStatus, startIso, sport);

  return {
    provider: "thesportsdb",
    provider_event_id: String(eventId),
    sport,
    league,
    home_team: homeTeam,
    away_team: awayTeam,
    start_time: startIso,
    end_time: endIso,
    status,
    label: `${homeTeam} vs ${awayTeam}`,
    raw: {
      thesportsdb_id: eventId,
      home_score: event.intHomeScore != null ? Number(event.intHomeScore) : null,
      away_score: event.intAwayScore != null ? Number(event.intAwayScore) : null,
      status_text: event.strStatus || null,
      round: event.intRound || null,
      venue: event.strVenue || null,
      league_id: event.idLeague || leagueCfg?.id || null,
      season: event.strSeason || null,
      home_badge: event.strHomeTeamBadge || null,
      away_badge: event.strAwayTeamBadge || null,
      parsed_tz: leagueCfg?.tz || "UTC",
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures listing — main export
// ---------------------------------------------------------------------------

/**
 * Fetch upcoming matches from TheSportsDB.
 * Uses eventsnextleague.php (next 15 events per league) — 1 call per league.
 * For the target leagues in a given sport, fetches all in parallel.
 * Does NOT apply T-2 — that's done in fixturesProvider.ts.
 */
export async function listUpcomingMatchesTheSportsDB(params: {
  sport: string;
  days?: number;
  base_date?: string;
}): Promise<NormalizedMatch[]> {
  const { sport, days = 7, base_date } = params;

  const cacheKey = `tsdb:list:${sport}:${base_date || "today"}:${days}`;
  const cached = getCached<NormalizedMatch[]>(cacheKey);
  if (cached) {
    dbg("cache hit:", cacheKey, `(${cached.length} matches)`);
    return cached;
  }

  const leagues = leaguesForSport(sport);
  if (leagues.length === 0) {
    dbg(`no leagues configured for sport=${sport}`);
    return [];
  }

  dbg(`fetching upcoming for sport=${sport}, ${leagues.length} leagues, days=${days}`);

  // Compute the date window for filtering
  const baseDate = base_date ? new Date(base_date) : new Date();
  const windowEnd = new Date(baseDate.getTime() + days * 86400_000);

  // Fetch next events for each league in parallel
  const fetches = leagues.map(async (league) => {
    try {
      const url = v1Url(`eventsnextleague.php?id=${league.id}`);
      const json = await fetchJson(url);
      const events: any[] = json?.events || [];
      dbg(`  league=${league.name} (${league.id}) → ${events.length} events`);

      const matches: NormalizedMatch[] = [];
      for (const ev of events) {
        const m = eventToMatch(ev, league);
        if (!m) continue;

        // Filter to requested date window
        const startMs = new Date(m.start_time).getTime();
        if (startMs < baseDate.getTime() || startMs > windowEnd.getTime()) continue;

        matches.push(m);
      }
      return matches;
    } catch (e: any) {
      dbg(`  league=${league.name} error:`, e?.message);
      return [];
    }
  });

  const results = await Promise.all(fetches);
  const all = results.flat();

  dbg(`total: ${all.length} matches for sport=${sport}`);
  setCache(cacheKey, all);
  return all;
}

// ---------------------------------------------------------------------------
// Live score lookup — single event
// ---------------------------------------------------------------------------

export type LiveScoreResult = {
  provider: "thesportsdb";
  provider_event_id: string;
  status: "scheduled" | "live" | "finished" | "unknown";
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  minute: number | null;
  start_time: string | null;
  league: string | null;
  raw: Record<string, unknown>;
};

/**
 * Fetch live/current status for a single event.
 * - Premium: tries V2 livescore endpoint first (if key != "3")
 * - Free: falls back to lookupevent.php which has scores for finished events
 *   and basic status info.
 */
export async function fetchLiveScore(eventId: string): Promise<LiveScoreResult> {
  const fallback: LiveScoreResult = {
    provider: "thesportsdb",
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
  };

  if (!eventId) return fallback;

  // Check short cache
  const cacheKey = `tsdb:live:${eventId}`;
  const cached = getLiveCached<LiveScoreResult>(cacheKey);
  if (cached) return cached;

  try {
    // Try event lookup (works on free tier)
    const url = v1Url(`lookupevent.php?id=${eventId}`);
    const json = await fetchJson(url);
    const events = json?.events;
    if (!events || !Array.isArray(events) || events.length === 0) {
      dbg("lookupevent: no result for", eventId);
      setLiveCache(cacheKey, fallback);
      return fallback;
    }

    const ev = events[0];
    const rawStatus = mapStatus(ev);
    const homeScore = ev.intHomeScore != null ? Number(ev.intHomeScore) : null;
    const awayScore = ev.intAwayScore != null ? Number(ev.intAwayScore) : null;

    // Try to extract minute from strProgress (V2 livescore field) or strStatus
    let minute: number | null = null;
    const progress = ev.strProgress || ev.strStatus || "";
    const minuteMatch = progress.match(/(\d+)(?:'|:|min)/);
    if (minuteMatch) minute = parseInt(minuteMatch[1], 10);

    // Parse start_time with timezone awareness (find matching league config)
    const leagueCfg = TARGET_LEAGUES.find((l) => String(l.id) === String(ev.idLeague));
    const startIso = parseTheSportsDbStart(ev, leagueCfg);

    // Live override: if provider says scheduled but we're inside match window
    const sport = leagueCfg?.sport || mapSport(ev.strSport);
    const status = overrideLiveIfInWindow(rawStatus, startIso, sport);

    const result: LiveScoreResult = {
      provider: "thesportsdb",
      provider_event_id: eventId,
      status: status === "scheduled" || status === "live" || status === "finished" ? status : "unknown",
      home_team: ev.strHomeTeam || "",
      away_team: ev.strAwayTeam || "",
      home_score: homeScore,
      away_score: awayScore,
      minute,
      start_time: startIso,
      league: ev.strLeague || null,
      raw: {
        status_text: ev.strStatus || null,
        progress: ev.strProgress || null,
        round: ev.intRound || null,
        venue: ev.strVenue || null,
        home_badge: ev.strHomeTeamBadge || null,
        away_badge: ev.strAwayTeamBadge || null,
        date_event: ev.dateEvent || null,
        idLeague: ev.idLeague || null,
      },
    };

    setLiveCache(cacheKey, result);
    dbg("live score:", eventId, `${result.home_team} ${homeScore ?? "?"}-${awayScore ?? "?"} ${result.away_team}`, status);
    return result;
  } catch (e: any) {
    dbg("fetchLiveScore error:", e?.message);
    return fallback;
  }
}
