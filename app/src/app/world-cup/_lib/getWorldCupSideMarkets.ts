// app/src/app/world-cup/_lib/getWorldCupSideMarkets.ts
// Server-only fetch of user-created Soccer side markets for the World Cup hub.
//
// A "side market" is a normal market created via the user soccer side-market
// flow: category "soccer" + market_mode "sport_side" (or sport_meta.side_market
// === true). No new schema — reuses the existing `markets` columns. The shape
// returned is exactly what the homepage <MarketCard> expects, so we can reuse
// that component verbatim. Never throws — returns [] on any failure.

import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import { withMatchPrefix } from "@/lib/sideMarketTitle";

export type SideMarketCard = {
  publicKey: string;
  question: string;
  description?: string;
  category: string;
  imageUrl: string | null;
  yesSupply: number;
  noSupply: number;
  outcomeNames?: string[];
  outcomeSupplies?: number[];
  resolutionTime: number; // unix seconds (from end_date)
  totalVolume: number;
  resolved: boolean;
};

const MARKET_SELECT =
  "market_address, question, description, category, image_url, end_date, " +
  "yes_supply, no_supply, total_volume, resolved, market_type, " +
  "outcome_names, outcome_supplies, market_mode, sport_meta, created_at";

export async function getWorldCupSideMarkets(
  limit = 8,
): Promise<SideMarketCard[]> {
  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from("markets")
      .select(MARKET_SELECT)
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(120);

    if (error || !Array.isArray(data)) return [];

    return data
      .filter(isSoccerSideMarket)
      .slice(0, limit)
      .map(toSideMarketCard);
  } catch {
    return [];
  }
}

function isSoccerSideMarket(row: any): boolean {
  const category = String(row?.category || "").trim().toLowerCase();
  if (category !== "soccer") return false;

  const mode = String(row?.market_mode || "").trim();
  const sportMeta =
    row?.sport_meta && typeof row.sport_meta === "object" ? row.sport_meta : {};

  return mode === "sport_side" || sportMeta.side_market === true;
}

function toSideMarketCard(row: any): SideMarketCard {
  const sportMeta =
    row?.sport_meta && typeof row.sport_meta === "object" ? row.sport_meta : {};
  const endMs = row?.end_date ? new Date(row.end_date).getTime() : NaN;

  // Display title with match context. Newer side markets already store the
  // prefix; for older rows we derive it from sport_meta home/away (display
  // only — the DB row is not mutated). withMatchPrefix avoids double-prefix.
  const rawQuestion = String(row.question || "");
  const home = typeof sportMeta.home_team === "string" ? sportMeta.home_team : "";
  const away = typeof sportMeta.away_team === "string" ? sportMeta.away_team : "";
  const displayQuestion =
    home && away ? withMatchPrefix(`${home} vs ${away}`, rawQuestion) : rawQuestion;

  return {
    publicKey: String(row.market_address),
    question: displayQuestion,
    description: row.description ? String(row.description) : undefined,
    category: String(row.category || "soccer"),
    imageUrl:
      (row.image_url && String(row.image_url)) ||
      (typeof sportMeta.image === "string" ? sportMeta.image : null),
    yesSupply: Number(row.yes_supply) || 0,
    noSupply: Number(row.no_supply) || 0,
    outcomeNames: Array.isArray(row.outcome_names)
      ? row.outcome_names.map((s: unknown) => String(s))
      : undefined,
    outcomeSupplies: Array.isArray(row.outcome_supplies)
      ? row.outcome_supplies.map((n: unknown) => Number(n) || 0)
      : undefined,
    resolutionTime: Number.isFinite(endMs) ? Math.floor(endMs / 1000) : 0,
    totalVolume: Number(row.total_volume) || 0,
    resolved: !!row.resolved,
  };
}
