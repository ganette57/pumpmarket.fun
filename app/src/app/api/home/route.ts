import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ACTIVE_LIVE_STATUSES = ["live", "locked"];

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  try {
    const sb = getSupabase();

    // All three queries in parallel
    const [marketsRes, liveRes] = await Promise.all([
      sb
        .from("markets")
        .select(
          `id,market_address,question,description,category,image_url,end_date,creator,social_links,
           yes_supply,no_supply,total_volume,resolved,resolution_status,market_type,
           outcome_names,outcome_supplies,sport_meta,sport_trading_state,created_at`
        )
        .order("created_at", { ascending: false })
        .limit(200),

      sb
        .from("live_sessions")
        .select("id,market_address,status,created_at")
        .in("status", ACTIVE_LIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (marketsRes.error) {
      console.error("/api/home markets error:", marketsRes.error);
      return NextResponse.json(
        { error: "markets query failed" },
        { status: 500 }
      );
    }

    // Build live map: market_address -> session id
    const liveMap: Record<string, string> = {};
    if (!liveRes.error && liveRes.data) {
      for (const row of liveRes.data as {
        id: string;
        market_address: string;
      }[]) {
        if (!liveMap[row.market_address]) {
          liveMap[row.market_address] = row.id;
        }
      }
    }

    // Identify featured market candidates to batch-load their transactions
    // We replicate the featured selection logic: open markets sorted by volume, top 5
    const markets = marketsRes.data || [];
    const featuredAddresses = getFeaturedAddresses(markets);

    let featuredTxs: Record<string, any[]> = {};
    if (featuredAddresses.length > 0) {
      const { data: txData, error: txErr } = await sb
        .from("transactions")
        .select(
          "created_at,is_buy,is_yes,outcome_index,outcome_name,shares,amount,market_id,market_address"
        )
        .in("market_address", featuredAddresses)
        .order("created_at", { ascending: true })
        .limit(2000);

      if (!txErr && txData) {
        for (const tx of txData) {
          const addr = tx.market_address;
          if (!addr) continue;
          if (!featuredTxs[addr]) featuredTxs[addr] = [];
          featuredTxs[addr].push(tx);
        }
      }
    }

    return NextResponse.json(
      { markets, liveMap, featuredTxs },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    console.error("/api/home fatal:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

/**
 * Lightweight server-side replication of the featured selection logic.
 * Returns up to 5 market_address values for featured markets.
 */
function getFeaturedAddresses(rows: any[]): string[] {
  const MIN_VOL = 50_000_000; // 0.05 SOL
  const nowSec = Date.now() / 1000;

  // Simple open check (non-resolved, not past end date)
  const open = rows.filter((r) => {
    if (r.resolved) return false;
    const rs = String(r.resolution_status || "open").toLowerCase();
    if (rs === "proposed" || rs === "finalized" || rs === "cancelled")
      return false;
    const endDate = r.end_date ? new Date(r.end_date).getTime() / 1000 : 0;
    if (endDate && nowSec >= endDate) return false;
    return true;
  });

  const byVol = [...open].sort(
    (a, b) => Number(b.total_volume || 0) - Number(a.total_volume || 0)
  );
  const countWithVol = byVol.filter(
    (m) => Number(m.total_volume || 0) >= MIN_VOL
  ).length;

  const picked =
    countWithVol >= 2 && open.length > 0 ? byVol.slice(0, 5) : open.slice(0, 5);

  return picked.map((m: any) => m.market_address).filter(Boolean);
}
