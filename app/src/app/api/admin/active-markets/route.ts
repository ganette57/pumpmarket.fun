import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};
const ACTIVE_BATCH_SIZE = 500;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const nowIso = new Date().toISOString();
    const data: any[] = [];
    for (let from = 0; ; from += ACTIVE_BATCH_SIZE) {
      const to = from + ACTIVE_BATCH_SIZE - 1;
      const { data: chunk, error } = await supabaseAdmin
        .from("markets")
        .select(`
          market_address,
          question,
          category,
          image_url,
          end_date,
          total_volume,
          creator,
          market_type,
          outcome_names,
          resolution_status,
          is_blocked,
          blocked_reason,
          blocked_at,
          blocked_by
        `)
        .gt("end_date", nowIso)
        .not("resolution_status", "in", '("finalized","cancelled")')
        .order("end_date", { ascending: true })
        .order("market_address", { ascending: true })
        .range(from, to);

      if (error) {
        console.error("active-markets error:", error);
        return NextResponse.json(
          { error: error.message },
          { status: 500, headers: NO_STORE_HEADERS }
        );
      }

      if (!chunk?.length) break;
      data.push(...chunk);
      if (chunk.length < ACTIVE_BATCH_SIZE) break;
    }

    if (process.env.NODE_ENV !== "production") {
      console.debug(`[admin active-markets] returned=${data?.length || 0}`);
    }

    return NextResponse.json(
      {
        ok: true,
        count: data?.length || 0,
        markets: data || [],
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    console.error("active-markets error:", e);
    return NextResponse.json(
      { error: e?.message || "Internal error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
