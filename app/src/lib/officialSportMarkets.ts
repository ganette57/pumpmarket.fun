// app/src/lib/officialSportMarkets.ts
// Server-only lookup over the existing `markets` table for official
// (admin-created) sport match markets. No new schema, no provider or contract
// changes — this only reads what the sport creation flow already stores.
//
// An "official match market" is a row with market_mode "sport". User-created
// side markets (market_mode "sport_side") are intentionally out of scope: a
// fixture can carry many side markets and still be available for an official
// market.

import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";

/**
 * Provider event ids that already have an OFFICIAL match market, so the admin
 * fixture picker can hide fixtures that would produce a duplicate.
 * Never throws — returns an empty set on any failure.
 */
export async function getOfficialMatchProviderEventIds(): Promise<Set<string>> {
  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from("markets")
      .select("sport_meta, market_mode")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error || !Array.isArray(data)) return new Set();

    const ids = new Set<string>();
    for (const row of data as any[]) {
      if (String(row?.market_mode || "").trim() !== "sport") continue;
      const id = providerEventIdOf(row);
      if (id) ids.add(id);
    }
    return ids;
  } catch {
    return new Set();
  }
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

function asObject(v: unknown): Record<string, any> {
  return v && typeof v === "object" ? (v as Record<string, any>) : {};
}

function pickStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
