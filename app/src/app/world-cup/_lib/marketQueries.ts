// app/src/app/world-cup/_lib/marketQueries.ts
// Server-only queries for the World Cup hub + its "View all" pages.
//
// Two kinds of soccer markets are surfaced, both from the existing `markets`
// table (no new schema, no provider/contract changes):
//   - Official match markets : category "soccer" + market_mode "sport"
//                              (admin/official flow; FIFA World Cup / league 4429)
//   - Side markets           : category "soccer" + (market_mode "sport_side"
//                              OR sport_meta.side_market === true)
//
// The returned shape is a superset of what <MarketCard> needs, plus team /
// league / status fields for client-side filtering. Never throws → [] on error.

import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import { withMatchPrefix } from "@/lib/sideMarketTitle";

const WORLD_CUP_LEAGUE_ID = "4429";

export type WorldCupMarket = {
  // <MarketCard>-compatible fields
  publicKey: string;
  question: string;
  description?: string;
  category: string;
  imageUrl: string | null;
  yesSupply: number;
  noSupply: number;
  outcomeNames?: string[];
  outcomeSupplies?: number[];
  resolutionTime: number; // unix seconds
  totalVolume: number;
  resolved: boolean;
  // Extra fields for filtering / display
  homeTeam: string | null;
  awayTeam: string | null;
  league: string | null;
  kickoffIso: string | null;
  ended: boolean;
  createdAtMs: number;
  providerEventId: string | null;
};

const MARKET_SELECT =
  "market_address, question, description, category, image_url, end_date, " +
  "yes_supply, no_supply, total_volume, resolved, resolution_status, " +
  "cancelled, market_type, outcome_names, outcome_supplies, market_mode, " +
  "sport_meta, created_at";

async function fetchSoccerRows(): Promise<any[]> {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("markets")
    .select(MARKET_SELECT)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error || !Array.isArray(data)) return [];
  return (data as any[]).filter(
    (r) => String(r?.category || "").trim().toLowerCase() === "soccer",
  );
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

/**
 * Official admin-created World Cup match markets for the "Upcoming" rail.
 * Ended/resolved/closed markets are dropped, then sorted by kickoff ascending
 * (nearest upcoming first) so today's next matches surface first. Falls back to
 * end_date when no kickoff is stored.
 */
export async function getWorldCupMatchMarkets(
  limit?: number,
  opts?: { includeEnded?: boolean },
): Promise<WorldCupMarket[]> {
  try {
    const mapped = (await fetchSoccerRows())
      .filter(isOfficialMatchMarket)
      .filter(isWorldCupMarket)
      .map((r) => toWorldCupMarket(r));
    // Full-list pages opt in to ended markets so the Ended / All tabs work;
    // the hub rail keeps the default (upcoming/open only). When ended markets
    // are included, keep open/upcoming first, then most-recently-ended.
    const rows = opts?.includeEnded
      ? mapped.sort((a, b) => {
          if (a.ended !== b.ended) return a.ended ? 1 : -1;
          return a.ended ? kickoffMs(b) - kickoffMs(a) : kickoffMs(a) - kickoffMs(b);
        })
      : mapped.filter((m) => !m.ended).sort((a, b) => kickoffMs(a) - kickoffMs(b));
    return typeof limit === "number" ? rows.slice(0, limit) : rows;
  } catch {
    return [];
  }
}

/**
 * Map of provider event id → official match market address, across ALL official
 * World Cup match markets (no ended filter, no limit). Lets the live-match rail
 * link each real fixture to its trade page. Never throws.
 */
export async function getOfficialMatchMarketAddressByEventId(): Promise<
  Map<string, string>
> {
  try {
    const rows = (await fetchSoccerRows()).filter(isOfficialMatchMarket);
    const map = new Map<string, string>();
    for (const r of rows) {
      const id = providerEventIdOf(r);
      const addr = pickStr(r?.market_address);
      if (id && addr && !map.has(id)) map.set(id, addr);
    }
    return map;
  } catch {
    return new Map();
  }
}

