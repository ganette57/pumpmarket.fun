import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTopHomeLiveFlashMarket } from "@/lib/liveMicro/flashMarkets";

// Singleton — reused between invocations (warm lambda)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// force-dynamic: skip ISR pre-render (response too large for fallback).
// CDN caching is handled via Cache-Control header in the response.
export const dynamic = "force-dynamic";
const FEATURED_LIMIT = 5;
// Keep these generous so classic markets are not evicted when many recent
// flash rows exist; final payload is still filtered/deduped below.
const OPEN_LIMIT = 1000;
const RESOLVED_LIMIT = 1000;

type MarketRow = Record<string, any>;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isTrue(value: unknown): boolean {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

function isDevnetOnlyLiveMicroMarket(row: Record<string, unknown>): boolean {
  const sportMeta = asObject(row.sport_meta);
  const liveMicro = asObject(sportMeta.live_micro);
  return isTrue(sportMeta.devnet_only) || isTrue(liveMicro.devnet_only);
}

function isSoccerNextGoalMicroMarket(row: Record<string, unknown>): boolean {
  const sportMeta = asObject(row.sport_meta);
  const liveMicro = asObject(sportMeta.live_micro);
  const type = String(
    sportMeta.micro_market_type ||
      sportMeta.microMarketType ||
      liveMicro.micro_market_type ||
      liveMicro.microMarketType ||
      "",
  )
    .trim()
    .toLowerCase();

  return type === "soccer_next_goal_5m" || type.includes("next_goal");
}

function isFlashCryptoMarket(row: Record<string, unknown>): boolean {
  return String(row.market_mode || "").trim() === "flash_crypto";
}

function normalizeImage(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  return trimmed;
}

function isClassicResolved(row: MarketRow): boolean {
  const status = String(row.resolution_status || "").toLowerCase();
  if (row.resolved === true) return true;
  return status === "proposed" || status === "finalized" || status === "cancelled";
}

function dedupeByAddress(rows: MarketRow[]): MarketRow[] {
  const out: MarketRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const addr = String(row.market_address || "").trim();
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    out.push(row);
  }
  return out;
}

function toMs(value: unknown): number {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function sortByRecencyDesc(a: MarketRow, b: MarketRow): number {
  return toMs(b.created_at) - toMs(a.created_at);
}

function sortByVolumeThenRecencyDesc(a: MarketRow, b: MarketRow): number {
  const volA = Number(a.total_volume || 0);
  const volB = Number(b.total_volume || 0);
  if (volB !== volA) return volB - volA;
  return sortByRecencyDesc(a, b);
}

function sanitizeClassicRows(rows: MarketRow[]): MarketRow[] {
  const isProdPublicListing = process.env.NODE_ENV === "production";
  return rows
    .filter((m) => !(isProdPublicListing && isDevnetOnlyLiveMicroMarket(m)))
    .filter((m) => !isSoccerNextGoalMicroMarket(m))
    .filter((m) => !isFlashCryptoMarket(m))
    .map((m) => ({
      ...m,
      image_url: normalizeImage(m.image_url),
    }));
}

export async function GET() {
  try {
    const homeLiveFlashPromise = getTopHomeLiveFlashMarket("sport").catch((error) => {
      console.error("/api/home top flash market error:", error);
      return null;
    });

    const marketSelect = `
      id,
      market_address,
      question,
      description,
      category,
      image_url,
      end_date,
      yes_supply,
      no_supply,
      total_volume,
      created_at,
      start_time,
      end_time,
      resolved,
      resolution_status,
      sport_trading_state,
      cancelled,
      is_blocked,
      market_type,
      outcome_names,
      outcome_supplies,
      market_mode,
      sport_meta,
      creator,
      social_links
    `;

    const [openRes, resolvedRes, proposedRes, liveRes, topLiveFlashMarket] = await Promise.all([
      sb
        .from("markets")
        .select(marketSelect)
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(OPEN_LIMIT),

      sb
        .from("markets")
        .select(marketSelect)
        .eq("resolved", true)
        .order("created_at", { ascending: false })
        .limit(RESOLVED_LIMIT),

      sb
        .from("markets")
        .select(marketSelect)
        .in("resolution_status", ["proposed", "finalized", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(RESOLVED_LIMIT),

      sb
        .from("live_sessions")
        .select("id,market_address,status,created_at")
        .in("status", ["live", "locked"])
        .order("created_at", { ascending: false })
        .limit(100),
      homeLiveFlashPromise,
    ]);

    if (openRes.error || resolvedRes.error || proposedRes.error) {
      console.error("/api/home markets error:", {
        open: openRes.error,
        resolved: resolvedRes.error,
        proposed: proposedRes.error,
      });
      return NextResponse.json(
        { error: "markets query failed" },
        { status: 500 }
      );
    }

    // Build live map: market_address -> session id
    const liveMap: Record<string, string> = {};
    if (!liveRes.error && liveRes.data) {
      for (const row of liveRes.data) {
        if (!liveMap[row.market_address]) {
          liveMap[row.market_address] = row.id;
        }
      }
    }

    const openCandidates = sanitizeClassicRows((openRes.data as MarketRow[]) || []);
    const resolvedCandidates = sanitizeClassicRows([
      ...(((resolvedRes.data as MarketRow[]) || [])),
      ...(((proposedRes.data as MarketRow[]) || [])),
    ]);

    const openMarketsClassic = dedupeByAddress(openCandidates)
      .filter((m) => !isClassicResolved(m))
      .sort(sortByRecencyDesc);

    const resolvedMarketsClassic = dedupeByAddress(resolvedCandidates)
      .filter((m) => isClassicResolved(m))
      .sort(sortByRecencyDesc);

    const featuredMarkets = [...openMarketsClassic]
      .sort(sortByVolumeThenRecencyDesc)
      .slice(0, FEATURED_LIMIT);

    const markets = dedupeByAddress([...openMarketsClassic, ...resolvedMarketsClassic]).sort(sortByRecencyDesc);

    return NextResponse.json(
      {
        topLiveFlashMarket,
        homeLiveFlashMarket: topLiveFlashMarket,
        featuredMarkets,
        openMarketsClassic,
        resolvedMarketsClassic,
        markets,
        liveMap,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
          "Content-Type": "application/json; charset=utf-8",
        },
      }
    );
  } catch (err) {
    console.error("/api/home fatal:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
