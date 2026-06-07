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

/** Official admin-created World Cup match markets. */
export async function getWorldCupMatchMarkets(
  limit?: number,
): Promise<WorldCupMarket[]> {
  try {
    const rows = (await fetchSoccerRows())
      .filter(isOfficialMatchMarket)
      .filter(isWorldCupMarket)
      .map((r) => toWorldCupMarket(r));
    return typeof limit === "number" ? rows.slice(0, limit) : rows;
  } catch {
    return [];
  }
}

/** User-created soccer side markets. */
export async function getWorldCupSideMarkets(
  limit?: number,
): Promise<WorldCupMarket[]> {
  try {
    const rows = (await fetchSoccerRows())
      .filter(isSideMarket)
      .map((r) => toWorldCupMarket(r, true));
    return typeof limit === "number" ? rows.slice(0, limit) : rows;
  } catch {
    return [];
  }
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
  };
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