function kickoffMs(m: WorldCupMarket): number {
  const t = m.kickoffIso ? new Date(m.kickoffIso).getTime() : NaN;
  if (Number.isFinite(t)) return t;
  // Fallback: resolutionTime is unix seconds (end_date).
  return m.resolutionTime > 0 ? m.resolutionTime * 1000 : Number.MAX_SAFE_INTEGER;
}

/**
 * Provider event ids that already have an OFFICIAL match market.
 * Used to prevent admins from creating duplicate official markets. Side
 * markets are intentionally NOT included here (a fixture can have many side
 * markets and still be available for an official market). Never throws.
 */
export async function getOfficialMatchProviderEventIds(): Promise<Set<string>> {
  try {
    const rows = (await fetchSoccerRows()).filter(isOfficialMatchMarket);
    const ids = new Set<string>();
    for (const r of rows) {
      const meta = asObject(r?.sport_meta);
      const id =
        pickStr(meta.provider_event_id) ||
        pickStr(asObject(meta.raw).thesportsdb_id) ||
        (asObject(meta.raw).league_id != null
          ? pickStr(String(asObject(meta.raw).thesportsdb_id ?? ""))
          : null);
      if (id) ids.add(id);
    }
    return ids;
  } catch {
    return new Set();
  }
}

/**
 * User-created soccer side markets for the hub rail. Ended/resolved/closed
 * markets are dropped, then the active ones are ranked by relevance:
 *   1. live/open first (match currently in progress),
 *   2. then soonest start/end date,
 *   3. then newest created.
 */
export async function getWorldCupSideMarkets(
  limit?: number,
  opts?: { includeEnded?: boolean },
): Promise<WorldCupMarket[]> {
  try {
    const openSort = (a: WorldCupMarket, b: WorldCupMarket) => {
      const aLive = isLiveMarket(a);
      const bLive = isLiveMarket(b);
      if (aLive !== bLive) return aLive ? -1 : 1;
      const dateDiff = relevanceDateMs(a) - relevanceDateMs(b);
      if (dateDiff !== 0) return dateDiff;
      return b.createdAtMs - a.createdAtMs;
    };
    const mapped = (await fetchSoccerRows())
      .filter(isSideMarket)
      .map((r) => toWorldCupMarket(r, true));
    // Full-list page opts in to ended markets so the Ended / All tabs work;
    // the hub rail keeps the default (open only). Ended markets sort after the
    // open ones, most-recent first.
    const rows = opts?.includeEnded
      ? mapped.sort((a, b) => {
          if (a.ended !== b.ended) return a.ended ? 1 : -1;
          if (a.ended) {
            return relevanceDateMs(b) - relevanceDateMs(a) || b.createdAtMs - a.createdAtMs;
          }
          return openSort(a, b);
        })
      : mapped.filter((m) => !m.ended).sort(openSort);
    return typeof limit === "number" ? rows.slice(0, limit) : rows;
  } catch {
    return [];
  }
}

/** Market is "live" when now sits between kickoff and end. */
function isLiveMarket(m: WorldCupMarket): boolean {
  const start = m.kickoffIso ? new Date(m.kickoffIso).getTime() : NaN;
  const end = m.resolutionTime > 0 ? m.resolutionTime * 1000 : NaN;
  const now = Date.now();
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    now >= start &&
    now < end
  );
}

