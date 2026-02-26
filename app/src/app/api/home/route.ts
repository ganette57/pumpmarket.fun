import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Singleton — reused between invocations (warm lambda)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// force-dynamic: skip ISR pre-render (response too large for fallback).
// CDN caching is handled via Cache-Control header in the response.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [marketsRes, liveRes] = await Promise.all([
      sb
        .from("markets")
        .select(
          `
            id,
            market_address,
            question,
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
            outcome_supplies
          `
        )
        .order("created_at", { ascending: false })
        .limit(48),

      sb
        .from("live_sessions")
        .select("id,market_address,status,created_at")
        .in("status", ["live", "locked"])
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
      for (const row of liveRes.data) {
        if (!liveMap[row.market_address]) {
          liveMap[row.market_address] = row.id;
        }
      }
    }

    const markets = ((marketsRes.data as any[]) || []).map((m: any) => ({
      ...m,
      image_url:
        typeof m.image_url === "string" && m.image_url.startsWith("data:")
          ? null
          : m.image_url,
    }));

    return NextResponse.json(
      { markets, liveMap },
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
