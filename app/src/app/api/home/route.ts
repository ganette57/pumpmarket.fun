import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Singleton — reused between invocations (warm lambda)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// ISR: Vercel serves cached response for 30s, then revalidates in background
export const revalidate = 30;

export async function GET() {
  try {
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
        .select("id,market_address")
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

    return NextResponse.json(
      { markets: marketsRes.data || [], liveMap },
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