/** Soonest relevant moment: upcoming kickoff if still in the future, else end. */
function relevanceDateMs(m: WorldCupMarket): number {
  const start = m.kickoffIso ? new Date(m.kickoffIso).getTime() : NaN;
  const now = Date.now();
  if (Number.isFinite(start) && start >= now) return start;
  if (m.resolutionTime > 0) return m.resolutionTime * 1000;
  if (Number.isFinite(start)) return start;
  return Number.MAX_SAFE_INTEGER;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function isOfficialMatchMarket(row: any): boolean {
  return String(row?.market_mode || "").trim() === "sport";
}

function isSideMarket(row: any): boolean {
  const mode = String(row?.market_mode || "").trim();
  const meta = asObject(row?.sport_meta);
  return mode === "sport_side" || meta.side_market === true;
}

/**
 * World Cup scoping (best-effort): accept when league info points to the World
 * Cup (league_id 4429, or "world cup" in league/question). When no league
 * info is present at all, default to include rather than drop a valid market.
 */
function isWorldCupMarket(row: any): boolean {
  const meta = asObject(row?.sport_meta);
  const raw = asObject(meta.raw);
  const leagueId = raw.league_id != null ? String(raw.league_id) : "";
  if (leagueId) return leagueId === WORLD_CUP_LEAGUE_ID;

  const league = String(meta.league || "").toLowerCase();
  const question = String(row?.question || "").toLowerCase();
  if (league) return league.includes("world cup");
  if (question.includes("world cup")) return true;
  return true; // no league info → don't exclude
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toWorldCupMarket(row: any, sideMarket = false): WorldCupMarket {
  const meta = asObject(row?.sport_meta);
  const raw = asObject(meta.raw);
  const endMs = row?.end_date ? new Date(row.end_date).getTime() : NaN;
  const resolutionTime = Number.isFinite(endMs) ? Math.floor(endMs / 1000) : 0;
  const createdMs = row?.created_at ? new Date(row.created_at).getTime() : NaN;
  const resolved = !!row?.resolved || row?.resolution_status === "finalized";
  const ended =
    resolved ||
    !!row?.cancelled ||
    (resolutionTime > 0 && resolutionTime * 1000 < Date.now());

  const home =
    pickStr(meta.home_team) || pickStr(raw.home_team) || null;
  const away =
    pickStr(meta.away_team) || pickStr(raw.away_team) || null;

  // Side markets: ensure the display title carries the match context (older
  // rows may lack it). Official markets already read "Home vs Away - League".
  const rawQuestion = String(row?.question || "");
  const question =
    sideMarket && home && away
      ? withMatchPrefix(`${home} vs ${away}`, rawQuestion)
      : rawQuestion;

  return {
    publicKey: String(row.market_address),
    question,
    description: row?.description ? String(row.description) : undefined,
    category: String(row?.category || "soccer"),
    imageUrl:
      (row?.image_url && String(row.image_url)) ||
      pickStr(meta.image) ||
      pickStr(raw.event_thumb) ||
      null,
    yesSupply: Number(row?.yes_supply) || 0,
    noSupply: Number(row?.no_supply) || 0,
    outcomeNames: Array.isArray(row?.outcome_names)
      ? row.outcome_names.map((s: unknown) => String(s))
      : undefined,
    outcomeSupplies: Array.isArray(row?.outcome_supplies)
      ? row.outcome_supplies.map((n: unknown) => Number(n) || 0)
      : undefined,
    resolutionTime,
    totalVolume: Number(row?.total_volume) || 0,
    resolved,
    homeTeam: home,
    awayTeam: away,
    league: pickStr(meta.league) || (raw.league_id ? "FIFA World Cup" : null),
    kickoffIso:
      pickStr(meta.kickoff) ||
      pickStr(meta.start_time) ||
      (row?.end_date ? String(row.end_date) : null),
    ended,
    createdAtMs: Number.isFinite(createdMs) ? createdMs : 0,
    providerEventId: providerEventIdOf(row),
  };
}

/** Best-effort provider (TheSportsDB) event id stored on a market row. */
function providerEventIdOf(row: any): string | null {
  const meta = asObject(row?.sport_meta);
  const raw = asObject(meta.raw);
  return (
    pickStr(meta.provider_event_id) ||
    pickStr(raw.thesportsdb_id) ||
    (raw.thesportsdb_id != null ? pickStr(String(raw.thesportsdb_id)) : null)
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asObject(v: unknown): Record<string, any> {
  return v && typeof v === "object" ? (v as Record<string, any>) : {};
}

function pickStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
