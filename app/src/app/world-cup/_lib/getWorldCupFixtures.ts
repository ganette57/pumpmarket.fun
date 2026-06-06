// app/src/app/world-cup/_lib/getWorldCupFixtures.ts
// Server-only helper that pulls World Cup fixtures from the EXISTING
// sports fixture provider stack (TheSportsDB league id 4429).
//
// Source order (first non-empty wins):
//   1. Full 2026 season via eventsseason.php (listWorldCupSeasonMatchesTheSportsDB)
//   2. listUpcomingMatches({ sport: "soccer", days: 30 }) filtered to WC
//   3. Mock fallback (page-level) when both return zero WC fixtures
//
// - No new API route, no new provider, no new env vars.
// - Maps NormalizedMatch → the hub's existing LiveMatch / UpcomingMatch shapes.
// - Never throws.

import "server-only";

import {
  listUpcomingMatches,
  type NormalizedMatch,
} from "@/lib/sportsProviders/fixturesProvider";
import { listWorldCupSeasonMatchesTheSportsDB } from "@/lib/sportsProviders/theSportsDbProvider";

import type {
  LiveMatch,
  UpcomingMatch,
  MatchOutcome,
  Team,
} from "../_components/mockData";

const WORLD_CUP_LEAGUE_ID = "4429";
const WORLD_CUP_SEASON = "2026";
const UPCOMING_CAP = 12;

export type WorldCupFixtures = {
  /**
   * True when TheSportsDB returned at least one real World Cup fixture.
   * When false, the page falls back to mock data (provider empty / offline).
   */
  hasRealFixtures: boolean;
  /** Real LIVE World Cup matches (status === "live"). Empty when none. */
  liveMatches: LiveMatch[];
  /** Real upcoming World Cup fixtures, sorted ascending, capped. Empty when none. */
  upcomingMatches: UpcomingMatch[];
};

/**
 * Main entry point.
 *
 * - When real World Cup fixtures exist: `hasRealFixtures = true`, and the
 *   returned lists contain ONLY real data. `liveMatches` may be empty (no
 *   fake live matches are ever injected). Upcoming fixtures are shown
 *   regardless of how far away they are.
 * - When the provider returns ZERO World Cup fixtures: `hasRealFixtures =
 *   false` with empty lists, so the page can fall back to mock data.
 */
export async function getWorldCupFixtures(): Promise<WorldCupFixtures> {
  const wc = await loadWorldCupMatches();
  if (wc.length === 0) {
    return { hasRealFixtures: false, liveMatches: [], upcomingMatches: [] };
  }

  // Live: ONLY real live matches. No fake live matches, ever.
  const liveMatches = wc.filter((m) => m.status === "live").map(toLiveMatch);

  // Upcoming: every scheduled WC fixture, however far away, sorted ascending.
  const upcomingMatches = wc
    .filter((m) => m.status === "scheduled")
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    )
    .slice(0, UPCOMING_CAP)
    .map(toUpcomingMatch);

  return { hasRealFixtures: true, liveMatches, upcomingMatches };
}

/**
 * Source resolution. Tries the full 2026 season endpoint first; if that
 * returns nothing, falls back to the generic upcoming-matches path filtered
 * to the World Cup. Returns [] only when both sources are empty.
 */
