// app/src/lib/officialSportMarkets.ts
// Server-only lookup over the existing `markets` table for official
// (admin-created) soccer match markets. No new schema, no provider or contract
// changes — this only reads what the sport creation flow already stores.
//
// Extracted verbatim from the deleted World Cup hub (app/src/app/world-cup/
// _lib/marketQueries.ts) so /api/sports/search keeps working after the hub was
// removed. Behaviour is deliberately unchanged, including the soccer-category
// scope and the id-resolution fallback chain below — widening either is a
// product decision, not a cleanup.
//
// An "official match market" is a soccer row with market_mode "sport".
// User-created side markets (market_mode "sport_side") are intentionally out of
// scope: a fixture can carry many side markets and still be available for an
// official market.

import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";

/**
 * Provider event ids that already have an OFFICIAL match market, so the admin
 * fixture picker can hide fixtures that would produce a duplicate.
 * Never throws — returns an empty set on any failure.
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

// Same 500-row window and ordering as the original. Only the three columns
// this module actually reads are selected — the projection does not affect
// which rows the server returns.
async function fetchSoccerRows(): Promise<any[]> {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("markets")
    .select("category, market_mode, sport_meta")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error || !Array.isArray(data)) return [];
  return (data as any[]).filter(
    (r) => String(r?.category || "").trim().toLowerCase() === "soccer",
  );
}

function isOfficialMatchMarket(row: any): boolean {
  return String(row?.market_mode || "").trim() === "sport";
}

function asObject(v: unknown): Record<string, any> {
  return v && typeof v === "object" ? (v as Record<string, any>) : {};
}

function pickStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
