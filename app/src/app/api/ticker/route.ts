import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Singleton — reused between invocations (warm lambda)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// force-dynamic: skip ISR pre-render. CDN caching via Cache-Control header.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data: txs, error: txErr } = await sb
      .from("transactions")
      .select("id,created_at,is_buy,shares,outcome_name,market_address")
      .eq("is_buy", true)
      .order("created_at", { ascending: false })
      .limit(20);

    if (txErr) {
      console.error("/api/ticker tx error:", txErr);
      return NextResponse.json({ error: "tx query failed" }, { status: 500 });
    }

    const cleanTxs = ((txs as any[]) || []).filter((r) => r.is_buy);

    const addresses = Array.from(
      new Set(
        cleanTxs.map((r) => r.market_address).filter((x): x is string => !!x)
      )
    );

    const marketMap = new Map<string, string>();

    if (addresses.length) {
      const { data: mkts, error: mErr } = await sb
        .from("markets")
        .select("market_address,question")
        .in("market_address", addresses);

      if (!mErr && mkts) {
        for (const m of mkts as { market_address: string; question: string | null }[]) {
          if (m?.market_address)
            marketMap.set(m.market_address, m.question || "a market");
        }
      }
    }

    const items = cleanTxs.map((r) => ({
      ...r,
      __market_question: r.market_address
        ? marketMap.get(r.market_address) || "a market"
        : "a market",
    }));

    return NextResponse.json(
      { items },
      {
        headers: {
          "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
        },
      }
    );
  } catch (err) {
    console.error("/api/ticker fatal:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