async function loadWorldCupMatches(): Promise<NormalizedMatch[]> {
  // 1. Full season — the complete World Cup schedule, not just next events.
  try {
    const season = await listWorldCupSeasonMatchesTheSportsDB({
      season: WORLD_CUP_SEASON,
    });
    const wc = season.filter(isWorldCup);
    if (wc.length > 0) return wc;
  } catch {
    // helper never throws, belt-and-braces
  }

  // 2. Fallback — generic upcoming fixtures filtered to the World Cup.
  try {
    const matches = await listUpcomingMatches({ sport: "soccer", days: 30 });
    return matches.filter(isWorldCup);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function isWorldCup(m: NormalizedMatch): boolean {
  const raw = (m.raw || {}) as Record<string, unknown>;
  const leagueId = raw.league_id;
  if (leagueId != null && String(leagueId) === WORLD_CUP_LEAGUE_ID) {
    return true;
  }
  if (
    typeof m.league === "string" &&
    m.league.toLowerCase().includes("fifa world cup")
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Mapping NormalizedMatch → hub shapes
// ---------------------------------------------------------------------------

function pickBadge(raw: Record<string, unknown>, side: "home" | "away"): string | null {
  const v = raw[`${side}_badge`];
  return typeof v === "string" && v.trim() ? v : null;
}

/** Match artwork, priority: thumb → poster → banner. Null if none. */
function pickImage(raw: Record<string, unknown>): string | null {
  for (const key of ["event_thumb", "event_poster", "event_banner"]) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function pickScore(raw: Record<string, unknown>, side: "home" | "away"): number {
  const v = raw[`${side}_score`];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function makeTeam(name: string, badge: string | null): Team {
  return {
    name,
    badge,
    // flag stays undefined for real fixtures — TeamLine falls back to nothing,
    // which is fine because the badge is almost always present for upcoming WC.
  };
}

function roundLabel(raw: Record<string, unknown>): string {
  const r = raw.round;
  if (typeof r === "number" && Number.isFinite(r)) return `Round ${r}`;
  if (typeof r === "string" && r.trim()) return `Round ${r}`;
  return "World Cup";
}

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBD";

  // We format in UTC so server and client agree (no hydration drift) and so
  // results don't depend on the server's local timezone.
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;

  const now = new Date();
  const todayKey = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const dayKey = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dayDiff = Math.round((dayKey - todayKey) / 86400_000);

  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Tomorrow ${time}`;

  const month = d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
  });
  return `${month} ${d.getUTCDate()} · ${time}`;
}

function hashStr(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Deterministic mock-ish "markets count" so the same event always renders
 * the same number. This is purely cosmetic — there is no real markets
 * system yet for World Cup fixtures.
 */
function fakeMarketsCount(eventId: string): number {
  return 100 + (hashStr(eventId) % 120);
}

/**
 * Deterministic 3-way (Home / Draw / Away) mock odds derived from the event
 * id, so the same fixture always renders the same split. Cosmetic only —
 * there is no real World Cup market/odds engine yet.
 */
function fakeThreeWayOdds(eventId: string, home: string, away: string): MatchOutcome[] {
  const h = hashStr(eventId);
  const homePct = 30 + (h % 26); // 30..55
  const drawPct = 20 + ((h >> 4) % 13); // 20..32
  let awayPct = 100 - homePct - drawPct;
  if (awayPct < 8) awayPct = 8;
  return [
    { label: home, pct: homePct },
    { label: "Draw", pct: drawPct },
    { label: away, pct: awayPct },
  ];
}

function elapsedMinuteLabel(startIso: string): string {
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return "Live";
  const minutes = Math.floor((Date.now() - start) / 60_000);
  if (minutes <= 0) return "Live";
  if (minutes > 120) return "FT";
  return `${minutes}'`;
}

function toLiveMatch(m: NormalizedMatch): LiveMatch {
  const raw = (m.raw || {}) as Record<string, unknown>;
  return {
    id: m.provider_event_id,
    group: roundLabel(raw),
    home: makeTeam(m.home_team, pickBadge(raw, "home")),
    away: makeTeam(m.away_team, pickBadge(raw, "away")),
    scoreHome: pickScore(raw, "home"),
    scoreAway: pickScore(raw, "away"),
    minute: elapsedMinuteLabel(m.start_time),
    markets: fakeMarketsCount(m.provider_event_id),
    outcomes: fakeThreeWayOdds(m.provider_event_id, m.home_team, m.away_team),
  };
}

function toUpcomingMatch(m: NormalizedMatch): UpcomingMatch {
  const raw = (m.raw || {}) as Record<string, unknown>;
  return {
    id: m.provider_event_id,
    kickoff: formatKickoff(m.start_time),
    group: roundLabel(raw),
    home: makeTeam(m.home_team, pickBadge(raw, "home")),
    away: makeTeam(m.away_team, pickBadge(raw, "away")),
    markets: fakeMarketsCount(m.provider_event_id),
    image: pickImage(raw),
    outcomes: fakeThreeWayOdds(m.provider_event_id, m.home_team, m.away_team),
  };
}
