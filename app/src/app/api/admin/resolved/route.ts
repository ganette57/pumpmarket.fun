// app/src/app/api/admin/resolved/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  try {
    const sb = supabaseAdmin();

    // We consider "resolved history" = finalized OR cancelled
    const { data, error } = await sb
      .from("markets")
      .select(
        `
        market_address,
        question,
        resolution_status,
        winning_outcome,
        resolved_at,
        cancelled_at,
        resolve_tx,
        cancel_tx,
        market_type,
        outcome_names
      `
      )
      .in("resolution_status", ["finalized", "cancelled"])
      .order("resolved_at", { ascending: false, nullsFirst: false })
      .order("cancelled_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) throw error;

    const resolved = (data || []).map((m: any) => {
      const action = m.resolution_status === "finalized" ? "approved" : "cancelled";
      const tx = action === "approved" ? m.resolve_tx : m.cancel_tx;

      return {
        market_address: m.market_address,
        question: m.question,
        resolved_action: action,
        winning_outcome: m.winning_outcome ?? null,
        tx_sig: tx ?? null,
        resolved_at: (m.resolved_at ?? m.cancelled_at) ?? null,
        market_type: m.market_type ?? null,
        outcome_names: m.outcome_names ?? null,
      };
    });

    return NextResponse.json(
      { resolved },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load resolved" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
